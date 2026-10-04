import type { ReviewCardData, ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import { SRS_INTERVALS_MINUTES } from "@/utils/constants/review"
import { queryWordDefinitionExact } from "@/utils/dict/dict-api"
import { logger } from "@/utils/logger"

/**
 * Pick the next word the learner still owes an answer on.
 *
 * This deliberately walks `pendingReview` rather than "whatever is overdue".
 * A word is pushed exactly when it becomes due, which means the instant the
 * card advances past it, nothing else is overdue either — an overdue-only
 * cursor would dead-end every session after a single word. Pending words are
 * the ones the learner was actually shown and has not answered for.
 *
 * Oldest push first, so a session drains the backlog in the order it arrived.
 */
export function pickNextPendingEntry(
  state: ReviewScheduleState,
  excludeWordId?: string,
): ReviewScheduleEntry | undefined {
  return Object.values(state.entries)
    .filter(entry => entry.pendingReview && !entry.graduated && entry.wordId !== excludeWordId)
    .sort((a, b) => (a.lastNotifiedAt ?? 0) - (b.lastNotifiedAt ?? 0) || a.wordId.localeCompare(b.wordId))
    .at(0)
}

/** How many words are still waiting for a rating. */
export function countPendingEntries(state: ReviewScheduleState): number {
  return Object.values(state.entries).filter(entry => entry.pendingReview && !entry.graduated).length
}

/**
 * Assemble everything the card renders for one word.
 *
 * The dictionary lookup is the only network call here and the only field that
 * may come back empty: phonetics and part of speech come from it, while the
 * translation is a local snapshot, so a backend outage costs the card its
 * audio rather than its content.
 */
export async function buildReviewCardData(
  entry: ReviewScheduleEntry,
  pendingCount: number,
): Promise<ReviewCardData> {
  let definition = null
  try {
    definition = await queryWordDefinitionExact(entry.word)
  }
  catch (error) {
    logger.warn(`[ReviewCard] Dictionary lookup failed for "${entry.word}":`, error)
  }

  return {
    wordId: entry.wordId,
    word: entry.word,
    translation: entry.translation,
    contextText: entry.contextText,
    sourceLanguage: entry.sourceLanguage,
    star: entry.star,
    stage: entry.stage,
    totalStages: SRS_INTERVALS_MINUTES.length,
    example: entry.lastExample ?? "",
    sentenceChinese: entry.lastSentenceChinese ?? "",
    collocations: entry.lastCollocations ?? [],
    lastNotifiedAt: entry.lastNotifiedAt,
    definition,
    pendingCount,
  }
}
