import type { LangCodeISO6393 } from "@/definitions"
import { ISO6393_TO_6391 } from "@/definitions"
import { logger } from "@/utils/logger"

/**
 * Quick machine translation for the selection toolbar's 翻译 button.
 *
 * This is the free endpoint behind Google Translate's own web UI
 * (`client=gtx`) — the same family of undocumented endpoint the pronunciation
 * button already uses (see `utils/speech.ts`). It is deliberately providerless:
 * the point of the button is to read a sentence *now*, without an API key, a
 * queue or a prompt, so it must work on a fresh install.
 *
 * It is not a documented API and carries no availability guarantee, so every
 * failure is surfaced to the caller (which shows it in the popover) rather than
 * swallowed, and every answer is cached — if it ever changes shape or
 * disappears, this file is the only thing that has to change with it.
 *
 * Runs in the service worker: a content script would have to fight the page's
 * CSP for a cross-origin fetch it cannot win.
 */

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"

/**
 * The endpoint answers over GET, so the text rides in the URL. A runaway
 * selection (a whole article highlighted by accident) is capped rather than
 * rejected: a truncated answer beats a request Google refuses outright.
 */
const GOOGLE_MAX_CHARS = 5000

/**
 * Google speaks two-letter codes while the config stores ISO 639-3 ones.
 * An unmappable source language falls back to `auto` — Google detects it,
 * which for a single selection is almost always the same answer. An
 * unmappable target falls back to the product's default target (Chinese).
 */
const GOOGLE_AUTO = "auto"
const GOOGLE_DEFAULT_TARGET = "zh-CN"

export interface QuickTranslateInput {
  text: string
  /** ISO 639-3 source language from the config, or `auto`. */
  sourceLanguageCode?: LangCodeISO6393 | "auto"
  /** ISO 639-3 target language from the config. */
  targetLanguageCode?: LangCodeISO6393
}

/** Maps a stored ISO 639-3 code onto the tag Google's endpoint expects. */
export function resolveGoogleLang(code: string | undefined, fallback: string): string {
  if (!code) {
    return fallback
  }

  const trimmed = code.trim()
  if (!trimmed) {
    return fallback
  }

  // Exact match first: the table carries mixed-case keys (`cmn-Hant`) that a
  // lowercased lookup would miss, and those are exactly the variants worth
  // keeping apart.
  const exact = ISO6393_TO_6391[trimmed]
  if (exact) {
    return exact
  }

  const normalized = trimmed.toLowerCase().replace(/_/g, "-")
  return ISO6393_TO_6391[normalized] ?? fallback
}

/** The query string the endpoint expects, exported so tests can inspect it. */
export function buildGoogleTranslateParams(text: string, sourceLang: string, targetLang: string): URLSearchParams {
  return new URLSearchParams({
    client: "gtx",
    sl: sourceLang,
    tl: targetLang,
    dt: "t",
    ie: "UTF-8",
    oe: "UTF-8",
    q: text.slice(0, GOOGLE_MAX_CHARS),
  })
}

/**
 * Pulls the translation out of the endpoint's nested-array response.
 *
 * The shape is `[[[译文, 原文, …], …], …]`: the first element holds one entry
 * per sentence segment. Anything else — an error page that still answered 200,
 * a future reshuffle — is `null`, which the caller turns into a visible failure
 * instead of rendering `[object Object]` into the popover.
 */
export function parseGoogleTranslateResponse(payload: unknown): string | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const segments = payload[0]
  if (!Array.isArray(segments)) {
    return null
  }

  const parts: string[] = []
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      parts.push(segment[0])
    }
  }

  return parts.length > 0 ? parts.join("") : null
}

/**
 * Session-lifetime translation cache, keyed by what produced it.
 *
 * The endpoint rate-limits, and re-selecting the same sentence to compare the
 * quick answer against the AI one is a normal thing to do. Lives in the service
 * worker and dies with it, like the audio cache.
 */
const translationCache = new Map<string, string>()
const TRANSLATION_CACHE_LIMIT = 50

function cacheTranslation(key: string, value: string): void {
  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    const oldest = translationCache.keys().next().value
    if (oldest !== undefined) {
      translationCache.delete(oldest)
    }
  }
  translationCache.set(key, value)
}

/** Test seam: the cache is an implementation detail with no other consumer. */
export function clearGoogleTranslateCache(): void {
  translationCache.clear()
}

/**
 * Translates one selection and resolves with the plain translated text.
 *
 * Rejects with a message that names the actual failure — a non-OK status, a
 * body that is not the expected shape — because the toolbar shows it verbatim
 * after 「翻译失败：」, and "something went wrong" helps nobody.
 */
export async function quickTranslateWithGoogle(input: QuickTranslateInput): Promise<string> {
  const trimmed = input.text.trim()
  if (!trimmed) {
    throw new Error("没有选中的文字")
  }

  const sourceLang = resolveGoogleLang(input.sourceLanguageCode, GOOGLE_AUTO)
  const targetLang = resolveGoogleLang(input.targetLanguageCode, GOOGLE_DEFAULT_TARGET)

  const cacheKey = `${sourceLang}|${targetLang}|${trimmed.slice(0, GOOGLE_MAX_CHARS)}`
  const cached = translationCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const params = buildGoogleTranslateParams(trimmed, sourceLang, targetLang)
  const response = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${params.toString()}`, {
    // The endpoint is anonymous; sending cookies would only leak them.
    credentials: "omit",
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error(`Google 翻译接口返回 ${response.status}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    throw new Error("Google 翻译接口返回了无法解析的内容")
  }

  const translated = parseGoogleTranslateResponse(payload)
  if (translated === null) {
    throw new Error("Google 翻译接口返回了无法解析的内容")
  }

  cacheTranslation(cacheKey, translated)
  logger.info(`[QuickTranslate] ${sourceLang} -> ${targetLang}, ${translated.length} chars`)
  return translated
}
