import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/utils/config/backend", () => ({
  getBackendBaseUrl: vi.fn().mockResolvedValue("http://127.0.0.1:8000"),
}))

const { queryWordDefinitionExact, queryWordDefinitionStructured } = await import("../dict-api")

const FULL_PAYLOAD = {
  headword: "serendipity",
  id: "serendipity",
  pos: "n.",
  phonetics: { uk: "/ˌserənˈdɪpəti/", us: "/ˌserənˈdɪpəti/" },
  senses: [
    { number: "1", definition: "the occurrence of events by chance", chinese_definition: "机缘巧合", examples: [{ text: "a fortunate stroke of serendipity", chinese: "一次幸运的机缘巧合" }] },
    { number: "2", definition: "the faculty of making discoveries", chinese_definition: "意外发现珍奇事物的本领", examples: [] },
  ],
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("queryWordDefinitionStructured", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps a complete payload", async () => {
    stubFetch(FULL_PAYLOAD)

    const result = await queryWordDefinitionStructured("serendipity")

    expect(result).toEqual({
      headword: "serendipity",
      phoneticUK: "/ˌserənˈdɪpəti/",
      phoneticUS: "/ˌserənˈdɪpəti/",
      pos: "n.",
      senses: [
        { number: "1", englishDefinition: "the occurrence of events by chance", chineseDefinition: "机缘巧合", examples: [{ text: "a fortunate stroke of serendipity", chinese: "一次幸运的机缘巧合" }] },
        { number: "2", englishDefinition: "the faculty of making discoveries", chineseDefinition: "意外发现珍奇事物的本领" },
      ],
    })
  })

  // The dictionary backend is a separate service the user runs locally, and its
  // entries are not uniform: a sense can arrive without an `examples` list. The
  // mapping used to dereference it unguarded and threw
  // "Cannot read properties of undefined (reading 'length')" — which the toolbar
  // then reported as a dead extension context, so the user was told to refresh
  // a page that was never stale.
  it("maps a sense whose payload omits the examples list", async () => {
    stubFetch({
      ...FULL_PAYLOAD,
      senses: [
        { number: "1", definition: "the occurrence of events by chance", chinese_definition: "机缘巧合" },
        { number: "2", definition: "the faculty of making discoveries", chinese_definition: "意外发现珍奇事物的本领" },
      ],
    })

    const result = await queryWordDefinitionStructured("serendipity")

    expect(result?.senses).toEqual([
      { number: "1", englishDefinition: "the occurrence of events by chance", chineseDefinition: "机缘巧合" },
      { number: "2", englishDefinition: "the faculty of making discoveries", chineseDefinition: "意外发现珍奇事物的本领" },
    ])
    expect(result?.senses[0]).not.toHaveProperty("examples")
  })

  it("maps a payload that omits the phonetics block", async () => {
    const { phonetics: _phonetics, ...withoutPhonetics } = FULL_PAYLOAD
    stubFetch(withoutPhonetics)

    const result = await queryWordDefinitionStructured("serendipity")

    expect(result?.phoneticUK).toBeUndefined()
    expect(result?.phoneticUS).toBeUndefined()
    expect(result?.headword).toBe("serendipity")
  })

  it("drops examples whose text is blank", async () => {
    stubFetch({
      ...FULL_PAYLOAD,
      senses: [{
        number: "1",
        definition: "the occurrence of events by chance",
        chinese_definition: "机缘巧合",
        examples: [{ text: "  ", chinese: "空例句" }, { text: "kept", chinese: "保留" }],
      }],
    })

    const result = await queryWordDefinitionStructured("serendipity")

    expect(result?.senses[0].examples).toEqual([{ text: "kept", chinese: "保留" }])
  })

  it("treats a payload without senses as a miss", async () => {
    stubFetch({ ...FULL_PAYLOAD, senses: [] })

    await expect(queryWordDefinitionStructured("serendipity")).resolves.toBeNull()
  })

  it("treats a null body as a miss", async () => {
    stubFetch(null)

    await expect(queryWordDefinitionStructured("serendipity")).resolves.toBeNull()
  })

  it("treats a non-object body as a miss", async () => {
    stubFetch("Internal Server Error")

    await expect(queryWordDefinitionStructured("serendipity")).resolves.toBeNull()
  })

  it("normalises the word before looking it up", async () => {
    const fetchMock = stubFetch(FULL_PAYLOAD)

    await queryWordDefinitionStructured("  Serendipity, ")

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/word/serendipity")
  })

  it("falls through to a miss when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

    await expect(queryWordDefinitionStructured("serendipity")).resolves.toBeNull()
  })
})

describe("queryWordDefinitionExact", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("looks the whole phrase up, without truncating to the first token", async () => {
    const fetchMock = stubFetch(FULL_PAYLOAD)

    await queryWordDefinitionExact("give up")

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/word/give%20up")
  })

  it("maps a sparse phrase payload instead of throwing", async () => {
    stubFetch({
      headword: "give up",
      id: "give-up",
      pos: "phr.",
      phonetics: { uk: "/ɡɪv ʌp/", us: "/ɡɪv ʌp/" },
      senses: [{ number: "1", chinese_definition: "放弃；投降" }],
    })

    const result = await queryWordDefinitionExact("give up")

    expect(result?.headword).toBe("give up")
    expect(result?.senses[0].chineseDefinition).toBe("放弃；投降")
    expect(result?.senses[0]).not.toHaveProperty("examples")
  })
})
