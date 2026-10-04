import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const {
  buildGoogleTtsUrl,
  clearSpeechCache,
  resolveSpeechLang,
  synthesizeSpeech,
} = await import("@/utils/review/speech")

/** Build a Response whose body is a real (tiny) MP3-framed byte array. */
function audioResponse(bytes = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]), contentType = "audio/mpeg") {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } })
}

describe("resolveSpeechLang", () => {
  it("defaults to English, which is what a vocabulary entry almost always is", () => {
    expect(resolveSpeechLang(undefined)).toBe("en-US")
    expect(resolveSpeechLang("")).toBe("en-US")
  })

  it("maps the three-letter codes the vocabulary book stores", () => {
    expect(resolveSpeechLang("eng")).toBe("en-US")
    expect(resolveSpeechLang("zho")).toBe("zh-CN")
    expect(resolveSpeechLang("jpn")).toBe("ja")
    expect(resolveSpeechLang("kor")).toBe("ko")
    expect(resolveSpeechLang("ger")).toBe("de-DE")
    expect(resolveSpeechLang("rus")).toBe("ru-RU")
  })

  it("distinguishes Chinese variants", () => {
    expect(resolveSpeechLang("zho-TW")).toBe("zh-TW")
    expect(resolveSpeechLang("zho-HK")).toBe("zh-TW")
    expect(resolveSpeechLang("zho")).toBe("zh-CN")
  })

  it("falls back to English for a tag it cannot place", () => {
    expect(resolveSpeechLang("qqq")).toBe("en-US")
  })
})

describe("buildGoogleTtsUrl", () => {
  it("escapes the text and names the target language", () => {
    const url = new URL(buildGoogleTtsUrl("black & white", "en-US"))

    expect(url.searchParams.get("q")).toBe("black & white")
    expect(url.searchParams.get("tl")).toBe("en-US")
    expect(url.searchParams.get("client")).toBe("gtx")
  })

  it("truncates rather than letting Google reject an over-long request", () => {
    const url = new URL(buildGoogleTtsUrl("a".repeat(400), "en-US"))

    expect(url.searchParams.get("q")).toHaveLength(190)
  })
})

describe("synthesizeSpeech", () => {
  beforeEach(() => {
    clearSpeechCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches MP3 bytes and returns a playable data URL", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse())
    vi.stubGlobal("fetch", fetchMock)

    const url = await synthesizeSpeech({ text: "ephemeral" })

    // Round-trip the payload rather than trusting a hand-computed constant.
    const [meta, base64] = url.split(",")
    expect(meta).toBe("data:audio/mpeg;base64")
    expect([...Uint8Array.from(atob(base64), c => c.charCodeAt(0))]).toEqual([0xFF, 0xFB, 0x90, 0x00])
    expect(new URL(fetchMock.mock.calls[0][0]).hostname).toBe("translate.google.com")
    // No cookies: the endpoint is anonymous and sending them only leaks them.
    expect(fetchMock.mock.calls[0][1].credentials).toBe("omit")
  })

  it("passes the entry language through to the endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse())
    vi.stubGlobal("fetch", fetchMock)

    await synthesizeSpeech({ text: "学习", sourceLanguage: "zho" })

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("tl")).toBe("zh-CN")
  })

  it("serves a repeated word from the cache instead of asking again", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse())
    vi.stubGlobal("fetch", fetchMock)

    const first = await synthesizeSpeech({ text: "ephemeral" })
    const second = await synthesizeSpeech({ text: "ephemeral" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it("keys the cache by language too, so the same word in two languages differs", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse())
    vi.stubGlobal("fetch", fetchMock)

    await synthesizeSpeech({ text: "review", sourceLanguage: "eng" })
    await synthesizeSpeech({ text: "review", sourceLanguage: "fra" })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("keeps the cache from growing without bound", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse())
    vi.stubGlobal("fetch", fetchMock)

    for (let i = 0; i < 45; i++) {
      await synthesizeSpeech({ text: `word${i}` })
    }
    // The oldest entry is evicted, so the first word costs a second request.
    await synthesizeSpeech({ text: "word0" })

    expect(fetchMock).toHaveBeenCalledTimes(46)
  })

  it("rejects an empty request without touching the network", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(synthesizeSpeech({ text: "   " })).rejects.toThrow(/Nothing to pronounce/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces an HTTP failure instead of caching an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(synthesizeSpeech({ text: "ephemeral" })).rejects.toThrow(/429/)
    // A later attempt must retry rather than replay the failure.
    await expect(synthesizeSpeech({ text: "ephemeral" })).rejects.toThrow(/429/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects a rate-limit page served with a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>rate limited</html>", { status: 200, headers: { "content-type": "text/html" } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(synthesizeSpeech({ text: "ephemeral" })).rejects.toThrow(/non-audio body/)
  })

  it("reports a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    await expect(synthesizeSpeech({ text: "ephemeral" })).rejects.toThrow(/network down/)
  })
})
