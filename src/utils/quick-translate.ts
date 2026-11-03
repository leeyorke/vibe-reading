import type { LangCodeISO6393 } from "@/definitions"
import { runWithFallback } from "@/utils/fallback-chain"
import { translateWithGoogle } from "@/utils/google-translate"
import { resolveIso6391 } from "@/utils/iso-639"
import { logger } from "@/utils/logger"
import { translateWithMicrosoft } from "@/utils/microsoft-translate"

/**
 * Quick machine translation for the selection toolbar's 翻译 button.
 *
 * This is the free endpoint family behind Google Translate's and Edge's own
 * web UIs, chained in order (Google first, Microsoft second — see
 * `utils/fallback-chain.ts` for why a chain at all). It is deliberately
 * providerless in the key sense: no API key, no queue, no prompt, so it works
 * on a fresh install. The language pair comes from the config so the answer
 * matches what the rest of the extension translates to; the source is
 * whatever the user pinned, or detection when it is `auto`.
 *
 * These are not documented APIs and carry no availability guarantee, so every
 * failure is surfaced to the caller (which shows it in the popover) rather
 * than swallowed, and every answer is cached — if the endpoints ever change
 * shape or disappear, the adapters are the only things that have to change
 * with them.
 *
 * Runs in the service worker: a content script would have to fight the page's
 * CSP for a cross-origin fetch it cannot win.
 */

/** `auto` in the config means "let the endpoint detect the source". */
const AUTO_DETECT = "auto"

/** An unmappable target language becomes the product's default target. */
const DEFAULT_TARGET_LANG = "zh-CN"

/**
 * A runaway selection (a whole article highlighted by accident) is capped
 * rather than rejected: a truncated answer beats a request the provider
 * refuses outright. 5000 is Google's URL limit; every provider in the chain
 * gets the same bound.
 */
const MAX_CHARS = 5000

export interface QuickTranslateInput {
  text: string
  /** ISO 639-3 source language from the config, or `auto`. */
  sourceLanguageCode?: LangCodeISO6393 | "auto"
  /** ISO 639-3 target language from the config. */
  targetLanguageCode?: LangCodeISO6393
}

/**
 * Session-lifetime translation cache, keyed by what produced it.
 *
 * The endpoints rate-limit, and re-selecting the same sentence to compare the
 * quick answer against the AI one is a normal thing to do. Lives in the service
 * worker and dies with it, like the audio cache. The cache sits above the
 * chain rather than inside a provider, so an answer Microsoft gave is served
 * just as happily as one Google gave.
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
export function clearQuickTranslateCache(): void {
  translationCache.clear()
}

/**
 * Translates one selection and resolves with the plain translated text.
 *
 * Rejects with a message that names every provider that failed and what it
 * answered — a non-OK status, a body that is not the expected shape — because
 * the toolbar shows it verbatim after 「翻译失败：」, and "something went
 * wrong" helps nobody.
 */
export async function quickTranslate(input: QuickTranslateInput): Promise<string> {
  const trimmed = input.text.trim()
  if (!trimmed) {
    throw new Error("没有选中的文字")
  }

  // Both endpoints in the chain speak the same two-letter code space, so the
  // pair is resolved once here instead of once per provider.
  const sourceLang = resolveIso6391(input.sourceLanguageCode, AUTO_DETECT)
  const targetLang = resolveIso6391(input.targetLanguageCode, DEFAULT_TARGET_LANG)
  const text = trimmed.slice(0, MAX_CHARS)

  const cacheKey = `${sourceLang}|${targetLang}|${text}`
  const cached = translationCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const translated = await runWithFallback([
    {
      name: "Google 翻译",
      cooldownKey: "google-translate",
      run: () => translateWithGoogle(text, sourceLang, targetLang),
    },
    {
      name: "Microsoft 翻译",
      cooldownKey: "microsoft-translate",
      run: () => translateWithMicrosoft(text, sourceLang, targetLang),
    },
  ])

  cacheTranslation(cacheKey, translated)
  logger.info(`[QuickTranslate] ${sourceLang} -> ${targetLang}, ${translated.length} chars`)
  return translated
}
