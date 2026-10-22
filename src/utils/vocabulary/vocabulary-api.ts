import type {
  AddVocabularyWordPayload,
  AddVocabularyWordResult,
  UpdateVocabularyWordPayload,
  VocabularyQuery,
  VocabularySourceCounts,
  VocabularyWord,
  VocabularyWriteResult,
} from "@/types/vocabulary"
import { getBackendBaseUrl } from "@/utils/config/backend"
import { logger } from "@/utils/logger"

/** Backend snake_case response shape */
interface VocabularyWordResponse {
  id: string
  word: string
  translation: string
  context_url?: string
  context_text?: string
  source_language?: string
  target_language?: string
  star: 1 | 2 | 3 | 4 | 5
  created_at: number
  last_reviewed_at?: number
  review_count: number
  note?: string
  source?: "local" | "eudic"
  phonetic?: string
}

/** Backend list response shape */
interface VocabularyListResponse {
  records: VocabularyWordResponse[]
  total: number
  limit: number
  offset: number
  /** How many words each source holds — not affected by the current filter */
  by_source?: Partial<VocabularySourceCounts>
}

/** Backend write response shape */
interface VocabularyWriteResponse {
  eudic_sync?: { ok: boolean, error?: string }
}

/** Convert backend snake_case to frontend camelCase */
function toVocabularyWord(raw: VocabularyWordResponse): VocabularyWord {
  return {
    id: raw.id,
    word: raw.word,
    translation: raw.translation,
    contextUrl: raw.context_url,
    contextText: raw.context_text,
    sourceLanguage: raw.source_language,
    targetLanguage: raw.target_language,
    star: raw.star,
    createdAt: raw.created_at,
    lastReviewedAt: raw.last_reviewed_at,
    reviewCount: raw.review_count,
    note: raw.note,
    source: raw.source,
    phonetic: raw.phonetic,
  }
}

/** Convert frontend camelCase payload to backend snake_case */
function toAddPayload(data: AddVocabularyWordPayload): Record<string, unknown> {
  return {
    word: data.word,
    translation: data.translation,
    ...(data.contextUrl != null && { context_url: data.contextUrl }),
    ...(data.contextText != null && { context_text: data.contextText }),
    ...(data.sourceLanguage != null && { source_language: data.sourceLanguage }),
    ...(data.targetLanguage != null && { target_language: data.targetLanguage }),
  }
}

/** Convert frontend update payload to backend snake_case */
function toUpdatePayload(updates: UpdateVocabularyWordPayload["updates"]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (updates.star != null)
    result.star = updates.star
  if (updates.translation != null)
    result.translation = updates.translation
  if (updates.note != null)
    result.note = updates.note
  return result
}

/** Pick the Eudic sync status out of a backend write response */
function toWriteResult(raw: VocabularyWriteResponse | null): VocabularyWriteResult {
  if (!raw?.eudic_sync)
    return {}
  return {
    eudicSync: {
      ok: raw.eudic_sync.ok,
      ...(raw.eudic_sync.error != null && { error: raw.eudic_sync.error }),
    },
  }
}

/**
 * Add a new vocabulary word via backend API.
 * Deduplication is handled by the backend.
 * Returns the word's id.
 */
export async function apiAddWord(data: AddVocabularyWordPayload): Promise<AddVocabularyWordResult> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/vocabulary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toAddPayload(data)),
  })

  if (!res.ok) {
    throw new Error(`[Vocabulary] Add word failed: HTTP ${res.status}`)
  }

  const raw: VocabularyWordResponse & VocabularyWriteResponse = await res.json()
  logger.info("[Vocabulary] Added word via API:", raw.word)
  return { id: raw.id, ...toWriteResult(raw) }
}

/**
 * List vocabulary words with pagination, sorting, and search via backend API.
 *
 * The result also carries the per-source counts, so the source filter can
 * say how many words each book holds without another round trip.
 */
export async function apiGetWords(data: VocabularyQuery): Promise<{
  words: VocabularyWord[]
  total: number
  bySource: VocabularySourceCounts
}> {
  const baseUrl = await getBackendBaseUrl()
  const params = new URLSearchParams({
    limit: String(data.limit ?? 50),
    offset: String(data.offset ?? 0),
    sortBy: data.sortBy ?? "createdAt",
    sortOrder: data.sortOrder ?? "desc",
  })
  if (data.search) {
    params.set("search", data.search)
  }
  if (data.source && data.source !== "all") {
    params.set("source", data.source)
  }

  const res = await fetch(`${baseUrl}/api/vocabulary?${params}`)

  if (!res.ok) {
    throw new Error(`[Vocabulary] Get words failed: HTTP ${res.status}`)
  }

  const raw: VocabularyListResponse = await res.json()
  return {
    words: raw.records.map(toVocabularyWord),
    total: raw.total,
    bySource: {
      all: raw.by_source?.all ?? raw.total,
      local: raw.by_source?.local ?? 0,
      eudic: raw.by_source?.eudic ?? 0,
    },
  }
}

