import type { WordDefinition } from "@/types/vocabulary"

/**
 * Local state for the Ebbinghaus push-review scheduler.
 *
 * Vocabulary words live on the companion backend, which has no notion of
 * "when was this word last pushed". Everything the scheduler needs to make a
 * decision is therefore mirrored into `chrome.storage.local` so that a push
 * never depends on the backend being reachable.
 */

export type ReviewStar = 1 | 2 | 3 | 4 | 5

/** What the user did with a notification, which nudges the SRS stage. */
export type ReviewAdvanceKind = "auto" | "remembered" | "forgotten"

/** Where the sentence shown in a notification came from. */
export type ReviewExampleSource = "llm" | "context" | "bare"

export interface ReviewScheduleEntry {
  /** Vocabulary word id (the backend primary key). */
  wordId: string
  /** Snapshot of the headword, so a push needs no backend round-trip. */
  word: string
  /** Snapshot of the dictionary translation, used as the notification subtitle. */
  translation: string
  /** Sentence captured when the word was collected, used as the fallback example. */
  contextText?: string
  /** Page URL the word was collected from. */
  contextUrl?: string
  /** ISO 639-3 source language of the word. */
  sourceLanguage?: string
  /** ISO 639-3 target language of the translation. */
  targetLanguage?: string
  /** Snapshot of the star rating, used to break ties towards harder words. */
  star: ReviewStar
  /** Index into {@link SRS_INTERVALS}. */
  stage: number
  /** Timestamp the next push is due. */
  nextDueAt: number
  /** Timestamp of the last successful push. */
  lastNotifiedAt?: number
  /** How many times this word has been pushed. */
  pushCount: number
  /** Consecutive push failures, drives the exponential backoff. */
  failureCount: number
  /** Sentence shown on the previous push, fed back to force a different usage. */
  lastExample?: string
  /** Chinese translation of {@link lastExample}, shown on the review card. */
  lastSentenceChinese?: string
  /** Collocations that came out of the same generation call as {@link lastExample}. */
  lastCollocations?: string[]
  /** Usage angle of the previous push. */
  lastAngle?: string
  /**
   * Set when the word has been pushed but not yet rated on the review card.
   *
   * The card session advances through pending words rather than through words
   * that happen to be overdue, because a word is pushed exactly when it becomes
   * due — which means no other word is due a second later, and an "overdue
   * only" cursor would dead-end the instant it advanced.
   */
  pendingReview?: boolean
  /** True once the word walked through every interval. */
  graduated?: boolean
  /** Timestamp of the last queue sync that confirmed this word still exists. */
  syncedAt: number
}

export interface ReviewScheduleState {
  version: 1
  entries: Record<string, ReviewScheduleEntry>
  /** Timestamp of the last automatic queue sync. */
  lastSyncAt?: number
}

export interface ReviewDailyStat {
  total: number
  perWord: Record<string, number>
}

/**
 * Why a scheduler pass stopped early instead of pushing anything.
 *
 * - `disabled` — the feature toggle is off; the alarm is cleared and nothing runs
 * - `quietHours` — quiet hours hold the whole queue back to a later time
 * - `dailyCap` — today's global ceiling is already spent
 * - `perWordCap` — every due word has already been pushed today on its own
 * - `nothingDue` — nothing in the queue has come due yet
 */
export type ReviewTickStopReason
  = | "disabled"
    | "quietHours"
    | "dailyCap"
    | "perWordCap"
    | "nothingDue"

/** What one pass of the scheduler did, reported back to the options page. */
export interface ReviewTickOutcome {
  pushed: number
  failed: number
  /** Words pushed back to a later time by quiet hours or a daily cap. */
  deferred: number
  /**
   * Why the pass pushed nothing, or `null` when it pushed something.
   *
   * Without this the caller sees three zeroes and has to guess — which is how a
   * disabled feature ends up reported to the user as "nothing is due".
   */
  stoppedBecause: ReviewTickStopReason | null
}

export interface ReviewStatsState {
  /** Keyed by local calendar day (`YYYY-MM-DD`). */
  days: Record<string, ReviewDailyStat>
}

export interface ReviewNotificationPayload {
  wordId: string
  issuedAt: number
}

export type ReviewNotificationRegistry = Record<string, ReviewNotificationPayload>

/** Status surfaced to the options page. */
export interface ReviewStatus {
  enabled: boolean
  queueSize: number
  graduatedCount: number
  todayCount: number
  /** Words that have been pushed but not yet rated on the review card. */
  pendingCount: number
  /** Timestamp of the earliest pending push, or null when the queue is empty. */
  nextDueAt: number | null
  lastSyncAt?: number
  /** False when the browser/OS blocks notifications for the extension. */
  permissionGranted: boolean
}

/** What the user pressed on the review card. */
export type ReviewRatingKind = "remembered" | "forgotten"

/**
 * One review card: everything the card page renders for a single word.
 *
 * The entry-derived fields survive a backend outage because they are local
 * snapshots; only `definition` needs the dictionary and degrades to `null`.
 */
export interface ReviewCardData {
  wordId: string
  word: string
  /** Dictionary translation, possibly multi-line (part-of-speech line + sense lines). */
  translation: string
  /** Sentence captured when the word was collected, used as the example fallback. */
  contextText?: string
  /** ISO 639-3 language of the word, used to pick a speech-synthesis voice. */
  sourceLanguage?: string
  star: ReviewStar
  stage: number
  totalStages: number
  /** The fresh sentence generated for this push. */
  example: string
  /** Chinese translation of {@link example}. */
  sentenceChinese: string
  collocations: string[]
  lastNotifiedAt?: number
  /** Dictionary lookup result, or `null` when the word is missing or the backend is down. */
  definition: WordDefinition | null
  /** How many pushed-but-unrated words remain after this one. */
  pendingCount: number
}

export interface GeneratedExample {
  sentence: string
  /** Chinese translation of {@link sentence}, empty when the model did not provide one. */
  sentenceChinese: string
  collocations: string[]
  source: ReviewExampleSource
  /** Usage angle the sentence was written for. */
  angle: string
}
