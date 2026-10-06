import type { Config } from "@/types/config/config"
import type { ReviewScheduleEntry, ReviewScheduleState } from "@/types/review"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  MAX_PUSHES_PER_TICK,
  REVIEW_TICK_ALARM,
  SRS_INTERVALS_MINUTES,
} from "@/utils/constants/review"
import {
  REVIEW_NOTIFICATIONS_KEY,
  REVIEW_SCHEDULE_KEY,
  REVIEW_STATS_KEY,
} from "@/utils/constants/storage-keys"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const openReviewCardMock = vi.fn()
const buildExampleMock = vi.fn()
const syncReviewQueueMock = vi.fn()

vi.mock("@/utils/navigation", () => ({
  openReviewCard: (...args: unknown[]) => openReviewCardMock(...args),
}))

vi.mock("@/utils/review/example-generator", () => ({
  buildExample: (...args: unknown[]) => buildExampleMock(...args),
}))

// The scheduler test must not depend on a vocabulary backend being reachable
// on 127.0.0.1:8000; sync behaviour has its own suite.
vi.mock("@/utils/review/queue-sync", () => ({
  syncReviewQueue: (...args: unknown[]) => syncReviewQueueMock(...args),
}))

const alarmsCreateMock = vi.fn()
const alarmsClearMock = vi.fn()
const alarmsOnAlarmAddListenerMock = vi.fn()
const notificationsCreateMock = vi.fn()
const notificationsClearMock = vi.fn()
const notificationsOnClickedAddListenerMock = vi.fn()
const notificationsOnClosedAddListenerMock = vi.fn()
const storageOnChangedAddListenerMock = vi.fn()
const runtimeOnStartupAddListenerMock = vi.fn()

// fake-browser does not implement the alarms and notifications APIs, so they
// are grafted onto the object `#imports` resolves to.
Object.assign(fakeBrowser.alarms, {
  create: alarmsCreateMock,
  clear: alarmsClearMock,
  onAlarm: { addListener: alarmsOnAlarmAddListenerMock },
})
Object.assign(fakeBrowser.notifications, {
  create: notificationsCreateMock,
  clear: notificationsClearMock,
  onClicked: { addListener: notificationsOnClickedAddListenerMock },
  onClosed: { addListener: notificationsOnClosedAddListenerMock },
})
Object.assign(fakeBrowser.runtime, {
  onStartup: { addListener: runtimeOnStartupAddListenerMock },
  getURL: (path: string) => `chrome-extension://test${path}`,
})
Object.assign(fakeBrowser.storage, {
  onChanged: { addListener: storageOnChangedAddListenerMock },
})

const { runReviewTick, setupReviewScheduler } = await import("../review-scheduler")

const NOW = Date.now()
const TOMORROW_MIDNIGHT = new Date(new Date(NOW).setHours(24, 0, 0, 0)).getTime()
const MINUTE = 60_000

/**
 * `runReviewTick` reads the clock itself, so timestamps it produces land a few
 * milliseconds after this module was evaluated.
 */
function expectAround(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(5_000)
}

/** `HH:mm` of the machine's local clock, shifted by `offsetMinutes`. */
function localClock(offsetMinutes: number): string {
  const date = new Date(NOW + offsetMinutes * MINUTE)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function todayKey(): string {
  const date = new Date(NOW)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的；转瞬即逝的\nadv. 短暂地",
    star: 3,
    stage: 0,
    nextDueAt: NOW - MINUTE,
    pushCount: 0,
    failureCount: 0,
    syncedAt: NOW,
    contextText: "Fame in this industry is ephemeral.",
    ...overrides,
  }
}

function makeConfig(reviewOverrides: Partial<Config["review"]> = {}): Config {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    review: {
      ...structuredClone(DEFAULT_CONFIG.review),
      enabled: true,
      quietHours: { enabled: false, start: "23:00", end: "08:00" },
      ...reviewOverrides,
    },
  }
}