/**
 * Update a vocabulary word via backend API.
 *
 * The backend reports whether the change also reached the Eudic side; a
 * failed Eudic call never rolls back the local change.
 */
export async function apiUpdateWord(data: UpdateVocabularyWordPayload): Promise<VocabularyWriteResult> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/vocabulary/${data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toUpdatePayload(data.updates)),
  })

  if (!res.ok) {
    throw new Error(`[Vocabulary] Update word failed: HTTP ${res.status}`)
  }

  const raw: VocabularyWriteResponse = await res.json().catch(() => null)
  logger.info("[Vocabulary] Updated word via API:", data.id)
  return toWriteResult(raw)
}

/**
 * Delete a vocabulary word via backend API.
 *
 * Deleting an Eudic-backed word also removes it from the Eudic book.
 */
export async function apiDeleteWord(id: string): Promise<VocabularyWriteResult> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/vocabulary/${id}`, {
    method: "DELETE",
  })

  if (!res.ok) {
    throw new Error(`[Vocabulary] Delete word failed: HTTP ${res.status}`)
  }

  const raw: VocabularyWriteResponse = await res.json().catch(() => null)
  logger.info("[Vocabulary] Deleted word via API:", id)
  return toWriteResult(raw)
}

/**
 * Mark a word as reviewed with a new star rating via backend API.
 * Sends PATCH to update star, then POST to increment review count.
 */
export async function apiMarkWordReviewed(wordId: string, star: 1 | 2 | 3 | 4 | 5): Promise<VocabularyWriteResult> {
  const baseUrl = await getBackendBaseUrl()
  // Update star rating
  const patchRes = await fetch(`${baseUrl}/api/vocabulary/${wordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ star }),
  })

  if (!patchRes.ok) {
    throw new Error(`[Vocabulary] Update star failed: HTTP ${patchRes.status}`)
  }

  const patchRaw: VocabularyWriteResponse = await patchRes.json().catch(() => null)

  // Increment review count
  const reviewRes = await fetch(`${baseUrl}/api/vocabulary/${wordId}/review`, {
    method: "POST",
  })

  if (!reviewRes.ok) {
    throw new Error(`[Vocabulary] Mark review failed: HTTP ${reviewRes.status}`)
  }

  logger.info("[Vocabulary] Marked word reviewed via API:", wordId)
  return toWriteResult(patchRaw)
}

/**
 * How many words the flashcard session draws from.
 *
 * The session picks its cards out of the words with the lowest rating, so
 * the pool has to be big enough to reach past a pile of hard words — the
 * Eudic book alone adds hundreds.
 */
const FLASHCARD_POOL_SIZE = 500

/**
 * Get all vocabulary words for flashcard session.
 * Fetches from backend, then does weighted random selection on client side.
 */
export async function apiGetFlashcardSession(count: number): Promise<VocabularyWord[]> {
  // Fetch the pool (up to a reasonable limit for flashcard selection)
  const { words } = await apiGetWords({ limit: FLASHCARD_POOL_SIZE, offset: 0, sortBy: "star", sortOrder: "asc" })

  if (words.length === 0) {
    return []
  }

  // Weighted selection: lower star = higher priority
  // star=1 weight 5, star=2 weight 4, ..., star=5 weight 1
  const weighted: { word: VocabularyWord, weight: number }[] = words.map((w) => {
    const weight = 6 - w.star // 5, 4, 3, 2, 1
    return { word: w, weight: Math.max(1, weight) }
  })

  // Shuffle with weights (Fisher-Yates with weighted bias)
  const pool = [...weighted]
  const selected: VocabularyWord[] = []

  while (selected.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0)
    let random = Math.random() * totalWeight

    for (let i = 0; i < pool.length; i++) {
      random -= pool[i].weight
      if (random <= 0) {
        selected.push(pool[i].word)
        pool.splice(i, 1)
        break
      }
    }
  }

  return selected
}
