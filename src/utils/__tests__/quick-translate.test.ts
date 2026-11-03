import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearProviderCooldowns } from "@/utils/fallback-chain"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { clearQuickTranslateCache, quickTranslate } = await import("@/utils/quick-translate")

/** The Google endpoint's real answer shape: nested arrays, one entry per segment. */
function googleResponse(parts: string[]) {
  return new Response(JSON.stringify([parts.map(text => [text, "original", null, null, 1]), null, "en"]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/** The Microsoft endpoint's real answer shape: one entry with one translation. */
function microsoftResponse(text: string) {
  return new Response(JSON.stringify([{ translations: [{ text }] }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/**
 * Routes each endpoint to its own canned answer, so a test decides what Google
 * and Microsoft say independently.
 */
function stubFetch(handlers: { google?: () => Response, microsoft?: () => Response }) {
  return vi.fn().mockImplementation(async (input: string | URL) => {
    const url = String(input)
    if (url.includes("edge.microsoft.com")) {
      return handlers.microsoft ? handlers.microsoft() : microsoftResponse("微软的答案")
    }
    return handlers.google ? handlers.google() : googleResponse(["谷歌的答案"])
  })
}

describe("quickTranslate", () => {
  beforeEach(() => {
    clearQuickTranslateCache()
    clearProviderCooldowns()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resolves with the translated text", async () => {
    vi.stubGlobal("fetch", stubFetch({}))

    await expect(quickTranslate({ text: " the answer " })).resolves.toBe("谷歌的答案")
  })

  it("asks for the configured language pair, auto-detecting an auto source", async () => {
    const fetchMock = stubFetch({})
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "ephemeral", sourceLanguageCode: "auto", targetLanguageCode: "cmn" })

    const googleUrl = new URL(fetchMock.mock.calls[0][0] as string)
    expect(googleUrl.searchParams.get("sl")).toBe("auto")
    expect(googleUrl.searchParams.get("tl")).toBe("zh")
  })

  // The whole point of the chain: a rate-limited Google must not kill the
  // button while Microsoft is still answering.
  it("falls back to Microsoft when Google rate-limits", async () => {
    const fetchMock = stubFetch({
      google: () => new Response("", { status: 429 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(quickTranslate({ text: "ephemeral" })).resolves.toBe("微软的答案")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain("translate.googleapis.com")
    expect(String(fetchMock.mock.calls[1][0])).toContain("edge.microsoft.com")
  })

  // Both endpoints speak the same two-letter code space, so the pair is
  // resolved once: Google gets `sl=auto`, Microsoft gets an empty `from`.
  it("hands each provider the same resolved language pair", async () => {
    const fetchMock = stubFetch({
      google: () => new Response("", { status: 429 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "ephemeral", sourceLanguageCode: "auto", targetLanguageCode: "jpn" })

    const microsoftUrl = new URL(fetchMock.mock.calls[1][0] as string)
    expect(microsoftUrl.searchParams.get("from")).toBe("")
    expect(microsoftUrl.searchParams.get("to")).toBe("ja")
  })

  it("names every provider that failed when the chain runs out", async () => {
    vi.stubGlobal("fetch", stubFetch({
      google: () => new Response("", { status: 429 }),
      microsoft: () => new Response("", { status: 400 }),
    }))

    await expect(quickTranslate({ text: "ephemeral" })).rejects.toThrow(
      "Google 翻译：Google 翻译接口返回 429；Microsoft 翻译：Microsoft 翻译接口返回 400",
    )
  })

  it("serves a repeat selection from cache instead of calling again", async () => {
    const fetchMock = stubFetch({})
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "ephemeral" })
    await quickTranslate({ text: "ephemeral" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps different target languages apart in the cache", async () => {
    const fetchMock = stubFetch({})
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "ephemeral", targetLanguageCode: "cmn" })
    await quickTranslate({ text: "ephemeral", targetLanguageCode: "jpn" })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // A cooled provider is demoted, not skipped: the next request pays the
  // healthy provider's latency instead of a guaranteed-failing round trip.
  it("asks Microsoft first while Google is cooling down", async () => {
    const fetchMock = stubFetch({
      google: () => new Response("", { status: 429 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "first" })
    await quickTranslate({ text: "second" })

    // Google was asked once, answered 429, and then stayed at the back of the
    // list: the second request went straight to Microsoft.
    const hosts = fetchMock.mock.calls.map(call => new URL(String(call[0])).hostname)
    expect(hosts).toEqual([
      "translate.googleapis.com",
      "edge.microsoft.com",
      "edge.microsoft.com",
    ])
  })

  it("caps a runaway selection instead of sending it whole", async () => {
    const fetchMock = stubFetch({})
    vi.stubGlobal("fetch", fetchMock)

    await quickTranslate({ text: "a".repeat(9000) })

    const googleUrl = new URL(fetchMock.mock.calls[0][0] as string)
    expect(googleUrl.searchParams.get("q")).toHaveLength(5000)
  })

  it("rejects an empty selection without calling any endpoint", async () => {
    const fetchMock = stubFetch({})
    vi.stubGlobal("fetch", fetchMock)

    await expect(quickTranslate({ text: "   " })).rejects.toThrow("没有选中的文字")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
