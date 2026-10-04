import type { ReviewCardData, ReviewStatus } from "@/types/review"
import { browser } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { REVIEW_TICK_ALARM } from "@/utils/constants/review"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { hasNotificationPermission } from "@/utils/review/notify"
import { syncReviewQueue } from "@/utils/review/queue-sync"
import { buildReviewCardData, countPendingEntries, pickNextPendingEntry } from "@/utils/review/review-card"
import { advanceStage, applyAdvancedStage, getDayKey } from "@/utils/review/schedule"
import { synthesizeSpeech } from "@/utils/review/speech"
import {
  loadSchedule,
  loadStats,
  saveNotificationRegistry,
  saveSchedule,
} from "@/utils/review/store"
import { armNextTick, runReviewTick } from "./review-scheduler"

async function buildReviewStatus(): Promise<ReviewStatus> {
  const [config, schedule, stats, permissionGranted] = await Promise.all([
    getLocalConfig(),
    loadSchedule(),
    loadStats(),
    hasNotificationPermission(),
  ])

  const entries = Object.values(schedule.entries)
  const pending = entries.filter(entry => !entry.graduated)
  const todayKey = getDayKey(new Date())

  return {
    enabled: config?.review.enabled ?? false,
    queueSize: pending.length,
    graduatedCount: entries.length - pending.length,
    todayCount: stats.days[todayKey]?.total ?? 0,
    pendingCount: countPendingEntries(schedule),
    nextDueAt: pending.length > 0 ? Math.min(...pending.map(entry => entry.nextDueAt)) : null,
    lastSyncAt: schedule.lastSyncAt,
    permissionGranted,
  }
}

/** Build the card for the oldest unrated word, or `null` when none are left. */
async function nextCardData(excludeWordId?: string): Promise<ReviewCardData | null> {
  const schedule = await loadSchedule()
  const entry = pickNextPendingEntry(schedule, excludeWordId)
  if (!entry) {
    return null
  }

  return await buildReviewCardData(entry, countPendingEntries(schedule))
}

/** Message handlers backing the `/review` options page and the review card. */
export function setupReviewMessageHandlers() {
  onMessage("getReviewStatus", async () => {
    try {
      return await buildReviewStatus()
    }
    catch (error) {
      logger.error("[Review] getReviewStatus failed:", error)
      throw new Error(`获取复习状态失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("syncReviewQueue", async () => {
    try {
      const { state } = await syncReviewQueue({ force: true })
      await armNextTick(state)
      return await buildReviewStatus()
    }
    catch (error) {
      logger.error("[Review] syncReviewQueue failed:", error)
      throw new Error(`同步复习队列失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("clearReviewQueue", async () => {
    try {
      await saveSchedule({ version: 1, entries: {} })
      await saveNotificationRegistry({})
      await browser.alarms.clear(REVIEW_TICK_ALARM)
      return await buildReviewStatus()
    }
    catch (error) {
      logger.error("[Review] clearReviewQueue failed:", error)
      throw new Error(`清空复习队列失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * The card asks for one word. Passing a `wordId` honours the notification the
   * user clicked; omitting it continues the session with the next unrated word.
   */
  onMessage("getReviewCard", async ({ data }) => {
    try {
      const schedule = await loadSchedule()
      const entry = data?.wordId ? schedule.entries[data.wordId] : pickNextPendingEntry(schedule)
      if (!entry) {
        logger.warn(`[Review] No review card for ${data?.wordId ? `word "${data.wordId}"` : "the current queue"}`)
        return null
      }

      return await buildReviewCardData(entry, countPendingEntries(schedule))
    }
    catch (error) {
      logger.error("[Review] getReviewCard failed:", error)
      throw new Error(`获取复习卡片失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * Record the learner's verdict and hand back the next card.
   *
   * Rating and fetching the next word share one round-trip on purpose: a card
   * session is a tight loop of look → judge → next, and two messages would put
   * a visible flash of loading state between every pair of words.
   */
  onMessage("rateReviewWord", async ({ data: { wordId, kind } }) => {
    try {
      const config = await getLocalConfig()
      if (!config) {
        return null
      }

      const now = Date.now()
      const schedule = await loadSchedule()
      const entry = schedule.entries[wordId]
      if (!entry) {
        return null
      }

      schedule.entries[wordId] = {
        ...applyAdvancedStage(entry, advanceStage(entry, kind, now), config.review.graduatedAction, now),
        pendingReview: false,
      }
      await saveSchedule(schedule)
      logger.info(`[Review] "${entry.word}" marked ${kind}, stage is now ${schedule.entries[wordId].stage}`)

      // A rating shifts the next push, so the pending wake-up is now stale.
      await armNextTick(schedule)

      return await nextCardData(wordId)
    }
    catch (error) {
      logger.error("[Review] rateReviewWord failed:", error)
      throw new Error(`提交复习评分失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * Run the scheduler pass on demand, so the card can be tried without waiting
   * out an Ebbinghaus interval.
   *
   * This is the same function the alarm calls — no forced-push path that would
   * bend the ladder. Quiet hours, daily caps and "nothing is due yet" all apply
   * exactly as they would unattended; the caller reports back what happened.
   */
  onMessage("runReviewNow", async () => {
    try {
      return await runReviewTick()
    }
    catch (error) {
      logger.error("[Review] runReviewNow failed:", error)
      throw new Error(`立即推送失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * Pronunciation runs here rather than in the card page so the audio cache is
   * shared by every open card and the service worker keeps it for the length of
   * a session, rather than each page holding its own copy.
   */
  onMessage("synthesizeSpeech", async ({ data }) => {
    try {
      return await synthesizeSpeech(data)
    }
    catch (error) {
      logger.error("[Review] synthesizeSpeech failed:", error)
      throw new Error(`发音生成失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
