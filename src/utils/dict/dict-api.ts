import type { WordDefinition } from "@/types/vocabulary"

import { getBackendBaseUrl } from "@/utils/config/backend"
import { logger } from "@/utils/logger"

interface Phonetics {
  uk?: string
  us?: string
}

interface Example {
  text: string
  chinese: string
}

interface Sense {
  number: string
  definition: string
  chinese_definition: string
  /**
   * Optional: the backend is a separate local service whose entries vary, and a
   * sense can legitimately arrive without an examples list.
   */
  examples?: Example[]
}

interface WordResponse {
  headword: string
  id: string
  pos: string
  /** Optional for the same reason as {@link Sense.examples}. */
  phonetics?: Phonetics
  /**
   * A payload without at least one sense says nothing the reader can use, so it
   * counts as a miss rather than as a definition to render.
   */
  senses?: Sense[]
}

/**
 * Extracts the first word from a text string.
 * Trims whitespace, lowercases, and takes the first alphanumeric token.
 */
function extractFirstWord(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed)
    return null

  // Match first contiguous word (letters only, optionally with apostrophes or hyphens)
  const match = trimmed.match(/^[A-Z]+(?:['\-][A-Z]+)*/i)
  if (!match)
    return null

  return match[0].toLowerCase()
}

/**
 * Whether a parsed body is a word payload worth reading.
 *
 * The backend is a separate service that answers `{baseUrl}/api/word/{word}`
 * with whatever it has for the entry: the shape is not uniform, and an error,
 * an empty object or a plain-text body all come back with a 200 in some
 * deployments. Anything without at least one sense is a miss.
 */
function isUsableWordPayload(data: unknown): data is WordResponse {
  if (data == null || typeof data !== "object")
    return false
  const senses = (data as { senses?: unknown }).senses
  return Array.isArray(senses) && senses.length > 0
}

/**
 * Fetches word definition from the dictionary API.
 * Returns the raw JSON response, or null when the entry is missing, the request
 * failed or the body is not a usable word payload.
 */
async function fetchWord(word: string): Promise<WordResponse | null> {
  const baseUrl = await getBackendBaseUrl()
  const url = `${baseUrl}/api/word/${encodeURIComponent(word)}`

  try {
    const response = await fetch(url)

    if (!response.ok) {
      logger.warn(`[DictAPI] HTTP ${response.status} for word: ${word}`)
      return null
    }

    const data = await response.json()
    if (!isUsableWordPayload(data)) {
      logger.warn(`[DictAPI] Response is not a word payload for word: ${word}`)
      return null
    }
    return data
  }
  catch (error) {
    logger.error(`[DictAPI] Failed to fetch word "${word}":`, error)
    return null
  }
}

/**
 * Formats a word response into the user-facing display string.
 *
 * Format:
 *   {headword}
 *   英 /{uk}/ 美 /{us}/
 *   {number}. {pos} {chinese_definition}
 */
function formatWordResponse(data: WordResponse): string {
  const lines: string[] = []

  // Headword line
  lines.push(data.headword)

  // Phonetics line (only if at least one is available)
  const ukPhonetic = data.phonetics?.uk ?? ""
  const usPhonetic = data.phonetics?.us ?? ""
  if (ukPhonetic || usPhonetic) {
    const parts: string[] = []
    if (ukPhonetic) {
      parts.push(`英 ${ukPhonetic}`)
    }
    if (usPhonetic) {
      parts.push(`美 ${usPhonetic}`)
    }
    lines.push(parts.join(" "))
  }

  // Senses
  for (const sense of data.senses ?? []) {
    const posLabel = data.pos ? `${data.pos}. ` : ""
    lines.push(`${sense.number}. ${posLabel}${sense.chinese_definition}`)
  }

  return lines.join("\n")
}

/**
 * Queries the dictionary API for a word and returns the formatted string.
 * Returns null if the word is not found or the API is unreachable.
 */
export async function queryWordDefinition(word: string): Promise<string | null> {
  const cleanWord = extractFirstWord(word)
  if (!cleanWord) {
    logger.warn(`[DictAPI] Could not extract a valid word from: "${word}"`)
    return null
  }

  const data = await fetchWord(cleanWord)
  if (!data) {
    return null
  }

  return formatWordResponse(data)
}

/**
 * Maps the raw dictionary payload onto {@link WordDefinition}.
 *
 * A missing gloss, phonetic block or example list is dropped rather than
 * defaulted to `""` so that the review card and the toolbar hide those rows
 * instead of rendering blanks.
 */
function toWordDefinition(data: WordResponse): WordDefinition {
  return {
    headword: data.headword,
    phoneticUK: data.phonetics?.uk,
    phoneticUS: data.phonetics?.us,
    pos: data.pos,
    senses: (data.senses ?? []).map((s) => {
      const examples = s.examples?.length
        ? {
            examples: s.examples
              .filter(e => e.text?.trim())
              .map(e => ({ text: e.text, chinese: e.chinese ?? "" })),
          }
        : {}
      return {
        number: s.number,
        ...(s.definition && { englishDefinition: s.definition }),
        chineseDefinition: s.chinese_definition,
        ...examples,
      }
    }),
  }
}

/**
 * Queries the dictionary API for a word and returns structured data.
 * Returns null if the word is not found or the API is unreachable.
 */
export async function queryWordDefinitionStructured(word: string): Promise<WordDefinition | null> {
  const cleanWord = extractFirstWord(word)
  if (!cleanWord) {
    logger.warn(`[DictAPI] Could not extract a valid word from: "${word}"`)
    return null
  }

  const data = await fetchWord(cleanWord)
  if (!data) {
    return null
  }

  return toWordDefinition(data)
}

/**
 * Same as {@link queryWordDefinitionStructured} but without shape extraction.
 *
 * Vocabulary entries can be multi-word phrases, which `extractFirstWord` would
 * truncate to their first token and silently look up a different word.
 */
export async function queryWordDefinitionExact(word: string): Promise<WordDefinition | null> {
  const cleanWord = word.trim()
  if (!cleanWord) {
    return null
  }

  const data = await fetchWord(cleanWord)
  if (!data) {
    return null
  }

  return toWordDefinition(data)
}
