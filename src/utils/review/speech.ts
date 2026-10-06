import { TTS_DEFAULT_LANG } from "@/utils/constants/review"
import { logger } from "@/utils/logger"

/**
 * Text-to-speech for anything that has a headword or a sentence to pronounce:
 * the review card page, and the selection toolbar.
 *
 * The browser's own `speechSynthesis` was dropped first: it silently depends on
 * an English voice pack being installed, and on a bare Windows profile there
 * simply is not one, so the button did nothing.
 *
 * What remains is the endpoint behind Google Translate's own speaker button. It
 * is not a documented API and carries no availability guarantee, so every call
 * is cached and every failure is surfaced rather than swallowed — if it ever
 * changes, this file is the only thing that has to change with it.
 *
 * Microsoft's equivalent (the Edge read-aloud endpoint) was tried and is not
 * usable here: it rejects every request that lacks a `Sec-MS-GEC` token
 * computed from a Windows machine identifier, which is an anti-automation
 * control rather than an API quirk.
 */

const GOOGLE_TTS_ENDPOINT = "https://translate.google.com/translate_tts"

/**
 * Google rejects anything longer. Callers only ever pass a headword or a single
 * example sentence, so the cap exists to turn a runaway input into a short
 * utterance instead of a hard failure.
 */
const GOOGLE_MAX_CHARS = 190

/**
 * Three-letter vocabulary codes that do not simply prefix-match their tag.
 *
 * `jpn` starts with `j` and `ger` with `g`, so slicing two characters off the
 * three-letter code produces `jp` and `gr`, neither of which is a language tag
 * Google recognises.
 */
const ISO_639_3_TO_BCP_47: Record<string, string> = {
  eng: "en-US",
  jpn: "ja",
  kor: "ko",
  ger: "de-DE",
  deu: "de-DE",
  fre: "fr-FR",
  fra: "fr-FR",
  spa: "es-ES",
  rus: "ru-RU",
  ita: "it-IT",
  por: "pt-PT",
}

/**
 * Session-lifetime audio cache, keyed by what produced it.
 *
 * The endpoint rate-limits aggressively and a single card session can ask for
 * the same word several times — a retry after a failure, a second look. The
 * service worker is the only place this runs, so the map lives exactly as long
 * as the worker and dies with it, which is also what we want: holding
 * megabytes of audio is not worth persisting.
 *
 * The raw bytes are what is cached; the `data:` URL the review card wants is
 * derived from them on demand, so one fetch serves both callers.
 */
const audioCache = new Map<string, CachedAudio>()
const AUDIO_CACHE_LIMIT = 40

interface CachedAudio {
  buffer: ArrayBuffer
  mimeType: string
}

export interface SynthesizeSpeechInput {
  text: string
  /** ISO 639-3 source language from the vocabulary entry, if it has one. */
  sourceLanguage?: string
}

/**
 * Map the vocabulary entry's ISO 639-3 language onto a BCP-47 tag.
 *
 * Google speaks BCP-47 while the vocabulary book stores three-letter codes. An
 * entry with no recorded language is treated as English, because that is what a
 * vocabulary entry from this extension almost always is.
 */
export function resolveSpeechLang(sourceLanguage?: string): string {
  if (!sourceLanguage) {
    return TTS_DEFAULT_LANG
  }

  const normalized = sourceLanguage.toLowerCase().replace(/_/g, "-")
  if (normalized === "eng" || normalized === "en") {
    return "en-US"
  }
  if (normalized.startsWith("zh")) {
    return normalized.includes("tw") || normalized.includes("hk") ? "zh-TW" : "zh-CN"
  }

  const mapped = ISO_639_3_TO_BCP_47[normalized]
  if (mapped) {
    return mapped
  }

  return /^[a-z]{2}$/.test(normalized) ? normalized : TTS_DEFAULT_LANG
}

export function buildGoogleTtsUrl(text: string, lang: string): string {
  const params = new URLSearchParams({
    ie: "UTF-8",
    client: "gtx",
    tl: lang,
    q: text.slice(0, GOOGLE_MAX_CHARS),
  })

  return `${GOOGLE_TTS_ENDPOINT}?${params.toString()}`
}

function encodeToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

/**
 * Fetch pronunciation audio and return it as a `data:` URL the card can hand
 * straight to an `Audio` element.
 *
 * A data URL rather than a blob URL on purpose: the page has no teardown to
 * hook, so revoking object URLs would be a lifecycle bug waiting to happen,
 * and these clips are a few kilobytes.
 */
export async function synthesizeSpeech(input: SynthesizeSpeechInput): Promise<string> {
  const { buffer, mimeType } = await fetchCachedAudio(input)
  return encodeToDataUrl(buffer, mimeType)
}

/**
 * Fetch pronunciation audio as raw bytes for a Web Audio caller.
 *
 * The selection toolbar asks for the bytes rather than a URL because it lives
 * in a content script: any URL it loads in the page's document — `data:`,
 * `blob:` or remote — is a subresource load the page's CSP can refuse, while
 * an `ArrayBuffer` handed over extension messaging and decoded with
 * `AudioContext.decodeAudioData` has no CSP directive to answer to. Structured
 * clone copies the buffer, so the cache keeps its own.
 */
export async function synthesizeSpeechAudio(input: SynthesizeSpeechInput): Promise<ArrayBuffer> {
  const { buffer } = await fetchCachedAudio(input)
  return buffer
}

async function fetchCachedAudio({ text, sourceLanguage }: SynthesizeSpeechInput): Promise<CachedAudio> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error("Nothing to pronounce")
  }

  const lang = resolveSpeechLang(sourceLanguage)
  const cached = audioCache.get(lang + trimmed)
  if (cached) {
    return cached
  }

  const response = await fetch(buildGoogleTtsUrl(trimmed, lang), {
    // The endpoint is anonymous; sending cookies would only leak them.
    credentials: "omit",
    headers: { Accept: "audio/mpeg" },
  })

  if (!response.ok) {
    throw new Error(`Google TTS responded ${response.status}`)
  }

  // A rate-limit page can arrive with a 200, so the content type has to be
  // trusted before the bytes are treated as audio.
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim()
  if (!mimeType.startsWith("audio/")) {
    throw new Error("Google TTS answered with a non-audio body")
  }

  const entry: CachedAudio = { buffer: await response.arrayBuffer(), mimeType }

  if (audioCache.size >= AUDIO_CACHE_LIMIT) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    const oldest = audioCache.keys().next().value
    if (oldest !== undefined) {
      audioCache.delete(oldest)
    }
  }
  audioCache.set(lang + trimmed, entry)

  logger.info(`[TTS] Synthesised ${lang}, ${Math.round(entry.buffer.byteLength / 1024)}KB`)
  return entry
}

/** Test seam: the cache is an implementation detail with no other consumer. */
export function clearSpeechCache(): void {
  audioCache.clear()
}
