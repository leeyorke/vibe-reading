import { beforeEach, describe, expect, it, vi } from "vitest"

const onMessageMock = vi.fn()
const onConnectMock = vi.fn()
const queryWordDefinitionStructuredMock = vi.fn()
const getLocalConfigMock = vi.fn()
const resolveProviderConfigOrNullMock = vi.fn()
const executeTranslateStreamMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
}))

vi.mock("@/utils/dict/dict-api", () => ({
  queryWordDefinitionStructured: (...args: unknown[]) => queryWordDefinitionStructuredMock(...args),
}))

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: (...args: unknown[]) => getLocalConfigMock(...args),
}))

vi.mock("@/utils/constants/feature-providers", () => ({
  resolveProviderConfigOrNull: (...args: unknown[]) => resolveProviderConfigOrNullMock(...args),
}))

vi.mock("@/utils/host/translate/execute-translate", () => ({
  executeTranslateStream: (...args: unknown[]) => executeTranslateStreamMock(...args),
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// The streamed path talks over a raw port, so the background module reaches for
// `browser` directly rather than going through the typed messaging layer.
vi.mock("#imports", () => ({
  browser: { runtime: { onConnect: { addListener: onConnectMock } } },
}))

vi.mock("wxt/browser", () => ({
  browser: { runtime: { onConnect: { addListener: onConnectMock } } },
}))

const { setupSelectionTranslateHandler, setupSelectionTranslateStreamHandler } = await import("../selection-translate")

type Handler = (message: { data: Record<string, unknown> }) => Promise<unknown>

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  onMessageMock.mockImplementation((name: string, handler: Handler) => {
    handlers.set(name, handler)
  })
  setupSelectionTranslateHandler()
  return handlers
}

describe("selection translate structured lookup", () => {
  const DEFINITION = {
    headword: "serendipity",
    phoneticUK: "/ˌserənˈdɪpəti/",
    phoneticUS: "/ˌserənˈdɪpəti/",
    pos: "n.",
    senses: [{ number: "1", chineseDefinition: "机缘巧合" }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("answers the structured lookup with the dictionary definition", async () => {
    queryWordDefinitionStructuredMock.mockResolvedValue(DEFINITION)
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedTextStructured")!({ data: { text: "serendipity" } })).resolves.toEqual(DEFINITION)
    expect(queryWordDefinitionStructuredMock).toHaveBeenCalledWith("serendipity")
  })

  // A dictionary payload that the mapping cannot read used to throw
  // "Cannot read properties of undefined (reading 'length')" straight into the
  // toolbar, which then reported it as a dead extension context. An unusable
  // entry is a miss, and a miss is what the toolbar already knows how to route
  // around: it falls back to the AI translation.
  it("answers a miss when the dictionary lookup explodes", async () => {
    queryWordDefinitionStructuredMock.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'length')"),
    )
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedTextStructured")!({ data: { text: "serendipity" } })).resolves.toBeNull()
  })
})

type FakePort = ReturnType<typeof createFakePort>

function createFakePort(name = "selection-translate-stream") {
  const messageListeners: ((message: unknown) => void)[] = []
  return {
    name,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
    },
    deliver: (message: unknown) => {
      for (const listener of [...messageListeners]) {
        listener(message)
      }
    },
  }
}

describe("selection translate stream port", () => {
  let connectListener: ((port: FakePort) => void) | undefined

  function captureConnectListener() {
    let listener: ((port: FakePort) => void) | undefined
    onConnectMock.mockImplementation((candidate: (port: FakePort) => void) => {
      listener = candidate
    })
    setupSelectionTranslateStreamHandler()
    connectListener = listener
    return listener!
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getLocalConfigMock.mockResolvedValue({ language: { sourceCode: "eng", targetCode: "cmn", level: "intermediate" } })
    resolveProviderConfigOrNullMock.mockReturnValue({ id: "provider-id", provider: "openai-compatible" })
  })

  it("passes the request straight to the streaming translator", async () => {
    executeTranslateStreamMock.mockResolvedValue("n. 机缘巧合")
    const listener = captureConnectListener()
    const port = createFakePort()

    listener(port)
    port.deliver({ text: "serendipity", targetLanguageCode: "cmn" })

    await vi.waitFor(() => {
      expect(executeTranslateStreamMock).toHaveBeenCalledTimes(1)
    })
    const [text, langConfig, providerConfig] = executeTranslateStreamMock.mock.calls[0]
    expect(text).toBe("serendipity")
    expect(langConfig).toMatchObject({ sourceCode: "eng", targetCode: "cmn" })
    expect(providerConfig).toEqual({ id: "provider-id", provider: "openai-compatible" })
  })

  it("pushes each delta out as the provider produces it, then the whole answer", async () => {
    executeTranslateStreamMock.mockImplementation(async (
      _text: string,
      _langConfig: unknown,
      _providerConfig: unknown,
      _promptResolver: unknown,
      onDelta: (delta: string) => void,
    ) => {
      onDelta("## declare")
      onDelta("\n\nverb")
      return "## declare\n\nverb"
    })
    const listener = captureConnectListener()
    const port = createFakePort()

    listener(port)
    port.deliver({ text: "declare" })

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: "done", text: "## declare\n\nverb" })
    })
    expect(port.postMessage.mock.calls.map(call => call[0])).toEqual([
      { type: "delta", text: "## declare" },
      { type: "delta", text: "\n\nverb" },
      { type: "done", text: "## declare\n\nverb" },
    ])
    // A port left open keeps the service worker alive for nothing.
    expect(port.disconnect).toHaveBeenCalled()
  })

  it("reports a provider failure over the same port instead of going quiet", async () => {
    executeTranslateStreamMock.mockRejectedValue(new Error("401 Unauthorized"))
    const listener = captureConnectListener()
    const port = createFakePort()

    listener(port)
    port.deliver({ text: "declare" })

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: "error", message: "401 Unauthorized" })
    })
    expect(port.disconnect).toHaveBeenCalled()
  })

  it("names the missing provider rather than answering an empty popover", async () => {
    resolveProviderConfigOrNullMock.mockReturnValue(null)
    const listener = captureConnectListener()
    const port = createFakePort()

    listener(port)
    port.deliver({ text: "declare" })

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: "error", message: "尚未配置翻译服务商" })
    })
    expect(executeTranslateStreamMock).not.toHaveBeenCalled()
  })

  it("drops a request that carries no text before touching the provider", async () => {
    const listener = captureConnectListener()
    const port = createFakePort()

    listener(port)
    port.deliver({ text: "   " })

    expect(port.disconnect).toHaveBeenCalled()
    expect(executeTranslateStreamMock).not.toHaveBeenCalled()
  })

  it("ignores ports opened for something else", () => {
    captureConnectListener()
    const port = createFakePort("some-other-port")

    connectListener!(port)

    port.deliver({ text: "declare" })
    expect(executeTranslateStreamMock).not.toHaveBeenCalled()
    expect(port.disconnect).not.toHaveBeenCalled()
  })
})
