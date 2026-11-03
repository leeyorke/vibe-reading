import { afterEach, describe, expect, it, vi } from "vitest"
import { isRateLimitRequestError } from "@/utils/request/retry-policy"

const {
  buildGoogleTranslateParams,
  parseGoogleTranslateResponse,
  translateWithGoogle,
} = await import("@/utils/google-translate")

/** The endpoint's real answer shape: nested arrays, one entry per segment. */
function translateResponse(parts: string[]) {
  return new Response(JSON.stringify([parts.map(text => [text, "original", null, null, 1]), null, "en"]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

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

describe("translateWithGoogle", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resolves with the translated text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => translateResponse(["答案"])))

    await expect(translateWithGoogle(" the answer ", "auto", "zh-CN")).resolves.toBe("答案")
  })

  it("asks for the language pair it was handed", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => translateResponse(["答案"]))
    vi.stubGlobal("fetch", fetchMock)

    await translateWithGoogle("ephemeral", "auto", "zh")

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.hostname).toBe("translate.googleapis.com")
    expect(url.searchParams.get("sl")).toBe("auto")
    expect(url.searchParams.get("tl")).toBe("zh")
    // No cookies: the endpoint is anonymous and sending them only leaks them.
    expect(fetchMock.mock.calls[0][1].credentials).toBe("omit")
  })

  it("surfaces a non-OK status instead of a blank answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 429 })))

    await expect(translateWithGoogle("ephemeral", "auto", "zh-CN")).rejects.toThrow("429")
  })

  // The fallback chain cools a provider down on rate limits only. The status
  // has to survive on the error for that decision to be possible at all.
  it("marks a 429 as a rate-limit error the chain can recognise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 429 })))

    const error = await translateWithGoogle("ephemeral", "auto", "zh-CN").catch((e: unknown) => e)
    expect(isRateLimitRequestError(error)).toBe(true)
  })

  it("surfaces an unparseable body instead of rendering it into the popover", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("<html>", { status: 200 })))

    await expect(translateWithGoogle("ephemeral", "auto", "zh-CN")).rejects.toThrow("无法解析")
  })

  it("names itself when the transport fails, so an aggregated failure stays readable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    await expect(translateWithGoogle("ephemeral", "auto", "zh-CN")).rejects.toThrow("Google 翻译接口网络错误：network down")
  })
})
