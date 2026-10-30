import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const {
  buildGoogleTranslateParams,
  clearGoogleTranslateCache,
  parseGoogleTranslateResponse,
  quickTranslateWithGoogle,
  resolveGoogleLang,
} = await import("@/utils/google-translate")

/** The endpoint's real answer shape: nested arrays, one entry per segment. */
function translateResponse(parts: string[]) {
  return new Response(JSON.stringify([parts.map(text => [text, "original", null, null, 1]), null, "en"]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("resolveGoogleLang", () => {
  it("maps the three-letter codes the config stores", () => {
    expect(resolveGoogleLang("eng", "auto")).toBe("en")
    expect(resolveGoogleLang("cmn", "auto")).toBe("zh")
    expect(resolveGoogleLang("jpn", "auto")).toBe("ja")
    expect(resolveGoogleLang("kor", "auto")).toBe("ko")
  })

  it("keeps the Chinese variants apart", () => {
    expect(resolveGoogleLang("cmn-Hant", "auto")).toBe("zh-TW")
  })

  it("falls back per role: a source it cannot place becomes auto, a target becomes Chinese", () => {
    expect(resolveGoogleLang("qqq", "auto")).toBe("auto")
    expect(resolveGoogleLang("qqq", "zh-CN")).toBe("zh-CN")
  })

  it("treats a missing code as the fallback", () => {
    expect(resolveGoogleLang(undefined, "auto")).toBe("auto")
    expect(resolveGoogleLang("", "zh-CN")).toBe("zh-CN")
  })
})

describe("buildGoogleTranslateParams", () => {
  it("names the endpoint's client, the language pair and the text", () => {
    const params = buildGoogleTranslateParams("a fleeting moment", "en", "zh-CN")

    expect(params.get("client")).toBe("gtx")
    expect(params.get("sl")).toBe("en")
    expect(params.get("tl")).toBe("zh-CN")
    expect(params.get("dt")).toBe("t")
    expect(params.get("q")).toBe("a fleeting moment")
  })

  it("truncates rather than letting the request URL grow without bound", () => {
    const params = buildGoogleTranslateParams("a".repeat(9000), "auto", "zh-CN")

    expect(params.get("q")).toHaveLength(5000)
  })
})

describe("parseGoogleTranslateResponse", () => {
  it("joins the sentence segments of a real answer", () => {
    expect(parseGoogleTranslateResponse([
      [["你好", "hello", null, null, 1], ["世界", "world", null, null, 1]],
      null,
      "en",
    ])).toBe("你好世界")
  })

  it("returns null for a body that is not the expected shape", () => {
    expect(parseGoogleTranslateResponse(null)).toBeNull()
    expect(parseGoogleTranslateResponse("nope")).toBeNull()
    expect(parseGoogleTranslateResponse([null, "en"])).toBeNull()
    expect(parseGoogleTranslateResponse([[]])).toBeNull()
  })
})

describe("quickTranslateWithGoogle", () => {
  beforeEach(() => {
    clearGoogleTranslateCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resolves with the translated text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => translateResponse(["答案"])))

    await expect(quickTranslateWithGoogle({ text: " the answer " })).resolves.toBe("答案")
  })

  it("asks for the configured language pair, auto-detecting an auto source", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => translateResponse(["答案"]))
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslateWithGoogle({ text: "ephemeral", sourceLanguageCode: "auto", targetLanguageCode: "cmn" })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get("sl")).toBe("auto")
    expect(url.searchParams.get("tl")).toBe("zh")
  })

  it("serves a repeat selection from cache instead of calling again", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => translateResponse(["答案"]))
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslateWithGoogle({ text: "ephemeral" })
    await quickTranslateWithGoogle({ text: "ephemeral" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps different target languages apart in the cache", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => translateResponse(["答案"]))
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslateWithGoogle({ text: "ephemeral", targetLanguageCode: "cmn" })
    await quickTranslateWithGoogle({ text: "ephemeral", targetLanguageCode: "jpn" })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects an empty selection without calling the endpoint", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(quickTranslateWithGoogle({ text: "   " })).rejects.toThrow("没有选中的文字")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces a non-OK status instead of a blank answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 429 })))

    await expect(quickTranslateWithGoogle({ text: "ephemeral" })).rejects.toThrow("429")
  })

  it("surfaces an unparseable body instead of rendering it into the popover", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("<html>", { status: 200 })))

    await expect(quickTranslateWithGoogle({ text: "ephemeral" })).rejects.toThrow("无法解析")
  })
})
