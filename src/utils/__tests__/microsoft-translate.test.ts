import { afterEach, describe, expect, it, vi } from "vitest"
import { isRateLimitRequestError } from "@/utils/request/retry-policy"

const {
  buildMicrosoftTranslateRequest,
  decodeMicrosoftText,
  escapeMicrosoftText,
  parseMicrosoftTranslateResponse,
  translateWithMicrosoft,
} = await import("@/utils/microsoft-translate")

function microsoftResponse(text: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify([{ translations: [{ text }], ...extra }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("escapeMicrosoftText", () => {
  // The endpoint runs an HTML tag aligner over every request, so a bare "<" in
  // ordinary text ("if x < b then stop") fuses into a pseudo-tag and is eaten.
  it("escapes the characters the tag aligner would treat as markup", () => {
    expect(escapeMicrosoftText("a < b and c > d & more")).toBe("a &lt; b and c &gt; d &amp; more")
  })

  it("escapes the ampersand first, or a fresh entity gets escaped twice", () => {
    expect(escapeMicrosoftText("&lt;")).toBe("&amp;lt;")
  })

  // Straight quotes are curled into typographic ones by the endpoint no
  // matter what is sent (Google's endpoint does the same), so escaping them
  // would buy nothing.
  it("leaves quotes alone", () => {
    expect(escapeMicrosoftText("\"quoted\" it's")).toBe("\"quoted\" it's")
  })
})

describe("decodeMicrosoftText", () => {
  it("decodes the entities the endpoint answers with", () => {
    expect(decodeMicrosoftText("a &lt; b &amp; c &gt; d")).toBe("a < b & c > d")
    expect(decodeMicrosoftText("&quot;q&quot; &#39;a&#39; &apos;b&apos;")).toBe("\"q\" 'a' 'b'")
  })

  it("decodes numeric references, decimal and hex", () => {
    expect(decodeMicrosoftText("caf&#233; &#xE9;")).toBe("café é")
  })

  // A literal "&amp;lt;" in the source must surface as "&lt;", not "<":
  // exactly one decoding pass, never a re-scan of replaced text.
  it("decodes exactly once", () => {
    expect(decodeMicrosoftText("&amp;lt;")).toBe("&lt;")
  })

  it("leaves a bare ampersand and unknown entities untouched", () => {
    expect(decodeMicrosoftText("R&D &nope;")).toBe("R&D &nope;")
  })
})

describe("buildMicrosoftTranslateRequest", () => {
  it("posts a bare string array to the unauthenticated endpoint", () => {
    const { url, body } = buildMicrosoftTranslateRequest("hello", "en", "zh-CN")

    const parsed = new URL(url)
    expect(parsed.hostname).toBe("edge.microsoft.com")
    expect(parsed.pathname).toBe("/translate/translatetext")
    expect(parsed.searchParams.get("from")).toBe("en")
    expect(parsed.searchParams.get("to")).toBe("zh-CN")
    expect(parsed.searchParams.get("isEnterpriseClient")).toBe("false")
    expect(JSON.parse(body)).toEqual(["hello"])
  })

  it("sends an empty from parameter for auto source detection", () => {
    const { url } = buildMicrosoftTranslateRequest("hello", "auto", "zh")

    expect(new URL(url).searchParams.get("from")).toBe("")
  })

  it("escapes the text it puts in the body", () => {
    const { body } = buildMicrosoftTranslateRequest("a < b & c", "en", "zh")

    expect(JSON.parse(body)).toEqual(["a &lt; b &amp; c"])
  })
})

describe("parseMicrosoftTranslateResponse", () => {
  it("pulls the translation out of a real answer", () => {
    expect(parseMicrosoftTranslateResponse([{ translations: [{ text: "你好", to: "zh-Hans" }] }])).toBe("你好")
  })

  // Auto-detection answers carry a `detectedLanguage` object alongside the
  // translations; the shape is still one entry with one translation.
  it("reads through the auto-detection wrapper", () => {
    expect(parseMicrosoftTranslateResponse([
      { detectedLanguage: { language: "zh-Hans", score: 1 }, translations: [{ text: "Hello" }] },
    ])).toBe("Hello")
  })

  it("decodes the entities the answer arrives with", () => {
    expect(parseMicrosoftTranslateResponse([{ translations: [{ text: "a &lt; b" }] }])).toBe("a < b")
  })

  it("returns null for a body that is not the expected shape", () => {
    expect(parseMicrosoftTranslateResponse(null)).toBeNull()
    expect(parseMicrosoftTranslateResponse("nope")).toBeNull()
    expect(parseMicrosoftTranslateResponse([])).toBeNull()
    // One text was sent; two entries back means the shape changed.
    expect(parseMicrosoftTranslateResponse([{ translations: [{ text: "a" }] }, { translations: [{ text: "b" }] }])).toBeNull()
    expect(parseMicrosoftTranslateResponse([{ translations: [] }])).toBeNull()
    expect(parseMicrosoftTranslateResponse([{ translations: [{ text: 42 }] }])).toBeNull()
    expect(parseMicrosoftTranslateResponse([null])).toBeNull()
  })
})

describe("translateWithMicrosoft", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resolves with the translated text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => microsoftResponse("答案")))

    await expect(translateWithMicrosoft(" the answer ", "auto", "zh-CN")).resolves.toBe("答案")
  })

  it("posts JSON without cookies", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => microsoftResponse("答案"))
    vi.stubGlobal("fetch", fetchMock)

    await translateWithMicrosoft("ephemeral", "en", "zh-CN")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("from=en")
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("omit")
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" })
    expect(init.body).toBe(JSON.stringify(["ephemeral"]))
  })

  it("surfaces a non-OK status instead of a blank answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 429 })))

    await expect(translateWithMicrosoft("ephemeral", "en", "zh-CN")).rejects.toThrow("429")
  })

  // The fallback chain cools a provider down on rate limits only. The status
  // has to survive on the error for that decision to be possible at all.
  it("marks a 429 as a rate-limit error the chain can recognise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { status: 429 })))

    const error = await translateWithMicrosoft("ephemeral", "en", "zh-CN").catch((e: unknown) => e)
    expect(isRateLimitRequestError(error)).toBe(true)
  })

  it("surfaces an unparseable body instead of rendering it into the popover", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("<html>", { status: 200 })))

    await expect(translateWithMicrosoft("ephemeral", "en", "zh-CN")).rejects.toThrow("无法解析")
  })

  it("names itself when the transport fails, so an aggregated failure stays readable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    await expect(translateWithMicrosoft("ephemeral", "en", "zh-CN")).rejects.toThrow("Microsoft 翻译接口网络错误：network down")
  })
})
