/**
 * Tunables for the Ebbinghaus push-review scheduler.
 *
 * `SRS_INTERVALS_MINUTES` is the classic Ebbinghaus retention ladder. The
 * scheduler advances a word purely by time; rating a word on the review card
 * only nudges the stage (see `advanceStage` in `src/utils/review/schedule.ts`).
 */
export const SRS_INTERVALS_MINUTES = [
  5, // 5 minutes
  30, // 30 minutes
  720, // 12 hours
  1440, // 1 day
  2880, // 2 days
  5760, // 4 days
  10080, // 7 days
  21600, // 15 days
] as const

/** Alarm name of the single self-rescheduling one-shot tick. */
export const REVIEW_TICK_ALARM = "review-tick"

/**
 * Chrome never fires an alarm sooner than 30 seconds out, and a tick that
 * schedules itself for "now" would spin. Every wake-up is clamped to this floor.
 */
export const MIN_ALARM_DELAY_MS = 30_000

/** Automatic queue syncs are throttled to at most one per this window. */
export const REVIEW_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Upper bound on notifications emitted per tick. Bounds the service worker
 * lifetime: each notification may block on one LLM call capped at
 * {@link EXAMPLE_LLM_TIMEOUT_MS}.
 */
export const MAX_PUSHES_PER_TICK = 3

/**
 * How many over-quota entries a single tick may move to tomorrow. Deferring in
 * batches clears a large backlog in a few wake-ups instead of one per word.
 */
export const MAX_DEFERRALS_PER_TICK = 50

/** Vocabulary words are scanned in pages; stop after this many candidates. */
export const MAX_QUEUE_SIZE = 200

/** Page size used when scanning the vocabulary book for reviewed words. */
export const VOCABULARY_PAGE_SIZE = 100

/** Entries not confirmed by a sync for this long are dropped. */
export const ENTRY_TTL_DAYS = 30

/** Per-day stats older than this are pruned. */
export const STATS_TTL_DAYS = 7

/** Notification payload records older than this are pruned. */
export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000

/** Notification ids are generated locally so they survive Chrome < 116. */
export const NOTIFICATION_ID_PREFIX = "vr"

/** Hard cap on a single LLM example call, keeping the service worker alive. */
export const EXAMPLE_LLM_TIMEOUT_MS = 15_000

/** Temperature used for the first example attempt, and for the retry. */
export const EXAMPLE_TEMPERATURE = 0.9
export const EXAMPLE_RETRY_TEMPERATURE = 1.1

/** Max characters kept when a sentence is trimmed for the notification body. */
export const EXAMPLE_MAX_LENGTH = 200

/** Max characters kept from the translation line used as the notification subtitle. */
export const CONTEXT_MESSAGE_MAX_LENGTH = 80

/** Backoff for a failed push: `min(BACKOFF_BASE_MINUTES * 2^failureCount, MAX)`. */
export const BACKOFF_BASE_MINUTES = 2
export const BACKOFF_MAX_MINUTES = 30

/** Whole-tick deferral when the config or the backend cannot be read. */
export const TICK_RETRY_MINUTES = 10

/**
 * Usage angles rotated per push. The prompt forbids reusing the previous
 * angle, which is what makes consecutive example sentences genuinely different
 * rather than a paraphrase of the same scene.
 */
export const REVIEW_EXAMPLE_ANGLES = [
  "daily conversation",
  "work email",
  "tech blog writing",
  "movie or TV dialogue",
  "academic writing",
  "casual slang",
  "business news",
  "travel situation",
  "social media post",
  "idiom / collocation drill",
] as const

export type ReviewExampleAngle = typeof REVIEW_EXAMPLE_ANGLES[number]

/**
 * Ceiling on collocations kept per push, regardless of what the model returns.
 *
 * Both this and {@link SRS_INTERVALS_MINUTES} bound what a single queued entry
 * can store; a word contributes ~200 bytes per push on top of the schedule.
 */
export const EXAMPLE_COLLOCATION_LIMIT = 5

/** Path of the review card page, relative to the extension root. */
export const REVIEW_CARD_PATH = "/review-card.html"

/** Query parameter carrying the word to open the card on. */
export const REVIEW_CARD_WORD_PARAM = "w"

/**
 * Default voice tag when the vocabulary entry carries no source language.
 *
 * The card speaks through Google's Translate endpoint — the one behind Google
 * Translate's own speaker button. It is undocumented and offers no availability
 * guarantee, so every call is cached and every failure is surfaced rather than
 * swallowed. Microsoft's equivalent (the Edge read-aloud endpoint) rejects every
 * request lacking a `Sec-MS-GEC` token derived from a Windows machine id, which
 * is an anti-automation control, not an API quirk to work around.
 */
export const TTS_DEFAULT_LANG = "en-US"

export const REVIEW_NOTIFICATION_ICON_PATH = "/icon/128.png"
