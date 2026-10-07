import type { LLMProviderConfig } from "@/types/config/provider"
import type { TranslatePromptOptions, TranslatePromptResult } from "@/utils/prompts/translate"
import { generateText, streamText } from "ai"
import { extractAISDKErrorMessage } from "@/utils/error/extract-message"
import { getModelById } from "@/utils/providers/model"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { attachRequestErrorMeta, getRequestErrorMeta } from "@/utils/request/retry-policy"
import { createThinkTagFilter } from "./think-tag"

const THINK_TAG_RE = /<\/think>([\s\S]*)/

export type PromptResolver<TContext = unknown> = (
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<TContext>,
) => Promise<TranslatePromptResult>

export async function aiTranslate<TContext>(
  text: string,
  targetLangName: string,
  providerConfig: LLMProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: { isBatch?: boolean, context?: TContext },
) {
  const { id: providerId, model: providerModel, provider, providerOptions: userProviderOptions, temperature } = providerConfig
  const modelName = resolveModelId(providerModel)
  const model = await getModelById(providerId)

  const providerOptions = getProviderOptionsWithOverride(modelName ?? "", provider, userProviderOptions)
  const { systemPrompt, prompt } = await promptResolver(targetLangName, text, options)

  try {
    const { text: translatedText } = await generateText({
      model,
      system: systemPrompt,
      prompt,
      temperature,
      providerOptions,
      maxRetries: 0, // Disable SDK built-in retries, let RequestQueue/BatchQueue handle it
    })

    const [, finalTranslation = translatedText] = translatedText.match(THINK_TAG_RE) || []

    return finalTranslation
  }
  catch (error) {
    throw rethrowTranslateError(error)
  }
}

/**
 * Receives each user-visible slice of a streamed translation, in order.
 *
 * Background cannot hand a live HTTP body to the content script — extension
 * messages are one-shot — so `aiTranslateStream` drains the provider stream
 * here in the service worker and pushes the deltas out through whichever
 * channel the caller owns (today: a `runtime.connect` port). Keep it cheap:
 * it is called once per token.
 */
export type TranslateStreamDeltaHandler = (delta: string) => void | Promise<void>

/**
 * Streaming twin of {@link aiTranslate}: same prompts, same providers, same
 * `think`-tag handling, but the answer reaches the caller while the provider is
 * still writing it. Resolves with the complete text once the stream ends.
 */
export async function aiTranslateStream<TContext>(
  text: string,
  targetLangName: string,
  providerConfig: LLMProviderConfig,
  promptResolver: PromptResolver<TContext>,
  onDelta: TranslateStreamDeltaHandler,
  options?: { isBatch?: boolean, context?: TContext },
) {
  const { id: providerId, model: providerModel, provider, providerOptions: userProviderOptions, temperature } = providerConfig
  const modelName = resolveModelId(providerModel)
  const model = await getModelById(providerId)

  const providerOptions = getProviderOptionsWithOverride(modelName ?? "", provider, userProviderOptions)
  const { systemPrompt, prompt } = await promptResolver(targetLangName, text, options)

  const thinkTagFilter = createThinkTagFilter()
  let translatedText = ""

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      prompt,
      temperature,
      providerOptions,
      maxRetries: 0, // Disable SDK built-in retries, let RequestQueue/BatchQueue handle it
    })

    for await (const delta of result.textStream) {
      const visible = thinkTagFilter.push(delta)
      if (visible === "") {
        continue
      }
      translatedText += visible
      await onDelta(visible)
    }

    // A reasoning block left unterminated by a cut-off stream is still worth
    // showing; see `createThinkTagFilter`.
    translatedText += thinkTagFilter.finish()

    return translatedText
  }
  catch (error) {
    throw rethrowTranslateError(error)
  }
}

/**
 * Rewrites a provider failure into the message the user should read, keeping
 * the metadata the retry policy decides on. Shared by both entry points so a
 * streamed translation fails exactly as loudly as a buffered one.
 */
function rethrowTranslateError(error: unknown): unknown {
  const message = extractAISDKErrorMessage(error)
  const meta = getRequestErrorMeta(error)
  if (error instanceof Error) {
    error.message = message
    throw attachRequestErrorMeta(error, meta)
  }

  throw attachRequestErrorMeta(new Error(message), meta)
}
