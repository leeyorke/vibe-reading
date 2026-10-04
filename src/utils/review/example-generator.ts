import type { Config } from "@/types/config/config"
import type { GeneratedExample, ReviewScheduleEntry } from "@/types/review"
import { generateText } from "ai"
import { getLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import {
  EXAMPLE_COLLOCATION_LIMIT,
  EXAMPLE_LLM_TIMEOUT_MS,
  EXAMPLE_MAX_LENGTH,
  EXAMPLE_RETRY_TEMPERATURE,
  EXAMPLE_TEMPERATURE,
  REVIEW_EXAMPLE_ANGLES,
} from "@/utils/constants/review"
import { logger } from "@/utils/logger"
import { getModelById } from "@/utils/providers/model"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"

/**
 * One call produces everything the review card shows, so the card never has to
 * wait on the network and a push never needs a second LLM round-trip.
 */
const SYSTEM_PROMPT = `You build study material for a vocabulary learner.

Respond with a single JSON object and nothing else — no markdown fence, no commentary.

Schema:
{"sentence":"<one English sentence>","sentenceChinese":"<its Chinese translation>","collocations":["<phrase>", ...]}

Rules:
1. "sentence" must contain the target expression exactly as written, between 6 and 24 words, in plain everyday English.
2. "sentenceChinese" is a faithful, natural Chinese translation of "sentence".
3. "collocations" are 2 to 4 common English phrases or idioms that the target expression appears in. Give each as a short standalone phrase, not a full sentence. Order them by how common they are.
4. Never repeat the previously shown sentence or reuse its setting, register, or collocation. Change the scene, the speaker, and the words it collocates with.
5. Show the expression in use; never define it inside the sentence.`

function getLanguageName(code: string | undefined, fallback: string): string {
  if (!code) {
    return fallback
  }
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? fallback
  }
  catch {
    return fallback
  }
}

/** Stable, cheap string hash so the angle does not depend on word length parity. */
function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * Pick the usage angle for this push.
 *
 * Both the stage and the word feed the rotation, so consecutive pushes of the
 * same word always land on different angles.
 */
export function selectAngle(entry: ReviewScheduleEntry): string {
  const index = (entry.stage + hashString(entry.word)) % REVIEW_EXAMPLE_ANGLES.length
  return REVIEW_EXAMPLE_ANGLES[index]
}

/** Comparison key for spotting a model that just parroted the previous sentence. */
function normalizeSentence(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
}

/** Strip the decorations models like to add around a single sentence. */
function cleanSentence(raw: string): string {
  const firstLine = raw
    .split("\n")
    .map(line => line.trim())
    .find(Boolean) ?? ""

  return firstLine
    .replace(/^["'“”‘’`\-\d.)\s]+/, "")
    .replace(/["'“”‘’`\s]+$/, "")
    .trim()
    .slice(0, EXAMPLE_MAX_LENGTH)
}

/**
 * Parse the model's JSON payload, tolerating the ways models like to wrap it.
 *
 * Anything unusable yields `null` so the caller can fall back rather than
 * render half a card: the whole payload is either usable or discarded.
 */
export function parseExamplePayload(raw: string): { sentence: string, sentenceChinese: string, collocations: string[] } | null {
  const withoutFence = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/\s*```[\s\S]*$/, "").trim()

  const start = withoutFence.indexOf("{")
  const end = withoutFence.lastIndexOf("}")
  if (start === -1 || end <= start) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1))
  }
  catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.sentence !== "string" || !record.sentence.trim()) {
    return null
  }

  const collocations = Array.isArray(record.collocations)
    ? record.collocations
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, EXAMPLE_COLLOCATION_LIMIT)
    : []

  return {
    sentence: cleanSentence(record.sentence),
    sentenceChinese: typeof record.sentenceChinese === "string" ? record.sentenceChinese.trim() : "",
    collocations,
  }
}

function buildUserPrompt(entry: ReviewScheduleEntry, angle: string, targetLanguageName: string): string {
  const lines = [
    `Target expression: ${entry.word}`,
    `Meaning (${targetLanguageName}): ${entry.translation.split("\n")[0] ?? entry.translation}`,
    `This push's angle: ${angle}`,
  ]

  if (entry.contextText) {
    lines.push(`Sentence where the learner originally met it (do not reuse): ${entry.contextText}`)
  }
  if (entry.lastExample) {
    lines.push(`Sentence shown on the previous push (must be different): ${entry.lastExample}`)
  }
  if (entry.lastAngle) {
    lines.push(`Angle used on the previous push (must be different): ${entry.lastAngle}`)
  }
  if (entry.lastCollocations?.length) {
    lines.push(`Collocations already shown (must be different): ${entry.lastCollocations.join("; ")}`)
  }

  lines.push("", "Write the JSON object.")
  return lines.join("\n")
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Review example generation timed out after ${ms}ms`)), ms)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function requestPayload(
  entry: ReviewScheduleEntry,
  angle: string,
  config: Config,
  temperature: number,
): Promise<{ sentence: string, sentenceChinese: string, collocations: string[] } | null> {
  const providerConfig = getProviderConfigById(getLLMProvidersConfig(config.providersConfig), config.translate.providerId)
  if (!providerConfig) {
    throw new Error(`Translation provider "${config.translate.providerId}" not found`)
  }

  const modelName = resolveModelId(providerConfig.model)
  const providerOptions = getProviderOptionsWithOverride(modelName ?? "", providerConfig.provider, providerConfig.providerOptions)
  const model = await getModelById(providerConfig.id)
  const targetLanguageName = getLanguageName(entry.targetLanguage, "the learner's language")

  const { text } = await withTimeout(
    generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(entry, angle, targetLanguageName),
      temperature,
      maxRetries: 0, // The review tick owns retry budget; SDK retries would stall the worker.
      ...(providerOptions && { providerOptions }),
    }),
    EXAMPLE_LLM_TIMEOUT_MS,
  )

  return parseExamplePayload(text)
}

/**
 * Produce the material shown on the review card.
 *
 * The whole point of the feature is seeing the word in a *fresh* context, so the
 * prompt carries the previous sentence, angle and collocations as explicit
 * exclusions, and a model that echoes the previous sentence is retried once at
 * a higher temperature. When generation is impossible the sentence captured
 * with the word is reused instead — a slightly stale example always beats no
 * reminder — and the card simply omits the sections it has no data for.
 */
export async function buildExample(
  entry: ReviewScheduleEntry,
  config: Config,
): Promise<GeneratedExample> {
  const angle = selectAngle(entry)

  if (config.review.generateExample) {
    for (const temperature of [EXAMPLE_TEMPERATURE, EXAMPLE_RETRY_TEMPERATURE]) {
      try {
        const payload = await requestPayload(entry, angle, config, temperature)
        if (payload && normalizeSentence(payload.sentence) !== normalizeSentence(entry.lastExample ?? "")) {
          return { ...payload, source: "llm", angle }
        }
        logger.warn(`[Review] Model repeated the previous sentence for "${entry.word}", retrying`)
      }
      catch (error) {
        logger.warn(`[Review] Example generation failed for "${entry.word}":`, error)
        break
      }
    }
  }

  if (entry.contextText?.trim()) {
    return {
      sentence: cleanSentence(entry.contextText),
      sentenceChinese: "",
      collocations: [],
      source: "context",
      angle,
    }
  }

  return { sentence: "", sentenceChinese: "", collocations: [], source: "bare", angle }
}
