import type { ReviewQuietHoursConfig } from "@/types/config/review"
import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { SRS_INTERVALS_MINUTES } from "@/utils/constants/review"
import {
  advanceStage,
  applyAdvancedStage,
  getBackoffMs,
  getDayKey,
  getIntervalMs,
  getNextAllowedTimestamp,
  getNextWakeupAt,
  getStartOfNextDay,
  isWithinQuietHours,
  parseTimeToMinutes,
  pickDueEntries,
} from "@/utils/review/schedule"

const NOW = new Date("2026-03-10T12:00:00").getTime()

const QUIET_OFF_MIDNIGHT: ReviewQuietHoursConfig = { enabled: false, start: "23:00", end: "08:00" }
const QUIET_NIGHT: ReviewQuietHoursConfig = { enabled: true, start: "23:00", end: "08:00" }
const QUIET_DAYTIME: ReviewQuietHoursConfig = { enabled: true, start: "08:00", end: "23:00" }

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

describe("advanceStage", () => {
  it("waits the current rung before moving up one", () => {
    const advanced = advanceStage(makeEntry({ stage: 2 }), "auto", NOW)

    expect(advanced.nextDueAt).toBe(NOW + SRS_INTERVALS_MINUTES[2] * 60_000)
    expect(advanced.stage).toBe(3)
    expect(advanced.graduated).toBe(false)
  })

  it("graduates once the ladder is exhausted", () => {
    const lastStage = SRS_INTERVALS_MINUTES.length - 1
    const advanced = advanceStage(makeEntry({ stage: lastStage }), "auto", NOW)

    expect(advanced.nextDueAt).toBe(NOW + SRS_INTERVALS_MINUTES[lastStage] * 60_000)
    expect(advanced.graduated).toBe(true)
  })

  it("skips a rung when the user says they remembered it", () => {
    const advanced = advanceStage(makeEntry({ stage: 1 }), "remembered", NOW)

    expect(advanced.stage).toBe(3)
    expect(advanced.nextDueAt).toBe(NOW + SRS_INTERVALS_MINUTES[2] * 60_000)
    expect(advanced.graduated).toBe(false)
  })

  it("drops back a rung without falling below the first", () => {
    const dropped = advanceStage(makeEntry({ stage: 3 }), "forgotten", NOW)
    expect(dropped.stage).toBe(2)
    expect(dropped.nextDueAt).toBe(NOW + SRS_INTERVALS_MINUTES[2] * 60_000)

    const floored = advanceStage(makeEntry({ stage: 0 }), "forgotten", NOW)
    expect(floored.stage).toBe(0)
    expect(floored.graduated).toBe(false)
  })
})

describe("applyAdvancedStage", () => {
  it("stops pushing a graduated word by default", () => {
    const advanced = advanceStage(makeEntry({ stage: SRS_INTERVALS_MINUTES.length - 1 }), "auto", NOW)
    const entry = applyAdvancedStage(makeEntry({ stage: 7 }), advanced, "stop", NOW)

    expect(entry.graduated).toBe(true)
  })

  it("re-enters the ladder from the first rung when configured to restart", () => {
    const advanced = advanceStage(makeEntry({ stage: SRS_INTERVALS_MINUTES.length - 1 }), "auto", NOW)
    const entry = applyAdvancedStage(
      makeEntry({ stage: 7, pushCount: 8 }),
      advanced,
      "restart",
      NOW,
    )

    expect(entry.graduated).toBe(false)
    expect(entry.stage).toBe(0)
    expect(entry.pushCount).toBe(0)
    expect(entry.nextDueAt).toBe(NOW + SRS_INTERVALS_MINUTES[0] * 60_000)
  })
})

describe("getBackoffMs", () => {
  it("doubles per consecutive failure and caps at the maximum", () => {
    expect(getBackoffMs(0)).toBe(2 * 60_000)
    expect(getBackoffMs(1)).toBe(4 * 60_000)
    expect(getBackoffMs(2)).toBe(8 * 60_000)
    expect(getBackoffMs(10)).toBe(30 * 60_000)
    expect(getBackoffMs(50)).toBe(30 * 60_000)
  })
})

describe("getIntervalMs", () => {
  it("follows the classic Ebbinghaus ladder", () => {
    expect(getIntervalMs(0)).toBe(5 * 60_000)
    expect(getIntervalMs(7)).toBe(15 * 24 * 60 * 60 * 1000)
    expect(getIntervalMs(99)).toBe(getIntervalMs(7))
  })
})

