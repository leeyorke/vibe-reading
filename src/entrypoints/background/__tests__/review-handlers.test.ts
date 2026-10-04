import type { Config } from "@/types/config/config"
import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing"
import { storage } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { SRS_INTERVALS_MINUTES } from "@/utils/constants/review"
import {
  REVIEW_NOTIFICATIONS_KEY,
  REVIEW_SCHEDULE_KEY,
} from "@/utils/constants/storage-keys"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const armNextTickMock = vi.fn()
const runReviewTickMock = vi.fn()
const syncReviewQueueMock = vi.fn()
const openReviewCardMock = vi.fn()
const onMessageMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: (...args: unknown[]) => onMessageMock(...args),
}))

vi.mock("../review-scheduler", () => ({
  armNextTick: (...args: unknown[]) => armNextTickMock(...args),
  runReviewTick: (...args: unknown[]) => runReviewTickMock(...args),
}))

vi.mock("@/utils/review/queue-sync", () => ({
  syncReviewQueue: (...args: unknown[]) => syncReviewQueueMock(...args),
}))

vi.mock("@/utils/navigation", () => ({
  openOptionsPage: vi.fn(),
  openReviewCard: (...args: unknown[]) => openReviewCardMock(...args),
}))

vi.mock("@/utils/review/notify", () => ({
  hasNotificationPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/utils/dict/dict-api", () => ({
  queryWordDefinitionExact: vi.fn().mockResolvedValue(null),
}))

const alarmsClearMock = vi.fn()
Object.assign(fakeBrowser.alarms, { clear: alarmsClearMock })

const { setupReviewMessageHandlers } = await import("../review-handlers")

const NOW = Date.now()
const MINUTE = 60_000

type Handler = (message: { data?: unknown }) => Promise<unknown>

/** Collect the handlers the module registers, keyed by message name. */
function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  onMessageMock.mockImplementation((name: string, handler: Handler) => {
    handlers.set(name, handler)
  })

  setupReviewMessageHandlers()
  return handlers
}

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的；转瞬即逝的",
    star: 3,
    stage: 1,
    nextDueAt: NOW + 30 * MINUTE,
    pushCount: 1,
    failureCount: 0,
    lastNotifiedAt: NOW - 10_000,
    pendingReview: true,
    syncedAt: NOW,
    ...overrides,
  }
}

function makeConfig(): Config {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    review: { ...structuredClone(DEFAULT_CONFIG.review), enabled: true },
  }
}

async function seed(entries: Record<string, ReviewScheduleEntry>) {
  await storage.setItem(REVIEW_SCHEDULE_KEY, { version: 1, entries } satisfies ReviewScheduleState)
  await storage.setItem(REVIEW_NOTIFICATIONS_KEY, {})
}

async function readSchedule(): Promise<ReviewScheduleState> {
  return await storage.getItem(REVIEW_SCHEDULE_KEY) as ReviewScheduleState
}

