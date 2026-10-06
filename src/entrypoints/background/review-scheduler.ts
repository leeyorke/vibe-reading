import type { ReviewScheduleState, ReviewTickOutcome } from "@/types/review"
import { browser } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import {
  MAX_DEFERRALS_PER_TICK,
  MAX_PUSHES_PER_TICK,
  REVIEW_TICK_ALARM,
} from "@/utils/constants/review"
import { logger } from "@/utils/logger"
import { openReviewCard } from "@/utils/navigation"
import { buildExample } from "@/utils/review/example-generator"
import {
  clearReviewNotification,
  createReviewNotification,
  forgetNotification,
  getNotificationWordId,
} from "@/utils/review/notify"
import { syncReviewQueue } from "@/utils/review/queue-sync"
import {
  advanceStage,
  applyAdvancedStage,
  getBackoffMs,
  getDayKey,
  getNextAllowedTimestamp,
  getNextWakeupAt,
  getStartOfNextDay,
  isWithinQuietHours,
  pickDueEntries,
} from "@/utils/review/schedule"
import {
  loadNotificationRegistry,
  loadSchedule,
  loadStats,
  pruneNotificationRegistry,
  pruneStats,
  saveNotificationRegistry,
  saveSchedule,
  saveStats,
} from "@/utils/review/store"

/**
 * Keep exactly one alarm alive, aimed at the earliest pushable word.
 *
 * A self-rescheduling one-shot beats a periodic alarm: the service worker only
 * wakes when something is actually due, and quiet hours can move the wake-up
 * instead of merely skipping a fire.
 */
export async function armNextTick(state?: ReviewScheduleState): Promise<void> {
  const config = await getLocalConfig()

  if (!config?.review.enabled) {
    await browser.alarms.clear(REVIEW_TICK_ALARM)
    return
  }

  const schedule = state ?? await loadSchedule()
  const when = getNextWakeupAt(schedule, config.review, Date.now())

  if (when == null) {
    await browser.alarms.clear(REVIEW_TICK_ALARM)
    logger.info("[Review] Queue holds nothing pushable, tick alarm cleared")
    return
  }

  await browser.alarms.create(REVIEW_TICK_ALARM, { when })
  logger.info(`[Review] Next tick armed for ${new Date(when).toISOString()}`)
}

/**
 * Move every due entry to `timestamp`, used for whole-queue deferrals.
 */
function deferEntries(
  schedule: ReviewScheduleState,
  wordIds: Iterable<string>,
  timestamp: number,
): void {
  for (const wordId of wordIds) {
    const entry = schedule.entries[wordId]
    if (entry) {
      schedule.entries[wordId] = { ...entry, nextDueAt: timestamp }
    }
  }
}

/**
 * Deliver every notification that is due right now.
 *
 * The daily caps plus {@link MAX_PUSHES_PER_TICK} keep the worker alive and
 * stop a clock jump or a machine waking from sleep from flooding the
 * notification centre.
 */
export async function runReviewTick(): Promise<ReviewTickOutcome> {
  const now = Date.now()
  const outcome: ReviewTickOutcome = { pushed: 0, failed: 0, deferred: 0, stoppedBecause: null }

  const config = await getLocalConfig()
  if (!config?.review.enabled) {
    await browser.alarms.clear(REVIEW_TICK_ALARM)
    outcome.stoppedBecause = "disabled"
    return outcome
  }

  const schedule = await loadSchedule()
  const stats = pruneStats((await loadStats()).days, new Date(now))
  const todayKey = getDayKey(new Date(now))
  stats[todayKey] ??= { total: 0, perWord: {} }

  const due = pickDueEntries(schedule.entries, now, MAX_PUSHES_PER_TICK + MAX_DEFERRALS_PER_TICK)

  // Quiet hours and the global daily ceiling apply to the whole queue, so the
  // entire backlog moves at once instead of trickling through one tick each.
  if (isWithinQuietHours(new Date(now), config.review.quietHours)) {
    deferEntries(schedule, due.map(e => e.wordId), getNextAllowedTimestamp(new Date(now), config.review.quietHours))
    outcome.deferred = due.length
    outcome.stoppedBecause = "quietHours"
  }
  else if (stats[todayKey].total >= config.review.maxPerDay) {
    deferEntries(schedule, due.map(e => e.wordId), getStartOfNextDay(new Date(now)))
    outcome.deferred = due.length
    outcome.stoppedBecause = "dailyCap"
  }
  else {
    const tomorrowAt = getStartOfNextDay(new Date(now))
    let pushedThisTick = 0

    for (const candidate of due) {
      if (pushedThisTick >= MAX_PUSHES_PER_TICK) {
        break
      }

      if ((stats[todayKey].perWord[candidate.wordId] ?? 0) >= config.review.maxPerWordPerDay) {
        schedule.entries[candidate.wordId] = { ...candidate, nextDueAt: tomorrowAt }
        outcome.deferred++
        // Recorded even though `deferred` is non-zero, because this gate is the
        // only one a caller cannot recognise from the counts alone.
        outcome.stoppedBecause ??= "perWordCap"
        continue
      }

      try {
        const example = await buildExample(candidate, config)
        await createReviewNotification({ entry: candidate, sentence: example.sentence, now })

        const advanced = advanceStage(candidate, "auto", now)
        schedule.entries[candidate.wordId] = {
          ...applyAdvancedStage(candidate, advanced, config.review.graduatedAction, now),
          lastNotifiedAt: now,
          pushCount: candidate.pushCount + 1,
          failureCount: 0,
          lastExample: example.sentence || candidate.lastExample,
          lastSentenceChinese: example.sentenceChinese || candidate.lastSentenceChinese,
          lastCollocations: example.collocations.length > 0 ? example.collocations : candidate.lastCollocations,
          lastAngle: example.angle,
          // Pushed but not yet rated: this is what makes the word eligible for
          // the next review card session.
          pendingReview: true,
        }

        stats[todayKey].total += 1
        stats[todayKey].perWord[candidate.wordId] = (stats[todayKey].perWord[candidate.wordId] ?? 0) + 1
        pushedThisTick++
        outcome.pushed++
      }
      catch (error) {
        // A failed push must not consume the word's place in the ladder.
        const failureCount = candidate.failureCount + 1
        schedule.entries[candidate.wordId] = {
          ...candidate,
          failureCount,
          nextDueAt: now + getBackoffMs(failureCount - 1),
        }
        outcome.failed++
        logger.error(`[Review] Failed to push "${candidate.word}":`, error)
      }
    }
  }

  // Nothing happened at all and no gate claimed the pass, so the queue itself is
  // empty. Every other cause sets `stoppedBecause` on the way out.
  if (outcome.stoppedBecause == null && outcome.pushed === 0 && outcome.deferred === 0 && outcome.failed === 0) {
    outcome.stoppedBecause = "nothingDue"
  }

  await saveSchedule(schedule)
  await saveStats({ days: stats })
  await saveNotificationRegistry(
    pruneNotificationRegistry(await loadNotificationRegistry(), now),
  )
  await armNextTick(schedule)

  logger.info(`[Review] Tick finished: ${JSON.stringify(outcome)}`)
  return outcome
}