async function seed(config: Config, schedule: ReviewScheduleState, stats: Record<string, unknown> = {}) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  await storage.setItem(REVIEW_SCHEDULE_KEY, schedule)
  await storage.setItem(REVIEW_STATS_KEY, { days: stats })
  await storage.setItem(REVIEW_NOTIFICATIONS_KEY, {})
}

async function readSchedule(): Promise<ReviewScheduleState> {
  return await storage.getItem<ReviewScheduleState>(REVIEW_SCHEDULE_KEY) as ReviewScheduleState
}

async function readStats(): Promise<{ days: Record<string, { total: number, perWord: Record<string, number> }> }> {
  const stats = await storage.getItem(`local:review:stats`)
  return stats as never
}

describe("runReviewTick", () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    alarmsCreateMock.mockResolvedValue(undefined)
    alarmsClearMock.mockResolvedValue(false)
    notificationsCreateMock.mockResolvedValue("n")
    notificationsClearMock.mockResolvedValue(true)
    syncReviewQueueMock.mockResolvedValue({ state: { version: 1, entries: {} }, added: 0, removed: 0 })
    buildExampleMock.mockResolvedValue({
      sentence: "Her joy proved ephemeral.",
      sentenceChinese: "她的快乐果然转瞬即逝。",
      collocations: ["an ephemeral moment", "of ephemeral value"],
      source: "llm",
      angle: "casual slang",
    })

    await seed(makeConfig(), { version: 1, entries: { w1: makeEntry() } })
  })

  it("does nothing but clear the alarm when the feature is off", async () => {
    await seed(makeConfig({ enabled: false }), { version: 1, entries: { w1: makeEntry() } })

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 0, failed: 0, deferred: 0, stoppedBecause: "disabled" })
    expect(notificationsCreateMock).not.toHaveBeenCalled()
    expect(alarmsClearMock).toHaveBeenCalledWith(REVIEW_TICK_ALARM)
  })

  it("pushes a due word with the word as title and the fresh sentence as body", async () => {
    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 1, failed: 0, deferred: 0, stoppedBecause: null })

    const [notificationId, options] = notificationsCreateMock.mock.calls[0]
    expect(notificationId).toMatch(/^vr-w1-/)
    expect(options.type).toBe("basic")
    expect(options.title).toBe("ephemeral")
    expect(options.message).toBe("Her joy proved ephemeral.")
    expect(options.iconUrl).toBe("chrome-extension://test/icon/128.png")
    // Only the first dictionary line becomes the subtitle.
    expect(options.contextMessage).toBe("adj. 短暂的；转瞬即逝的")
    // The notification is a doorbell: Windows shows one line and would render
    // any buttons unreachable, so the rating buttons live on the card instead.
    expect(options.buttons).toBeUndefined()
  })

  it("marks the pushed word as awaiting a rating, with the card's material", async () => {
    await runReviewTick()

    const entry = (await readSchedule()).entries.w1
    expect(entry.pendingReview).toBe(true)
    expect(entry.lastSentenceChinese).toBe("她的快乐果然转瞬即逝。")
    expect(entry.lastCollocations).toEqual(["an ephemeral moment", "of ephemeral value"])
  })

  it("keeps the previous collocations when a later push produced none", async () => {
    await storage.setItem(REVIEW_SCHEDULE_KEY, {
      version: 1,
      entries: { w1: makeEntry({ lastCollocations: ["an old collocation"], lastSentenceChinese: "旧的" }) },
    })
    buildExampleMock.mockResolvedValue({
      sentence: "Plain push.",
      sentenceChinese: "",
      collocations: [],
      source: "context",
      angle: "casual slang",
    })

    await runReviewTick()

    const entry = (await readSchedule()).entries.w1
    expect(entry.lastCollocations).toEqual(["an old collocation"])
    expect(entry.lastSentenceChinese).toBe("旧的")
  })

  it("registers the notification payload so a click survives a worker restart", async () => {
    await runReviewTick()

    const [notificationId] = notificationsCreateMock.mock.calls[0]
    const registry = await storage.getItem<Record<string, { wordId: string }>>(REVIEW_NOTIFICATIONS_KEY)

    expect(registry?.[notificationId]).toEqual({ wordId: "w1", issuedAt: expect.any(Number) })
  })

  it("advances the stage and schedules the next rung", async () => {
    await runReviewTick()

    const entry = (await readSchedule()).entries.w1
    expect(entry.stage).toBe(1)
    expect(entry.pushCount).toBe(1)
    expect(entry.failureCount).toBe(0)
    expectAround(entry.lastNotifiedAt ?? 0, NOW)
    expect(entry.lastExample).toBe("Her joy proved ephemeral.")
    expectAround(entry.nextDueAt, NOW + SRS_INTERVALS_MINUTES[0] * MINUTE)
  })

  it("counts the push against both daily quotas", async () => {
    await runReviewTick()

    const stats = await readStats()
    expect(stats.days[todayKey()]).toEqual({ total: 1, perWord: { w1: 1 } })
  })

  it("falls back to the placeholder body when no sentence could be produced", async () => {
    buildExampleMock.mockResolvedValue({
      sentence: "",
      sentenceChinese: "",
      collocations: [],
      source: "bare",
      angle: "daily conversation",
    })

    await runReviewTick()

    const [, options] = notificationsCreateMock.mock.calls[0]
    expect(options.message).toBe("options.review.notify.quickReview")
    // A bodiless notification must still advance the ladder and stay rateable.
    const entry = (await readSchedule()).entries.w1
    expect(entry.stage).toBe(1)
    expect(entry.pendingReview).toBe(true)
  })

  it("re-arms the alarm at the next due time", async () => {
    await runReviewTick()

    const call = alarmsCreateMock.mock.calls.at(-1)
    expectAround((call?.[1] as { when: number }).when, NOW + SRS_INTERVALS_MINUTES[0] * MINUTE)
  })

  it("keeps the stage and backs off when the notification cannot be created", async () => {
    notificationsCreateMock.mockRejectedValue(new Error("permission denied"))

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 0, failed: 1, deferred: 0, stoppedBecause: null })
    const entry = (await readSchedule()).entries.w1
    expect(entry.stage).toBe(0)
    expect(entry.pushCount).toBe(0)
    expect(entry.failureCount).toBe(1)
    expectAround(entry.nextDueAt, NOW + 2 * MINUTE)
    // A failed delivery must not be counted against either daily quota.
    expect((await readStats()).days[todayKey()]).toEqual({ total: 0, perWord: {} })
  })

  it("doubles the backoff on each consecutive failure", async () => {
    await seed(makeConfig(), {
      version: 1,
      entries: { w1: makeEntry({ failureCount: 2 }) },
    })
    notificationsCreateMock.mockRejectedValue(new Error("permission denied"))

    await runReviewTick()

    const entry = (await readSchedule()).entries.w1
    expect(entry.failureCount).toBe(3)
    expectAround(entry.nextDueAt, NOW + 8 * MINUTE)
  })

  it("pushes at most a fixed batch per tick", async () => {
    await seed(makeConfig(), {
      version: 1,
      entries: Object.fromEntries(
        Array.from({ length: MAX_PUSHES_PER_TICK + 4 }, (_, i) => [
          `w${i}`,
          makeEntry({ wordId: `w${i}`, word: `word${i}` }),
        ]),
      ),
    })

    const outcome = await runReviewTick()

    expect(outcome.pushed).toBe(MAX_PUSHES_PER_TICK)
    expect(notificationsCreateMock).toHaveBeenCalledTimes(MAX_PUSHES_PER_TICK)
  })

  it("defers the whole backlog to the end of quiet hours", async () => {
    await seed(
      makeConfig({
        quietHours: { enabled: true, start: localClock(-30), end: localClock(60) },
      }),
      {
        version: 1,
        entries: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`w${i}`, makeEntry({ wordId: `w${i}`, word: `word${i}` })]),
        ),
      },
    )

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 0, failed: 0, deferred: 10, stoppedBecause: "quietHours" })
    expect(notificationsCreateMock).not.toHaveBeenCalled()

    const deferredTo = (await readSchedule()).entries.w0.nextDueAt
    expect(deferredTo).toBeGreaterThan(NOW)
    expect(deferredTo - NOW).toBeLessThanOrEqual(61 * MINUTE)
  })

  it("defers the whole backlog to tomorrow once the daily cap is reached", async () => {
    await seed(
      makeConfig({ maxPerDay: 2 }),
      {
        version: 1,
        entries: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [`w${i}`, makeEntry({ wordId: `w${i}`, word: `word${i}` })]),
        ),
      },
      { [todayKey()]: { total: 2, perWord: {} } },
    )

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 0, failed: 0, deferred: 5, stoppedBecause: "dailyCap" })
    expect((await readSchedule()).entries.w0.nextDueAt).toBe(TOMORROW_MIDNIGHT)
  })

  it("skips only the word that hit its own daily cap", async () => {
    await seed(
      makeConfig({ maxPerDay: 10, maxPerWordPerDay: 1 }),
      {
        version: 1,
        entries: {
          capped: makeEntry({ wordId: "capped", word: "capped", stage: 3 }),
          fresh: makeEntry({ wordId: "fresh", word: "fresh", star: 5 }),
        },
      },
      { [todayKey()]: { total: 1, perWord: { capped: 1 } } },
    )

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 1, failed: 0, deferred: 1, stoppedBecause: "perWordCap" })
    const schedule = (await readSchedule()).entries
    expect(schedule.capped.stage).toBe(3)
    expect(schedule.capped.nextDueAt).toBe(TOMORROW_MIDNIGHT)
    expect(schedule.fresh.stage).toBe(1)
  })

  it("graduates a word that has walked the whole ladder", async () => {
    await seed(makeConfig(), {
      version: 1,
      entries: { w1: makeEntry({ stage: SRS_INTERVALS_MINUTES.length - 1 }) },
    })

    await runReviewTick()

    expect((await readSchedule()).entries.w1.graduated).toBe(true)
  })

  it("reports an empty queue as such instead of leaving the caller to guess", async () => {
    await seed(makeConfig(), { version: 1, entries: {} })

    const outcome = await runReviewTick()

    expect(outcome.stoppedBecause).toBe("nothingDue")
  })

  it("reports the per-word ceiling, the one gate the caller cannot see from counts", async () => {
    await seed(
      makeConfig({ maxPerDay: 10, maxPerWordPerDay: 1 }),
      { version: 1, entries: { w1: makeEntry() } },
      { [todayKey()]: { total: 1, perWord: { w1: 1 } } },
    )

    const outcome = await runReviewTick()

    expect(outcome).toEqual({ pushed: 0, failed: 0, deferred: 1, stoppedBecause: "perWordCap" })
  })

  it("does not touch words that are not due yet", async () => {
    await seed(makeConfig(), {
      version: 1,
      entries: { w1: makeEntry({ nextDueAt: NOW + 60 * MINUTE }) },
    })

    const outcome = await runReviewTick()

    expect(outcome.pushed).toBe(0)
    const entry = (await readSchedule()).entries.w1
    expect(entry.stage).toBe(0)
    expect(entry.nextDueAt).toBe(NOW + 60 * MINUTE)
  })

  it("clears the alarm when nothing is left to push", async () => {
    await seed(makeConfig(), { version: 1, entries: {} })

    await runReviewTick()

    expect(alarmsClearMock).toHaveBeenCalledWith(REVIEW_TICK_ALARM)
  })
})