describe("review card message handlers", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    alarmsClearMock.mockResolvedValue(true)
    await storage.setItem(`local:config`, makeConfig())
  })

  describe("getReviewCard", () => {
    it("returns the requested word so a notification click opens the right card", async () => {
      await seed({ w1: makeEntry(), w2: makeEntry({ wordId: "w2", word: "ubiquitous" }) })
      const handler = captureHandlers().get("getReviewCard")!

      const card = await handler({ data: { wordId: "w2" } }) as { word: string }

      expect(card.word).toBe("ubiquitous")
    })

    it("continues the session with the oldest unrated word when no word is given", async () => {
      await seed({
        newer: makeEntry({ wordId: "newer", lastNotifiedAt: NOW - 1_000 }),
        older: makeEntry({ wordId: "older", lastNotifiedAt: NOW - 9_000 }),
      })
      const handler = captureHandlers().get("getReviewCard")!

      const card = await handler({ data: {} }) as { wordId: string, pendingCount: number }

      expect(card.wordId).toBe("older")
      expect(card.pendingCount).toBe(2)
    })

    it("returns null once every pushed word has been rated", async () => {
      await seed({ w1: makeEntry({ pendingReview: false }) })
      const handler = captureHandlers().get("getReviewCard")!

      expect(await handler({ data: {} })).toBeNull()
    })

    it("returns null for a word that has left the queue", async () => {
      await seed({ w1: makeEntry() })
      const handler = captureHandlers().get("getReviewCard")!

      expect(await handler({ data: { wordId: "deleted" } })).toBeNull()
    })
  })

  describe("rateReviewWord", () => {
    it("climbs two rungs, clears the pending flag and hands back the next card", async () => {
      await seed({
        w1: makeEntry({ stage: 1 }),
        w2: makeEntry({ wordId: "w2", lastNotifiedAt: NOW - 1_000 }),
      })
      const handler = captureHandlers().get("rateReviewWord")!

      const next = await handler({ data: { wordId: "w1", kind: "remembered" } }) as { wordId: string, pendingCount: number }

      const entry = (await readSchedule()).entries.w1
      expect(entry.stage).toBe(3)
      expect(entry.pendingReview).toBe(false)
      // The next due time moved with the stage.
      expect(entry.nextDueAt).toBeGreaterThan(NOW + SRS_INTERVALS_MINUTES[2] * MINUTE - 5_000)
      // And the session moved on rather than dead-ending.
      expect(next.wordId).toBe("w2")
      expect(next.pendingCount).toBe(1)
    })

    it("drops one rung when the word was forgotten", async () => {
      await seed({ w1: makeEntry({ stage: 4 }) })
      const handler = captureHandlers().get("rateReviewWord")!

      await handler({ data: { wordId: "w1", kind: "forgotten" } })

      expect((await readSchedule()).entries.w1.stage).toBe(3)
    })

    it("never returns the same word twice in one session", async () => {
      await seed({ w1: makeEntry() })
      const handler = captureHandlers().get("rateReviewWord")!

      expect(await handler({ data: { wordId: "w1", kind: "remembered" } })).toBeNull()
    })

    it("re-aims the pending alarm, because the verdict moved the next push", async () => {
      await seed({ w1: makeEntry() })
      const handler = captureHandlers().get("rateReviewWord")!

      await handler({ data: { wordId: "w1", kind: "remembered" } })

      expect(armNextTickMock).toHaveBeenCalledTimes(1)
    })

    it("ignores a rating for a word that is no longer queued", async () => {
      await seed({ w1: makeEntry() })
      const handler = captureHandlers().get("rateReviewWord")!

      expect(await handler({ data: { wordId: "gone", kind: "forgotten" } })).toBeNull()
      expect((await readSchedule()).entries.w1.stage).toBe(1)
    })
  })

  describe("runReviewNow", () => {
    it("runs the scheduler pass and reports what it did", async () => {
      await seed({ w1: makeEntry() })
      runReviewTickMock.mockResolvedValue({ pushed: 2, failed: 0, deferred: 1 })
      const handler = captureHandlers().get("runReviewNow")!

      expect(await handler({})).toEqual({ pushed: 2, failed: 0, deferred: 1 })
      expect(runReviewTickMock).toHaveBeenCalledTimes(1)
    })

    it("turns a scheduler crash into a message the page can show", async () => {
      runReviewTickMock.mockRejectedValue(new Error("worker died"))
      const handler = captureHandlers().get("runReviewNow")!

      await expect(handler({})).rejects.toThrow(/立即推送失败/)
    })
  })

  describe("getReviewStatus", () => {
    it("counts words still waiting for a rating", async () => {
      await seed({
        a: makeEntry({ wordId: "a" }),
        b: makeEntry({ wordId: "b" }),
        rated: makeEntry({ wordId: "rated", pendingReview: false }),
        graduated: makeEntry({ wordId: "graduated", graduated: true }),
      })
      const handler = captureHandlers().get("getReviewStatus")!

      const status = await handler({}) as { pendingCount: number, queueSize: number }

      expect(status.pendingCount).toBe(2)
      expect(status.queueSize).toBe(3)
    })
  })
})
