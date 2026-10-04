import type { ReviewScheduleEntry } from "@/types/review"
import type { VocabularyWord } from "@/types/vocabulary"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { MAX_QUEUE_SIZE, VOCABULARY_PAGE_SIZE } from "@/utils/constants/review"
import { REVIEW_SCHEDULE_KEY } from "@/utils/constants/storage-keys"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const apiGetWordsMock = vi.fn()

vi.mock("@/utils/vocabulary/vocabulary-api", () => ({
  apiGetWords: (...args: unknown[]) => apiGetWordsMock(...args),
}))

const { syncReviewQueue } = await import("@/utils/review/queue-sync")

const NOW = Date.now()

function makeWord(overrides: Partial<VocabularyWord> = {}): VocabularyWord {
  return {
    id: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的",
    star: 3,
    createdAt: NOW,
    reviewCount: 1,
    lastReviewedAt: NOW - 60_000,
    contextText: "Fame in this industry is ephemeral.",
    ...overrides,
  }
}

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "stale copy",
    translation: "old translation",
    star: 1,
    stage: 5,
    nextDueAt: NOW + 999_999,
    pushCount: 3,
    failureCount: 0,
    syncedAt: NOW - 40 * 24 * 60 * 60 * 1000,
    ...overrides,
  }
}

async function writeSchedule(entries: Record<string, ReviewScheduleEntry>, lastSyncAt?: number) {
  await storage.setItem(REVIEW_SCHEDULE_KEY, { version: 1, entries, lastSyncAt })
}

describe("syncReviewQueue", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await storage.removeItem(REVIEW_SCHEDULE_KEY)
    apiGetWordsMock.mockResolvedValue({ words: [makeWord()], total: 1 })
  })

  it("only queues words that have been reviewed at least once", async () => {
    apiGetWordsMock.mockResolvedValue({
      words: [
        makeWord({ id: "reviewed", word: "reviewed" }),
        makeWord({ id: "never", word: "never", lastReviewedAt: undefined }),
      ],
      total: 2,
    })

    const { state, added } = await syncReviewQueue()

    expect(Object.keys(state.entries)).toEqual(["reviewed"])
    expect(added).toBe(1)
  })

  it("starts a new word at stage 0, due immediately", async () => {
    const { state } = await syncReviewQueue()

    expect(state.entries.w1).toMatchObject({
      wordId: "w1",
      word: "ephemeral",
      translation: "adj. 短暂的",
      star: 3,
      stage: 0,
      pushCount: 0,
      failureCount: 0,
    })
    expect(state.entries.w1.nextDueAt).toBeGreaterThan(0)
    expect(state.lastSyncAt).toBeGreaterThan(0)
  })

  it("refreshes an existing word's snapshot without resetting its schedule", async () => {
    await writeSchedule({ w1: makeEntry() })

    const { state, added } = await syncReviewQueue({ force: true })

    expect(added).toBe(0)
    expect(state.entries.w1).toMatchObject({
      // Snapshot comes from the backend…
      word: "ephemeral",
      translation: "adj. 短暂的",
      star: 3,
      // …but the ladder the user has already climbed is untouched.
      stage: 5,
      pushCount: 3,
      nextDueAt: NOW + 999_999,
    })
  })

  it("removes words the backend no longer reports", async () => {
    await writeSchedule({
      w1: makeEntry({ wordId: "w1", syncedAt: NOW }),
      gone: makeEntry({ wordId: "gone", syncedAt: NOW }),
    })

    const { state, removed } = await syncReviewQueue({ force: true })

    expect(Object.keys(state.entries)).toEqual(["w1"])
    expect(removed).toBe(1)
  })

  it("keeps the local queue when the backend is unreachable", async () => {
    await writeSchedule({ w1: makeEntry({ syncedAt: NOW }) })
    apiGetWordsMock.mockRejectedValue(new Error("ECONNREFUSED"))

    const { state, added, removed } = await syncReviewQueue({ force: true })

    expect(added).toBe(0)
    expect(removed).toBe(0)
    expect(Object.keys(state.entries)).toEqual(["w1"])
    // A failed sync must not re-arm the throttling window either.
    expect(state.lastSyncAt).toBeUndefined()
  })

  it("skips the sync entirely inside the throttle window", async () => {
    await writeSchedule({}, NOW)

    const result = await syncReviewQueue()

    expect(apiGetWordsMock).not.toHaveBeenCalled()
    expect(result.added).toBe(0)
  })

  it("paginates until the scan cap is reached", async () => {
    apiGetWordsMock.mockImplementation(({ limit }: { limit: number }) => {
      const offset = (apiGetWordsMock.mock.calls.length - 1) * limit
      const words = Array.from({ length: limit }, (_, i) =>
        makeWord({ id: `w${offset + i}`, word: `word${offset + i}` }))
      return Promise.resolve({ words, total: MAX_QUEUE_SIZE * 2 })
    })

    const { state } = await syncReviewQueue({ force: true })

    expect(Object.keys(state.entries)).toHaveLength(MAX_QUEUE_SIZE)
    expect(apiGetWordsMock.mock.calls[0][0]).toMatchObject({ limit: VOCABULARY_PAGE_SIZE, offset: 0 })
  })

  it("stops paginating once the backend runs out of words", async () => {
    apiGetWordsMock.mockImplementation(({ limit }: { limit: number }) => {
      if (apiGetWordsMock.mock.calls.length === 1) {
        return Promise.resolve({
          words: Array.from({ length: limit }, (_, i) => makeWord({ id: `w${i}` })),
          total: limit,
        })
      }
      return Promise.resolve({ words: [], total: limit })
    })

    const { state } = await syncReviewQueue({ force: true })

    expect(Object.keys(state.entries)).toHaveLength(VOCABULARY_PAGE_SIZE)
    expect(apiGetWordsMock).toHaveBeenCalledTimes(2)
  })
})