describe("setupReviewScheduler", () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    alarmsCreateMock.mockResolvedValue(undefined)
    alarmsClearMock.mockResolvedValue(false)
    notificationsCreateMock.mockResolvedValue("n")
    syncReviewQueueMock.mockResolvedValue({ state: { version: 1, entries: {} }, added: 0, removed: 0 })
    buildExampleMock.mockResolvedValue({ sentence: "A quiet one.", source: "llm", angle: "academic writing" })

    await seed(makeConfig(), {
      version: 1,
      entries: { w1: makeEntry({ nextDueAt: NOW - MINUTE }) },
    })
  })

  it("registers every listener the feature needs", () => {
    setupReviewScheduler()

    expect(alarmsOnAlarmAddListenerMock).toHaveBeenCalledTimes(1)
    expect(notificationsOnClickedAddListenerMock).toHaveBeenCalledTimes(1)
    expect(notificationsOnClosedAddListenerMock).toHaveBeenCalledTimes(1)
    expect(runtimeOnStartupAddListenerMock).toHaveBeenCalledTimes(1)
    expect(storageOnChangedAddListenerMock).toHaveBeenCalledTimes(1)
  })

  it("runs the tick when the review alarm fires and ignores other alarms", async () => {
    setupReviewScheduler()
    const alarmListener = alarmsOnAlarmAddListenerMock.mock.calls[0][0] as (a: { name: string }) => void

    alarmListener({ name: "cache-cleanup" })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notificationsCreateMock).not.toHaveBeenCalled()

    alarmListener({ name: REVIEW_TICK_ALARM })
    await vi.waitFor(() => expect(notificationsCreateMock).toHaveBeenCalledTimes(1))
  })

  it("opens the review card for the announced word when a notification is clicked", async () => {
    await storage.setItem(REVIEW_NOTIFICATIONS_KEY, {
      "vr-w1-123": { wordId: "w1", issuedAt: NOW },
    })
    setupReviewScheduler()
    const clickListener = notificationsOnClickedAddListenerMock.mock.calls[0][0] as (id: string) => void

    clickListener("vr-w1-123")

    await vi.waitFor(() => expect(openReviewCardMock).toHaveBeenCalledWith("w1"))
    expect(notificationsClearMock).toHaveBeenCalledWith("vr-w1-123")
    const registry = await storage.getItem<Record<string, unknown>>(REVIEW_NOTIFICATIONS_KEY)
    expect(registry).not.toHaveProperty("vr-w1-123")
  })

  it("does nothing when a notification click cannot be resolved to a word", async () => {
    setupReviewScheduler()
    const clickListener = notificationsOnClickedAddListenerMock.mock.calls[0][0] as (id: string) => void

    clickListener("vr-unknown")
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(openReviewCardMock).not.toHaveBeenCalled()
  })

  it("treats a dismissed notification as no verdict at all", async () => {
    setupReviewScheduler()
    const closedListener = notificationsOnClosedAddListenerMock.mock.calls[0][0] as (id: string, byUser: boolean) => void

    closedListener("vr-w1-123", true)
    await new Promise(resolve => setTimeout(resolve, 0))

    const entry = (await readSchedule()).entries.w1
    expect(entry.stage).toBe(0)
    expect(entry.pushCount).toBe(0)
  })

  it("re-arms on startup so a word reviewed after the last alarm is not stranded", async () => {
    setupReviewScheduler()

    await vi.waitFor(() => expect(alarmsCreateMock).toHaveBeenCalled())

    const [alarmName, alarmInfo] = alarmsCreateMock.mock.calls.at(-1)!
    expect(alarmName).toBe(REVIEW_TICK_ALARM)
    // The seeded word is already overdue, so the alarm is aimed at the earliest
    // moment the browser will honour rather than at a past timestamp.
    expectAround((alarmInfo as { when: number }).when, NOW + 30_000)
  })

  it("clears a stale alarm when the feature has been switched off", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, makeConfig({ enabled: false }))
    setupReviewScheduler()

    await vi.waitFor(() => expect(alarmsClearMock).toHaveBeenCalledWith(REVIEW_TICK_ALARM))
    expect(alarmsCreateMock).not.toHaveBeenCalled()
  })

  it("leaves the backend alone while the feature is off", async () => {
    // The worker wakes for translation messages too, so a disabled feature
    // must not put a vocabulary fetch in front of every dictionary lookup.
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, makeConfig({ enabled: false }))
    setupReviewScheduler()

    await vi.waitFor(() => expect(alarmsClearMock).toHaveBeenCalledWith(REVIEW_TICK_ALARM))
    expect(syncReviewQueueMock).not.toHaveBeenCalled()
  })

  it("syncs the queue on startup while the feature is on", async () => {
    setupReviewScheduler()

    await vi.waitFor(() => expect(syncReviewQueueMock).toHaveBeenCalledTimes(1))
  })
})