describe("pickDueEntries", () => {
  it("only returns entries that are due and not graduated", () => {
    const entries = {
      due: makeEntry({ wordId: "due", nextDueAt: NOW - 1 }),
      later: makeEntry({ wordId: "later", nextDueAt: NOW + 60_000 }),
      done: makeEntry({ wordId: "done", nextDueAt: NOW - 1, graduated: true }),
    }

    expect(pickDueEntries(entries, NOW, 10).map(e => e.wordId)).toEqual(["due"])
  })

  it("breaks ties on star ascending, then fewest pushes", () => {
    const entries = {
      hard: makeEntry({ wordId: "hard", star: 1, pushCount: 5 }),
      medium: makeEntry({ wordId: "medium", star: 3, pushCount: 1 }),
      easySameStar: makeEntry({ wordId: "easySameStar", star: 3, pushCount: 9 }),
    }

    expect(pickDueEntries(entries, NOW, 10).map(e => e.wordId)).toEqual([
      "hard",
      "medium",
      "easySameStar",
    ])
  })

  it("respects the limit", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [id(i), makeEntry({ wordId: id(i), nextDueAt: NOW - i })]),
    )

    expect(pickDueEntries(entries, NOW, 3)).toHaveLength(3)
  })
})

function id(index: number): string {
  return `w${index}`
}

describe("quiet hours", () => {
  it("parses 24-hour times", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0)
    expect(parseTimeToMinutes("08:30")).toBe(510)
    expect(parseTimeToMinutes("23:59")).toBe(1439)
    expect(parseTimeToMinutes("bogus")).toBe(0)
  })

  it("treats a window that wraps past midnight as continuous", () => {
    expect(isWithinQuietHours(new Date(2026, 2, 10, 22, 59), QUIET_NIGHT)).toBe(false)
    expect(isWithinQuietHours(new Date(2026, 2, 10, 23, 0), QUIET_NIGHT)).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 2, 10, 23, 59), QUIET_NIGHT)).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 2, 11, 0, 30), QUIET_NIGHT)).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 2, 11, 7, 59), QUIET_NIGHT)).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 2, 11, 8, 0), QUIET_NIGHT)).toBe(false)
  })

  it("handles a same-day window", () => {
    expect(isWithinQuietHours(new Date(2026, 2, 10, 9, 0), QUIET_DAYTIME)).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 2, 10, 23, 0), QUIET_DAYTIME)).toBe(false)
  })

  it("never applies when disabled or when both bounds match", () => {
    expect(isWithinQuietHours(new Date(2026, 2, 10, 23, 30), QUIET_OFF_MIDNIGHT)).toBe(false)
    expect(isWithinQuietHours(new Date(2026, 2, 10, 23, 30), { enabled: true, start: "08:00", end: "08:00" })).toBe(false)
  })

  it("defers to the end of the window", () => {
    const lateNight = new Date(2026, 2, 10, 23, 30)
    const deferred = new Date(getNextAllowedTimestamp(lateNight, QUIET_NIGHT))

    expect(deferred.getDate()).toBe(11)
    expect(deferred.getHours()).toBe(8)
    expect(deferred.getMinutes()).toBe(0)
  })

  it("defers to later today when the window started yesterday", () => {
    const smallHours = new Date(2026, 2, 10, 2, 15)
    const deferred = new Date(getNextAllowedTimestamp(smallHours, QUIET_NIGHT))

    expect(deferred.getDate()).toBe(10)
    expect(deferred.getHours()).toBe(8)
  })

  it("returns the original timestamp outside the window", () => {
    const noon = new Date(2026, 2, 10, 12, 0)
    expect(getNextAllowedTimestamp(noon, QUIET_NIGHT)).toBe(noon.getTime())
  })
})

describe("calendar helpers", () => {
  it("keys days by the local calendar date", () => {
    expect(getDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(getDayKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31")
  })

  it("starts the next day at local midnight", () => {
    const next = new Date(getStartOfNextDay(new Date(2026, 2, 10, 23, 59)))
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(0)
  })
})

describe("getNextWakeupAt", () => {
  const reviewConfig = { ...DEFAULT_CONFIG.review, enabled: true, quietHours: QUIET_OFF_MIDNIGHT }

  it("returns null when nothing is pushable", () => {
    const empty: ReviewScheduleState = { version: 1, entries: {} }
    expect(getNextWakeupAt(empty, reviewConfig, NOW)).toBeNull()
  })

  it("returns null when every entry has graduated", () => {
    const state: ReviewScheduleState = {
      version: 1,
      entries: { a: makeEntry({ wordId: "a", graduated: true }) },
    }
    expect(getNextWakeupAt(state, reviewConfig, NOW)).toBeNull()
  })

  it("never schedules in the past and never closer than the browser floor", () => {
    const state: ReviewScheduleState = {
      version: 1,
      entries: { a: makeEntry({ wordId: "a", nextDueAt: NOW - 10 * 60_000 }) },
    }

    expect(getNextWakeupAt(state, reviewConfig, NOW)).toBeGreaterThanOrEqual(NOW + 30_000)
  })

  it("pulls a future wake-up that falls inside quiet hours to the window end", () => {
    const lateNight = new Date(2026, 2, 10, 23, 30).getTime()
    const state: ReviewScheduleState = {
      version: 1,
      entries: { a: makeEntry({ wordId: "a", nextDueAt: lateNight + 60_000 }) },
    }

    const when = getNextWakeupAt(state, { ...reviewConfig, quietHours: QUIET_NIGHT }, lateNight)
    const woken = new Date(when!)

    expect(woken.getDate()).toBe(11)
    expect(woken.getHours()).toBe(8)
  })
})
