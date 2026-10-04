import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import type { WordDefinition } from "@/types/vocabulary"
import { beforeEach, describe, expect, it, vi } from "vitest"

const queryWordDefinitionExactMock = vi.fn()

vi.mock("@/utils/dict/dict-api", () => ({
  queryWordDefinitionExact: (...args: unknown[]) => queryWordDefinitionExactMock(...args),
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { buildReviewCardData, countPendingEntries, pickNextPendingEntry } = await import("@/utils/review/review-card")

const NOW = Date.now()

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的；转瞬即逝的",
    star: 3,
    stage: 1,
    nextDueAt: NOW + 60_000,
    pushCount: 1,
    failureCount: 0,
    lastNotifiedAt: NOW,
    pendingReview: true,
    lastExample: "Her joy proved ephemeral.",
    lastSentenceChinese: "她的快乐果然转瞬即逝。",
    lastCollocations: ["an ephemeral moment"],
    syncedAt: NOW,
    ...overrides,
  }
}

function makeState(entries: Record<string, ReviewScheduleEntry>): ReviewScheduleState {
  return { version: 1, entries }
}

describe("pickNextPendingEntry", () => {
  it("returns the oldest push first, so a session drains in arrival order", () => {
    const state = makeState({
      new: makeEntry({ wordId: "new", lastNotifiedAt: NOW - 1_000 }),
      old: makeEntry({ wordId: "old", lastNotifiedAt: NOW - 9_000 }),
    })

    expect(pickNextPendingEntry(state)?.wordId).toBe("old")
  })

  it("skips words that were already rated", () => {
    const state = makeState({
      rated: makeEntry({ wordId: "rated", pendingReview: false, lastNotifiedAt: NOW - 9_000 }),
      waiting: makeEntry({ wordId: "waiting", lastNotifiedAt: NOW - 1_000 }),
    })

    expect(pickNextPendingEntry(state)?.wordId).toBe("waiting")
  })

  it("skips graduated words and unpushed ones", () => {
    const state = makeState({
      graduated: makeEntry({ wordId: "graduated", graduated: true, lastNotifiedAt: NOW - 9_000 }),
      neverPushed: makeEntry({ wordId: "neverPushed", pendingReview: undefined, lastNotifiedAt: undefined }),
    })

    expect(pickNextPendingEntry(state)).toBeUndefined()
  })

  it("honours the exclusion so a rating cannot return the same word twice", () => {
    const state = makeState({
      a: makeEntry({ wordId: "a", lastNotifiedAt: NOW - 9_000 }),
      b: makeEntry({ wordId: "b", lastNotifiedAt: NOW - 1_000 }),
    })

    expect(pickNextPendingEntry(state, "a")?.wordId).toBe("b")
  })

  it("returns undefined once the session is drained", () => {
    expect(pickNextPendingEntry(makeState({ a: makeEntry({ pendingReview: false }) }))).toBeUndefined()
  })
})

describe("countPendingEntries", () => {
  it("counts pushed-but-unrated words only", () => {
    const state = makeState({
      a: makeEntry({ wordId: "a" }),
      b: makeEntry({ wordId: "b" }),
      rated: makeEntry({ wordId: "rated", pendingReview: false }),
      graduated: makeEntry({ wordId: "graduated", graduated: true }),
    })

    expect(countPendingEntries(state)).toBe(2)
  })
})

describe("buildReviewCardData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryWordDefinitionExactMock.mockResolvedValue({
      headword: "ephemeral",
      phoneticUK: "/ɪˈfɛm(ə)r(ə)l/",
      phoneticUS: "/ɪˈfɛmər(ə)l/",
      pos: "adj.",
      senses: [{ number: "1", chineseDefinition: "短暂的" }],
    } satisfies WordDefinition)
  })

  it("looks the word up verbatim, including multi-word phrases", async () => {
    await buildReviewCardData(makeEntry({ word: "in the long run" }), 0)

    expect(queryWordDefinitionExactMock).toHaveBeenCalledWith("in the long run")
  })

  it("carries the push material straight from the entry", async () => {
    const card = await buildReviewCardData(makeEntry(), 3)

    expect(card).toMatchObject({
      wordId: "w1",
      word: "ephemeral",
      translation: "adj. 短暂的；转瞬即逝的",
      example: "Her joy proved ephemeral.",
      sentenceChinese: "她的快乐果然转瞬即逝。",
      collocations: ["an ephemeral moment"],
      pendingCount: 3,
    })
  })

  it("fills the optional sections with empty values when a push produced nothing", async () => {
    const card = await buildReviewCardData(
      makeEntry({ lastExample: undefined, lastSentenceChinese: undefined, lastCollocations: undefined }),
      1,
    )

    expect(card.example).toBe("")
    expect(card.sentenceChinese).toBe("")
    expect(card.collocations).toEqual([])
  })

  it("still returns the card when the dictionary is unreachable", async () => {
    queryWordDefinitionExactMock.mockRejectedValue(new Error("ECONNREFUSED"))

    const card = await buildReviewCardData(makeEntry(), 1)

    // The translation is a local snapshot, so an outage costs audio, not content.
    expect(card.definition).toBeNull()
    expect(card.translation).toBe("adj. 短暂的；转瞬即逝的")
    expect(card.example).toBe("Her joy proved ephemeral.")
  })

  it("passes a 404 through as a missing definition rather than an error", async () => {
    queryWordDefinitionExactMock.mockResolvedValue(null)

    expect((await buildReviewCardData(makeEntry(), 1)).definition).toBeNull()
  })
})