/**
 * Wire the scheduler into the background worker.
 *
 * `defineBackground` re-runs this on every worker wake-up, so it must stay
 * idempotent. Both steps here are self-correcting rather than stateful: the
 * sync is throttled internally, and `armNextTick` always recomputes the wake-up
 * from storage, so whichever of the startup path and the alarm listener finishes
 * last leaves the same correct alarm behind.
 */
export function setupReviewScheduler(): void {
  void (async () => {
    try {
      const config = await getLocalConfig()
      if (!config?.review.enabled) {
        // Feature dark: clear whatever alarm an earlier session left behind,
        // then stop. Syncing here would hit the backend on every worker
        // wake-up — and the worker wakes for translation messages too, so a
        // disabled feature would put a vocabulary fetch in front of every
        // dictionary lookup. The first sync after enabling happens on the
        // next wake, or from the /review page's manual sync.
        await browser.alarms.clear(REVIEW_TICK_ALARM)
        return
      }

      // Picks up words reviewed since the last sync — including the very first
      // sync after the feature is enabled — so a newly reviewable word cannot
      // sit unnoticed behind an alarm aimed at an older due time.
      await syncReviewQueue()
      await armNextTick()
    }
    catch (error) {
      logger.warn("[Review] Scheduler startup failed:", error)
    }
  })()

  // Drop notification payloads left over from a previous browser session.
  void (async () => {
    try {
      await saveNotificationRegistry(
        pruneNotificationRegistry(await loadNotificationRegistry(), Date.now()),
      )
    }
    catch (error) {
      logger.warn("[Review] Startup notification cleanup failed:", error)
    }
  })()

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REVIEW_TICK_ALARM) {
      return
    }
    void runReviewTick().catch((error) => {
      logger.error("[Review] Tick crashed:", error)
    })
  })

  // A notification carries no buttons: it is a doorbell. Clicking it opens the
  // review card for the word it announced, where the rating buttons live.
  browser.notifications.onClicked.addListener((notificationId) => {
    void (async () => {
      const wordId = await getNotificationWordId(notificationId)
      await forgetNotification(notificationId)
      await clearReviewNotification(notificationId)

      if (!wordId) {
        logger.warn(`[Review] Click on unknown notification "${notificationId}"`)
        return
      }

      await openReviewCard(wordId)
    })().catch((error) => {
      logger.error("[Review] Notification click handling failed:", error)
    })
  })

  // Dismissing a notification is not a verdict: the word keeps its schedule.
  browser.notifications.onClosed.addListener((notificationId) => {
    void forgetNotification(notificationId).catch((error) => {
      logger.warn("[Review] Failed to forget closed notification:", error)
    })
  })

  browser.runtime.onStartup.addListener(() => {
    void armNextTick()
  })

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.config) {
      return
    }
    // Toggling the feature, or changing quiet hours or quotas, has to re-aim
    // the alarm; otherwise the previously scheduled wake-up survives.
    void armNextTick()
  })
}
