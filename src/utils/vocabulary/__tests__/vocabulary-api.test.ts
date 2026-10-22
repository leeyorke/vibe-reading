import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  apiAddWord,
  apiDeleteWord,
  apiGetWords,
  apiUpdateWord,
} from "@/utils/vocabulary/vocabulary-api"

vi.mock("@/utils/config/backend", () => ({
  getBackendBaseUrl: async () => "http://127.0.0.1:4080",
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** The shape the backend answers with. */
function backendWord(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的",
    context_url: "https://example.com",
    context_text: "an ephemeral joy",
    source_language: "eng",
    target_language: null,
    star: 3,
    created_at: 1_700_000_000_000,
    last_reviewed_at: null,
    review_count: 0,
    note: null,
    source: "local",
    phonetic: null,
    ...overrides,
  }
}

function mockFetch(payload: unknown, ok = true) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(payload), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("vocabulary api", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("maps the source and the phonetic of a word", async () => {
    mockFetch({
      records: [backendWord({ source: "eudic", phonetic: "/ɪˈfemərəl/" })],
      total: 1,
      by_source: { all: 1, local: 0, eudic: 1 },
    })

    const { words } = await apiGetWords({})

    expect(words[0].source).toBe("eudic")
    expect(words[0].phonetic).toBe("/ɪˈfemərəl/")
  })

  it("reports how many words each source holds", async () => {
    mockFetch({
      records: [],
      total: 0,
      by_source: { all: 407, local: 398, eudic: 9 },
    })

    const { bySource } = await apiGetWords({})

    expect(bySource).toEqual({ all: 407, local: 398, eudic: 9 })
  })

  it("falls back to the filtered total when the backend sends no counts", async () => {
    mockFetch({ records: [], total: 5 })

    const { bySource } = await apiGetWords({})

    expect(bySource.all).toBe(5)
    expect(bySource.eudic).toBe(0)
  })

  it("passes the source filter on to the backend", async () => {
    const fetchMock = mockFetch({ records: [], total: 0 })

    await apiGetWords({ source: "eudic" })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("source=eudic")
  })

  it("does not send a source filter when every source is wanted", async () => {
    const fetchMock = mockFetch({ records: [], total: 0 })

    await apiGetWords({ source: "all" })

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("source=")
  })

  it("reports the Eudic sync result of a star change", async () => {
    mockFetch({ ...backendWord({ star: 5 }), eudic_sync: { ok: false, error: "token 无效" } })

    const result = await apiUpdateWord({ id: "w1", updates: { star: 5 } })

    expect(result.eudicSync).toEqual({ ok: false, error: "token 无效" })
  })

  it("reports no Eudic sync result for a local word", async () => {
    mockFetch(backendWord())

    const result = await apiUpdateWord({ id: "w1", updates: { star: 5 } })

    expect(result.eudicSync).toBeUndefined()
  })

  it("returns the id of a new word together with its sync result", async () => {
    mockFetch({ ...backendWord({ id: "new-id" }), eudic_sync: { ok: true } })

    const result = await apiAddWord({ word: "ephemeral", translation: "adj. 短暂的" })

    expect(result.id).toBe("new-id")
    expect(result.eudicSync).toEqual({ ok: true })
  })

  it("reports the Eudic sync result of a delete", async () => {
    mockFetch({ message: "删除成功", eudic_sync: { ok: true } })

    const result = await apiDeleteWord("w1")

    expect(result.eudicSync).toEqual({ ok: true })
  })
})
