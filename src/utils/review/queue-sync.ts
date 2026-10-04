import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import type { VocabularyWord } from "@/types/vocabulary"
import { MAX_QUEUE_SIZE, REVIEW_SYNC_INTERVAL_MS, VOCABULARY_PAGE_SIZE } from "@/utils/constants/review"
import { logger } from "@/utils/logger"
import { loadSchedule, pruneStaleEntries, saveSchedule } from "@/utils/review/store"
import { apiGetWords } from "@/utils/vocabulary/vocabulary-api"

/**
 * Fields refreshed from the backend on every sync. Everything scheduling-related
 * (`stage`, `nextDueAt`, `pushCount`, …) is local state and must survive, or a
 * word would restart its ladder every time the service worker boots.
 */
function snapshotFields(word: VocabularyWord, syncedAt: number) {
  return {
    word: word.word,
    translation: word.translation,
    star: word.star,
    syncedAt,
    ...(word.contextText != null && { contextText: word.contextText }),
    ...(word.contextUrl != null && { contextUrl: word.contextUrl }),
    ...(word.sourceLanguage != null && { sourceLanguage: word.sourceLanguage }),
    ...(word.targetLanguage != null && { targetLanguage: word.targetLanguage }),
  }
}

function createEntry(word: VocabularyWord, now: number): ReviewScheduleEntry {
  return {
    wordId: word.id,
    word: word.word,
    translation: word.translation,
    star: word.star,
    stage: 0,
    nextDueAt: now,
    pushCount: 0,
    failureCount: 0,
    syncedAt: now,
    ...(word.contextText != null && { contextText: word.contextText }),
    ...(word.contextUrl != null && { contextUrl: word.contextUrl }),
    ...(word.sourceLanguage != null && { sourceLanguage: word.sourceLanguage }),
    ...(word.targetLanguage != null && { targetLanguage: word.targetLanguage }),
  }
}

/**
 * Pull the newest vocabulary pages and return every word the user has actually
 * reviewed at least once.
 *
 * Only reviewed words enter the queue: a word that was saved but never looked
 * at again has no retention history to schedule against.
 */
async function fetchReviewedWords(): Promise<VocabularyWord[]> {
  const reviewed: VocabularyWord[] = []
  let offset = 0

  while (reviewed.length < MAX_QUEUE_SIZE && offset < MAX_QUEUE_SIZE) {
    const limit = Math.min(VOCABULARY_PAGE_SIZE, MAX_QUEUE_SIZE - reviewed.length)
    const { words } = await apiGetWords({ limit, offset, sortBy: "createdAt", sortOrder: "desc" })

    if (words.length === 0) {
      break
    }

    reviewed.push(...words.filter(word => word.lastReviewedAt != null))
    offset += words.length

    if (words.length < limit) {
      break
    }
  }

  return reviewed.slice(0, MAX_QUEUE_SIZE)
}

export interface SyncQueueResult {
  state: ReviewScheduleState
  added: number
  removed: number
}

/**
 * Reconcile the local queue against the backend vocabulary book.
 *
 * Adding an entry starts its Ebbinghaus ladder at stage 0, due immediately.
 * Existing entries keep their schedule and only have their snapshots refreshed.
 */
export async function syncReviewQueue(options?: { force?: boolean }): Promise<SyncQueueResult> {
  const now = Date.now()
  const state = await loadSchedule()

  if (!options?.force && state.lastSyncAt != null && now - state.lastSyncAt < REVIEW_SYNC_INTERVAL_MS) {
    return { state, added: 0, removed: 0 }
  }

  let words: VocabularyWord[]
  try {
    words = await fetchReviewedWords()
  }
  catch (error) {
    // A backend outage must not wipe the queue: existing entries keep pushing
    // from their stored snapshots.
    logger.warn("[Review] Queue sync failed, keeping local queue:", error)
    return { state, added: 0, removed: 0 }
  }

  const seenIds = new Set(words.map(word => word.id))
  const entries: Record<string, ReviewScheduleEntry> = {}
  let added = 0

  for (const word of words) {
    const existing = state.entries[word.id]
    if (existing) {
      entries[word.id] = { ...existing, ...snapshotFields(word, now) }
    }
    else {
      entries[word.id] = createEntry(word, now)
      added++
    }
  }

  // Words the backend no longer reports are gone from the vocabulary book.
  let removed = 0
  for (const wordId of Object.keys(state.entries)) {
    if (!seenIds.has(wordId)) {
      removed++
    }
  }

  const nextState: ReviewScheduleState = {
    version: 1,
    entries: pruneStaleEntries(entries, now),
    lastSyncAt: now,
  }

  await saveSchedule(nextState)
  logger.info(`[Review] Queue synced: +${added} -${removed}, total ${Object.keys(nextState.entries).length}`)

  return { state: nextState, added, removed }
}
