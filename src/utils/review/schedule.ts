import type { ReviewConfig, ReviewQuietHoursConfig } from "@/types/config/review"
import type { ReviewAdvanceKind, ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import {
  BACKOFF_BASE_MINUTES,
  BACKOFF_MAX_MINUTES,
  MIN_ALARM_DELAY_MS,
  SRS_INTERVALS_MINUTES,
} from "@/utils/constants/review"

const MAX_STAGE = SRS_INTERVALS_MINUTES.length - 1

function clampStage(stage: number): number {
  return Math.max(0, Math.min(Math.floor(stage), MAX_STAGE))
}

function intervalAt(stage: number): number {
  return SRS_INTERVALS_MINUTES[clampStage(stage)] * 60_000
}

/** Wall-clock time until the given SRS stage comes due again. */
export function getIntervalMs(stage: number): number {
  return intervalAt(stage)
}

export interface AdvancedStage {
  stage: number
  nextDueAt: number
  graduated: boolean
}

/**
 * Move an entry to its next stage and compute the following due time.
 *
 * Time alone drives the ladder (`auto`); the notification buttons only nudge
 * it so a word the user already knows climbs two rungs at a time and one the
 * user just failed drops back down.
 */
export function advanceStage(
  entry: ReviewScheduleEntry,
  kind: ReviewAdvanceKind,
  now: number,
): AdvancedStage {
  const stage = clampStage(entry.stage)

  if (kind === "forgotten") {
    const reverted = Math.max(stage - 1, 0)
    return { stage: reverted, nextDueAt: now + intervalAt(reverted), graduated: false }
  }

  if (kind === "remembered") {
    const jumped = stage + 2
    return {
      stage: jumped,
      // Wait one rung longer than usual: the word just proved it is easy.
      nextDueAt: now + intervalAt(stage + 1),
      graduated: jumped > MAX_STAGE,
    }
  }

  const next = stage + 1
  return {
    stage: next,
    nextDueAt: now + intervalAt(stage),
    graduated: next > MAX_STAGE,
  }
}

/** Apply the advanced stage to an entry, returning a new object. */
export function applyAdvancedStage(
  entry: ReviewScheduleEntry,
  advanced: AdvancedStage,
  graduatedAction: ReviewConfig["graduatedAction"],
  now: number,
): ReviewScheduleEntry {
  if (!advanced.graduated) {
    return { ...entry, stage: advanced.stage, nextDueAt: advanced.nextDueAt, graduated: false }
  }

  if (graduatedAction === "restart") {
    return {
      ...entry,
      stage: 0,
      nextDueAt: now + intervalAt(0),
      pushCount: 0,
      graduated: false,
    }
  }

  return { ...entry, stage: advanced.stage, graduated: true }
}

/**
 * Backoff for a push that could not be delivered, so a broken provider or a
 * denied notification permission cannot produce a hot retry loop.
 */
export function getBackoffMs(failureCount: number): number {
  const exponent = Math.max(0, Math.min(Math.floor(failureCount), 10))
  return Math.min(BACKOFF_BASE_MINUTES * 2 ** exponent, BACKOFF_MAX_MINUTES) * 60_000
}

/** Entries whose due time has arrived, hardest and most overdue first. */
export function pickDueEntries(
  entries: Record<string, ReviewScheduleEntry>,
  now: number,
  limit: number,
): ReviewScheduleEntry[] {
  return Object.values(entries)
    .filter(entry => !entry.graduated && entry.nextDueAt <= now)
    .sort((a, b) => {
      if (a.nextDueAt !== b.nextDueAt) {
        return a.nextDueAt - b.nextDueAt
      }
      if (a.star !== b.star) {
        return a.star - b.star
      }
      if (a.pushCount !== b.pushCount) {
        return a.pushCount - b.pushCount
      }
      return a.wordId.localeCompare(b.wordId)
    })
    .slice(0, Math.max(0, limit))
}

/** Parse an `HH:mm` string to minutes since local midnight. */
export function parseTimeToMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) {
    return 0
  }
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Whether `date` falls inside the quiet window. Handles a window that wraps
 * past midnight (the default 23:00 → 08:00). A window whose bounds are equal
 * is treated as "no quiet hours" rather than "always quiet".
 */
export function isWithinQuietHours(date: Date, quietHours: ReviewQuietHoursConfig): boolean {
  if (!quietHours.enabled) {
    return false
  }

  const start = parseTimeToMinutes(quietHours.start)
  const end = parseTimeToMinutes(quietHours.end)

  if (start === end) {
    return false
  }

  const current = date.getHours() * 60 + date.getMinutes()
  return start < end
    ? current >= start && current < end
    : current >= start || current < end
}

/**
 * The earliest timestamp at or after `date` that is allowed to fire a push.
 * Inside the quiet window this is the moment the window ends.
 */
export function getNextAllowedTimestamp(date: Date, quietHours: ReviewQuietHoursConfig): number {
  if (!isWithinQuietHours(date, quietHours)) {
    return date.getTime()
  }

  const start = parseTimeToMinutes(quietHours.start)
  const end = parseTimeToMinutes(quietHours.end)
  const current = date.getHours() * 60 + date.getMinutes()

  const endDate = new Date(date.getTime())
  endDate.setHours(Math.floor(end / 60), end % 60, 0, 0)

  // A wrapping window that started yesterday ends today; one that starts later
  // today ends tomorrow.
  if (start > end && current >= start) {
    endDate.setDate(endDate.getDate() + 1)
  }

  return endDate.getTime()
}

/** Local calendar day, e.g. `2026-01-31`. */
export function getDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Local midnight starting the following day. */
export function getStartOfNextDay(date: Date): number {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next.getTime()
}

/**
 * When the tick alarm should next wake the service worker.
 *
 * Returns null when the queue holds nothing pushable, so the caller can clear
 * the alarm instead of keeping a timer alive forever.
 */
export function getNextWakeupAt(
  state: ReviewScheduleState,
  reviewConfig: ReviewConfig,
  now: number,
): number | null {
  const pending = Object.values(state.entries)
    .filter(entry => !entry.graduated)
    .map(entry => entry.nextDueAt)

  if (pending.length === 0) {
    return null
  }

  const earliest = Math.min(...pending)
  const dueDate = new Date(Math.max(earliest, now))
  const allowed = getNextAllowedTimestamp(dueDate, reviewConfig.quietHours)

  return Math.max(allowed, now + MIN_ALARM_DELAY_MS)
}
