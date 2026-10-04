import type {
  ReviewNotificationRegistry,
  ReviewScheduleEntry,
  ReviewScheduleState,
  ReviewStatsState,
} from "@/types/review"
import { storage } from "#imports"
import { ENTRY_TTL_DAYS, NOTIFICATION_TTL_MS, STATS_TTL_DAYS } from "@/utils/constants/review"
import {
  REVIEW_NOTIFICATIONS_KEY,
  REVIEW_SCHEDULE_KEY,
  REVIEW_STATS_KEY,
} from "@/utils/constants/storage-keys"
import { logger } from "@/utils/logger"
import { getDayKey } from "@/utils/review/schedule"

const DAY_MS = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isScheduleEntry(value: unknown): value is ReviewScheduleEntry {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.wordId === "string"
    && typeof value.word === "string"
    && typeof value.translation === "string"
    && typeof value.stage === "number"
    && typeof value.nextDueAt === "number"
    && typeof value.pushCount === "number"
    && typeof value.failureCount === "number"
}

/**
 * Read the schedule, discarding anything that does not match the current
 * shape. A partially corrupt queue should degrade to "fewer words", never to
 * a scheduler crash on every tick.
 */
export async function loadSchedule(): Promise<ReviewScheduleState> {
  const stored = await storage.getItem<ReviewScheduleState>(REVIEW_SCHEDULE_KEY)
  if (!isRecord(stored)) {
    return { version: 1, entries: {} }
  }

  const entries: Record<string, ReviewScheduleEntry> = {}
  for (const [wordId, entry] of Object.entries(stored.entries ?? {})) {
    if (isScheduleEntry(entry)) {
      entries[wordId] = { ...entry, wordId }
    }
    else {
      logger.warn(`[Review] Dropping malformed schedule entry: ${wordId}`)
    }
  }

  return {
    version: 1,
    entries,
    ...(typeof stored.lastSyncAt === "number" && { lastSyncAt: stored.lastSyncAt }),
  }
}

export async function saveSchedule(state: ReviewScheduleState): Promise<void> {
  await storage.setItem<ReviewScheduleState>(REVIEW_SCHEDULE_KEY, state)
}

/** Drop entries no sync has confirmed for {@link ENTRY_TTL_DAYS}. */
export function pruneStaleEntries(
  entries: Record<string, ReviewScheduleEntry>,
  now: number,
): Record<string, ReviewScheduleEntry> {
  const cutoff = now - ENTRY_TTL_DAYS * DAY_MS
  const result: Record<string, ReviewScheduleEntry> = {}

  for (const [wordId, entry] of Object.entries(entries)) {
    if ((entry.syncedAt ?? 0) >= cutoff) {
      result[wordId] = entry
    }
  }

  return result
}

export async function loadStats(): Promise<ReviewStatsState> {
  const stored = await storage.getItem<ReviewStatsState>(REVIEW_STATS_KEY)
  if (!isRecord(stored) || !isRecord(stored.days)) {
    return { days: {} }
  }
  return { days: stored.days as ReviewStatsState["days"] }
}

export async function saveStats(state: ReviewStatsState): Promise<void> {
  await storage.setItem<ReviewStatsState>(REVIEW_STATS_KEY, state)
}

/** Keep only the recent days; quota counters older than that are meaningless. */
export function pruneStats(days: ReviewStatsState["days"], now: Date): ReviewStatsState["days"] {
  const cutoff = new Date(now.getTime())
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (STATS_TTL_DAYS - 1))

  const cutoffKey = getDayKey(cutoff)

  const result: ReviewStatsState["days"] = {}
  for (const [key, value] of Object.entries(days)) {
    if (key >= cutoffKey && isRecord(value)) {
      result[key] = {
        total: typeof value.total === "number" ? value.total : 0,
        perWord: isRecord(value.perWord) ? value.perWord as Record<string, number> : {},
      }
    }
  }

  return result
}

export async function loadNotificationRegistry(): Promise<ReviewNotificationRegistry> {
  const stored = await storage.getItem<ReviewNotificationRegistry>(REVIEW_NOTIFICATIONS_KEY)
  if (!isRecord(stored)) {
    return {}
  }
  return stored as ReviewNotificationRegistry
}

export async function saveNotificationRegistry(registry: ReviewNotificationRegistry): Promise<void> {
  await storage.setItem<ReviewNotificationRegistry>(REVIEW_NOTIFICATIONS_KEY, registry)
}

export function pruneNotificationRegistry(
  registry: ReviewNotificationRegistry,
  now: number,
): ReviewNotificationRegistry {
  const result: ReviewNotificationRegistry = {}
  for (const [id, payload] of Object.entries(registry)) {
    if (isRecord(payload) && typeof payload.issuedAt === "number" && now - payload.issuedAt < NOTIFICATION_TTL_MS) {
      result[id] = payload as ReviewNotificationRegistry[string]
    }
  }
  return result
}
