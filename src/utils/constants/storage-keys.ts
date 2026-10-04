export const TRANSLATION_STATE_KEY_PREFIX = "session:translationState" as const

export function getTranslationStateKey(tabId: number): `session:translationState.${number}` {
  return `${TRANSLATION_STATE_KEY_PREFIX}.${tabId}` as const
}

export const DETECTED_CODE_STATE_KEY_PREFIX = "session:detectedCode" as const

export function getDetectedCodeStateKey(tabId: number): `session:detectedCode.${number}` {
  return `${DETECTED_CODE_STATE_KEY_PREFIX}.${tabId}` as const
}

/** Local SRS queue: word snapshots, stages and due timestamps. */
export const REVIEW_SCHEDULE_KEY = "local:review:schedule" as const

/** Per-day push counters used to enforce the daily quotas. */
export const REVIEW_STATS_KEY = "local:review:stats" as const

/**
 * Notification id → word id map. A service worker can be torn down between a
 * push and the user clicking a button, so the lookup cannot live in memory.
 */
export const REVIEW_NOTIFICATIONS_KEY = "local:review:notifications" as const
