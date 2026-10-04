import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import {
  REVIEW_NOTIFICATIONS_KEY,
  REVIEW_SCHEDULE_KEY,
} from "@/utils/constants/storage-keys"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const {
  loadNotificationRegistry,
  loadSchedule,
  loadStats,
  pruneNotificationRegistry,
  pruneStaleEntries,
  pruneStats,
  saveNotificationRegistry,
  saveSchedule,
} = await import("@/utils/review/store")

const NOW = new Date("2026-03-10T12:00:00").getTime()
const DAY_MS = 24 * 60 * 60 * 1000

const storageGetItemMock = vi.fn()
const storageSetItemMock = vi.fn()

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的",
    star: 3,
    stage: 0,
    nextDueAt: NOW,
    pushCount: 0,
    failureCount: 0,
    syncedAt: NOW,
    ...overrides,
  }
}

describe("review store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The WxtVitest plugin backs `#imports` with fake-browser, so the storage
    // object is patched in place rather than module-mocked.
    storage.getItem = storageGetItemMock as never
    storage.setItem = storageSetItemMock as never
    storageGetItemMock.mockResolvedValue(null)
    storageSetItemMock.mockResolvedValue(undefined)
  })

  describe("loadSchedule", () => {
    it("returns an empty queue when nothing is stored", async () => {
      expect(await loadSchedule()).toEqual({ version: 1, entries: {} })
    })

    it("keeps well-formed entries and re-keys them by word id", async () => {
      storageGetItemMock.mockResolvedValue({
        version: 1,
        lastSyncAt: 123,
        entries: { w1: makeEntry({ wordId: "mismatched", word: "re-keyed", stage: 4 }) },
      } satisfies ReviewScheduleState)

      const state = await loadSchedule()

      expect(state.lastSyncAt).toBe(123)
      expect(state.entries.w1.word).toBe("re-keyed")
      expect(state.entries.w1.stage).toBe(4)
    })

    it("drops entries that no longer match the shape instead of failing", async () => {
      storageGetItemMock.mockResolvedValue({
        version: 1,
        entries: {
          good: makeEntry(),
          bad: { wordId: "bad" },
          worse: "not an object",
        },
      })

      const state = await loadSchedule()

      expect(Object.keys(state.entries)).toEqual(["good"])
    })

    it("writes under the namespaced local key", async () => {
      await saveSchedule({ version: 1, entries: {} })

      expect(storageSetItemMock).toHaveBeenCalledWith(REVIEW_SCHEDULE_KEY, { version: 1, entries: {} })
    })
  })

  describe("pruneStaleEntries", () => {
    it("keeps entries a recent sync confirmed and drops the rest", () => {
      const entries = {
        fresh: makeEntry({ wordId: "fresh", syncedAt: NOW - 29 * DAY_MS }),
        stale: makeEntry({ wordId: "stale", syncedAt: NOW - 31 * DAY_MS }),
      }

      expect(Object.keys(pruneStaleEntries(entries, NOW))).toEqual(["fresh"])
    })
  })

  describe("stats", () => {
    it("treats a missing store as empty", async () => {
      expect(await loadStats()).toEqual({ days: {} })
    })

    it("treats a malformed store as empty", async () => {
      storageGetItemMock.mockResolvedValue({ nope: true })

      expect(await loadStats()).toEqual({ days: {} })
    })

    it("keeps only the trailing window of days", async () => {
      storageGetItemMock.mockResolvedValue({
        days: {
          "2026-03-04": { total: 1, perWord: { w1: 1 } },
          "2026-03-09": { total: 2, perWord: { w1: 2 } },
          "2026-03-10": { total: 3, perWord: { w1: 3 } },
          "2026-03-01": { total: 9, perWord: { w1: 9 } },
        },
      })

      const pruned = pruneStats((await loadStats()).days, new Date(2026, 2, 10, 12, 0))

      expect(Object.keys(pruned)).toEqual(["2026-03-04", "2026-03-09", "2026-03-10"])
      expect(pruned["2026-03-10"].perWord.w1).toBe(3)
    })

    it("repairs a day record with missing fields", () => {
      const pruned = pruneStats({ "2026-03-10": {} as never }, new Date(2026, 2, 10, 12, 0))

      expect(pruned["2026-03-10"]).toEqual({ total: 0, perWord: {} })
    })
  })

  describe("notification registry", () => {
    it("treats a missing store as empty", async () => {
      expect(await loadNotificationRegistry()).toEqual({})
    })

    it("forgets payloads older than the retention window", () => {
      const registry = {
        fresh: { wordId: "w1", issuedAt: NOW - 60_000 },
        stale: { wordId: "w2", issuedAt: NOW - 25 * 60 * 60 * 1000 },
        broken: { wordId: "w3" } as never,
      }

      expect(Object.keys(pruneNotificationRegistry(registry, NOW))).toEqual(["fresh"])
    })

    it("round-trips through the namespaced key", async () => {
      await saveNotificationRegistry({ n1: { wordId: "w1", issuedAt: NOW } })

      expect(storageSetItemMock).toHaveBeenCalledWith(REVIEW_NOTIFICATIONS_KEY, {
        n1: { wordId: "w1", issuedAt: NOW },
      })
    })
  })
})
