import type { Config } from "@/types/config/config"
import type { ReviewScheduleEntry } from "@/types/review"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { EXAMPLE_COLLOCATION_LIMIT, REVIEW_EXAMPLE_ANGLES } from "@/utils/constants/review"

const generateTextMock = vi.fn()
const getModelByIdMock = vi.fn()
const getProviderOptionsWithOverrideMock = vi.fn()

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}))

vi.mock("@/utils/providers/model", () => ({
  getModelById: (...args: unknown[]) => getModelByIdMock(...args),
}))

vi.mock("@/utils/providers/options", () => ({
  getProviderOptionsWithOverride: (...args: unknown[]) => getProviderOptionsWithOverrideMock(...args),
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { buildExample, parseExamplePayload, selectAngle } = await import("@/utils/review/example-generator")

const NOW = new Date("2026-03-10T12:00:00").getTime()

function makeEntry(overrides: Partial<ReviewScheduleEntry> = {}): ReviewScheduleEntry {
  return {
    wordId: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的；转瞬即逝的",
    star: 3,
    stage: 0,
    nextDueAt: NOW,
    pushCount: 0,
    failureCount: 0,
    syncedAt: NOW,
    contextText: "Fame in this industry is ephemeral.",
    ...overrides,
  }
}

function makeConfig(overrides: Partial<Config["review"]> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    review: { ...DEFAULT_CONFIG.review, enabled: true, generateExample: true, ...overrides },
  }
}

function mockPayload(overrides: Record<string, unknown> = {}) {
  return {
    text: JSON.stringify({
      sentence: "The memo was written in an ephemeral style.",
      sentenceChinese: "这份备忘录写得很短暂。",
      collocations: ["an ephemeral moment", "of ephemeral value"],
      ...overrides,
    }),
  }
}

describe("selectAngle", () => {
  it("always moves to a different angle on the next push of the same word", () => {
    const entry = makeEntry()

    for (let stage = 0; stage < REVIEW_EXAMPLE_ANGLES.length * 2; stage++) {
      const current = selectAngle({ ...entry, stage })
      const next = selectAngle({ ...entry, stage: stage + 1 })
      expect(next).not.toBe(current)
    }
  })

  it("always lands on a known angle", () => {
    for (let stage = 0; stage < 12; stage++) {
      expect(REVIEW_EXAMPLE_ANGLES).toContain(selectAngle(makeEntry({ stage })))
    }
  })
})

describe("parseExamplePayload", () => {
  it("reads a bare JSON object", () => {
    expect(parseExamplePayload("{\"sentence\":\"Rain fell.\",\"sentenceChinese\":\"下雨了。\",\"collocations\":[\"falling rain\"]}")).toEqual({
      sentence: "Rain fell.",
      sentenceChinese: "下雨了。",
      collocations: ["falling rain"],
    })
  })

  it("unwraps a markdown code fence", () => {
    const raw = "Sure!\n```json\n{\"sentence\":\"Rain fell.\",\"sentenceChinese\":\"下雨了。\",\"collocations\":[]}\n```"

    expect(parseExamplePayload(raw)?.sentence).toBe("Rain fell.")
  })

  it("ignores commentary wrapped around the object", () => {
    expect(parseExamplePayload("Here you go: {\"sentence\":\"Rain fell.\"} — hope that helps!")?.sentence).toBe("Rain fell.")
  })

  it("strips quotes and numbering the model wraps the sentence in", () => {
    expect(parseExamplePayload("{\"sentence\":\"\\\"1. He made an ephemeral remark.\\\"\"}")?.sentence).toBe("He made an ephemeral remark.")
  })

  it("defaults the optional fields when the model omits them", () => {
    expect(parseExamplePayload("{\"sentence\":\"Rain fell.\"}")).toEqual({
      sentence: "Rain fell.",
      sentenceChinese: "",
      collocations: [],
    })
  })

  it("drops non-string collocations and blanks", () => {
    const payload = parseExamplePayload("{\"sentence\":\"Rain fell.\",\"collocations\":[\"   \", 42, null, \" real rain \"]}")

    expect(payload?.collocations).toEqual(["real rain"])
  })

  it("caps the collocation count", () => {
    const many = Array.from({ length: EXAMPLE_COLLOCATION_LIMIT + 4 }, (_, i) => `"phrase ${i}"`)
    const payload = parseExamplePayload(`{"sentence":"Rain fell.","collocations":[${many.join(",")}]}`)

    expect(payload?.collocations).toHaveLength(EXAMPLE_COLLOCATION_LIMIT)
  })

  it.each([
    ["unparseable JSON", "not json at all"],
    ["no object at all", "Rain fell."],
    ["a JSON array", "[1,2,3]"],
    ["a missing sentence", "{\"sentenceChinese\":\"下雨了。\"}"],
    ["a blank sentence", "{\"sentence\":\"   \"}"],
    ["a non-string sentence", "{\"sentence\":42}"],
    ["an unterminated object", "{\"sentence\":\"Rain fell.\""],
  ])("returns null for %s", (_label, raw) => {
    expect(parseExamplePayload(raw)).toBeNull()
  })
})

describe("buildExample", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelByIdMock.mockResolvedValue({})
    getProviderOptionsWithOverrideMock.mockReturnValue(undefined)
    generateTextMock.mockResolvedValue(mockPayload())
  })

  it("returns the generated material and records the angle it used", async () => {
    const entry = makeEntry({ stage: 2 })

    const example = await buildExample(entry, makeConfig())

    expect(example).toEqual({
      sentence: "The memo was written in an ephemeral style.",
      sentenceChinese: "这份备忘录写得很短暂。",
      collocations: ["an ephemeral moment", "of ephemeral value"],
      source: "llm",
      angle: selectAngle(entry),
    })
  })

  it("passes the previous sentence, angle and collocations to the model as exclusions", async () => {
    await buildExample(
      makeEntry({
        lastExample: "An ephemeral glow faded from the sky.",
        lastAngle: "casual slang",
        lastCollocations: ["an ephemeral glow"],
      }),
      makeConfig(),
    )

    const call = generateTextMock.mock.calls[0][0]
    expect(call.prompt).toContain("An ephemeral glow faded from the sky.")
    expect(call.prompt).toContain("casual slang")
    expect(call.prompt).toContain("an ephemeral glow")
    expect(call.prompt).toContain("Fame in this industry is ephemeral.")
  })

  it("retries at a higher temperature when the model repeats the previous sentence", async () => {
    generateTextMock
      .mockResolvedValueOnce(mockPayload({ sentence: "Fame in this industry is ephemeral." }))
      .mockResolvedValueOnce(mockPayload({ sentence: "Her joy proved ephemeral." }))

    const example = await buildExample(
      makeEntry({ lastExample: "fame in this industry is  ephemeral" }),
      makeConfig(),
    )

    expect(generateTextMock).toHaveBeenCalledTimes(2)
    expect(generateTextMock.mock.calls[1][0].temperature).toBeGreaterThan(
      generateTextMock.mock.calls[0][0].temperature,
    )
    expect(example.sentence).toBe("Her joy proved ephemeral.")
  })

  it("falls back to the collection sentence when the model keeps repeating itself", async () => {
    generateTextMock.mockResolvedValue(mockPayload({ sentence: "Fame in this industry is ephemeral." }))

    const example = await buildExample(
      makeEntry({ lastExample: "Fame in this industry is ephemeral." }),
      makeConfig(),
    )

    expect(generateTextMock).toHaveBeenCalledTimes(2)
    // The card shows no translation or collocations here rather than stale ones.
    expect(example).toEqual({
      sentence: "Fame in this industry is ephemeral.",
      sentenceChinese: "",
      collocations: [],
      source: "context",
      angle: expect.any(String),
    })
  })

  it("falls back to the collection sentence when the model answers with unusable JSON", async () => {
    generateTextMock.mockResolvedValue({ text: "Sure! Here is a sentence: Fame in this industry is ephemeral." })

    const example = await buildExample(makeEntry(), makeConfig())

    expect(generateTextMock).toHaveBeenCalledTimes(2)
    expect(example.source).toBe("context")
  })

  it("falls back to the collection sentence when generation throws", async () => {
    generateTextMock.mockRejectedValue(new Error("no api key"))

    const example = await buildExample(makeEntry(), makeConfig())

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(example.source).toBe("context")
    expect(example.sentence).toBe("Fame in this industry is ephemeral.")
  })

  it("falls back to the collection sentence when generation times out", async () => {
    vi.useFakeTimers()
    generateTextMock.mockReturnValue(new Promise(() => {}))

    const pending = buildExample(makeEntry(), makeConfig())
    await vi.advanceTimersByTimeAsync(20_000)
    const example = await pending

    vi.useRealTimers()
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(example.source).toBe("context")
  })

  it("skips the model entirely when example generation is turned off", async () => {
    const example = await buildExample(makeEntry(), makeConfig({ generateExample: false }))

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(example.source).toBe("context")
  })

  it("produces an empty sentence when there is nothing to fall back to", async () => {
    generateTextMock.mockRejectedValue(new Error("offline"))

    const example = await buildExample(
      makeEntry({ contextText: undefined }),
      makeConfig(),
    )

    expect(example).toEqual({
      sentence: "",
      sentenceChinese: "",
      collocations: [],
      source: "bare",
      angle: expect.any(String),
    })
  })
})
