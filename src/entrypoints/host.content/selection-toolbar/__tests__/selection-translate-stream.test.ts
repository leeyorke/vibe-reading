import { beforeEach, describe, expect, it, vi } from "vitest"

const { connectMock, createdPorts } = vi.hoisted(() => {
  type MessageListener = (message: unknown) => void
  type DisconnectListener = () => void

  function createFakePort(name: string) {
    const messageListeners: MessageListener[] = []
    const disconnectListeners: DisconnectListener[] = []

    const port = {
      name,
      postMessage: vi.fn(),
      disconnect: vi.fn(() => {
        // A disconnected port stops delivering, which is what the real one does.
        messageListeners.length = 0
        disconnectListeners.length = 0
      }),
      onMessage: {
        addListener: (listener: MessageListener) => messageListeners.push(listener),
        removeListener: (listener: MessageListener) => {
          const index = messageListeners.indexOf(listener)
          if (index >= 0) {
            messageListeners.splice(index, 1)
          }
        },
        hasListener: (listener: MessageListener) => messageListeners.includes(listener),
      },
      onDisconnect: {
        addListener: (listener: DisconnectListener) => disconnectListeners.push(listener),
        removeListener: (listener: DisconnectListener) => {
          const index = disconnectListeners.indexOf(listener)
          if (index >= 0) {
            disconnectListeners.splice(index, 1)
          }
        },
        hasListener: (listener: DisconnectListener) => disconnectListeners.includes(listener),
      },
      emit: (message: unknown) => {
        for (const listener of [...messageListeners]) {
          listener(message)
        }
      },
      emitDisconnect: () => {
        for (const listener of [...disconnectListeners]) {
          listener()
        }
      },
    }

    return port
  }

  const createdPorts: ReturnType<typeof createFakePort>[] = []
  const connectMock = vi.fn((connectInfo?: { name?: string }) => {
    const port = createFakePort(connectInfo?.name ?? "")
    createdPorts.push(port)
    return port
  })

  return { connectMock, createdPorts }
})

const extensionContextInvalidatedMock = vi.fn(() => false)

vi.mock("#imports", () => ({
  browser: {
    runtime: {
      connect: (connectInfo?: { name?: string }) => connectMock(connectInfo),
    },
  },
}))

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      connect: (connectInfo?: { name?: string }) => connectMock(connectInfo),
    },
  },
}))

vi.mock("@/utils/message-retry", () => ({
  EXTENSION_STALE_MESSAGE: "扩展已重新加载，请刷新页面后重试",
  isExtensionContextInvalidated: () => extensionContextInvalidatedMock(),
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { requestSelectionTranslateStream } = await import("../selection-translate-stream")

const REQUEST = { text: "ephemeral" }

describe("requestSelectionTranslateStream", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdPorts.length = 0
    extensionContextInvalidatedMock.mockReturnValue(false)
  })

  it("opens the port the background listens on and posts the request", async () => {
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    expect(connectMock).toHaveBeenCalledWith({ name: "selection-translate-stream" })
    expect(createdPorts[0].postMessage).toHaveBeenCalledWith(REQUEST)

    createdPorts[0].emit({ type: "done", text: "转瞬即逝的" })
    await expect(promise).resolves.toBe("转瞬即逝的")
  })

  it("hands every delta to the caller in order", async () => {
    const onDelta = vi.fn()
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta })

    createdPorts[0].emit({ type: "delta", text: "## declare" })
    createdPorts[0].emit({ type: "delta", text: "\n\nverb" })
    createdPorts[0].emit({ type: "done", text: "## declare\n\nverb" })

    await expect(promise).resolves.toBe("## declare\n\nverb")
    expect(onDelta.mock.calls.map(call => call[0])).toEqual(["## declare", "\n\nverb"])
  })

  it("resolves with the done text even when it differs from the deltas", async () => {
    // The background trims, the deltas do not. `done` is authoritative — it is
    // what gets written to the vocabulary book.
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    createdPorts[0].emit({ type: "delta", text: "答案 " })
    createdPorts[0].emit({ type: "done", text: "答案" })

    await expect(promise).resolves.toBe("答案")
  })

  it("rejects with the provider's message", async () => {
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    createdPorts[0].emit({ type: "error", message: "401 Unauthorized" })

    await expect(promise).rejects.toThrow("401 Unauthorized")
  })

  it("disconnects the port once the outcome is known", async () => {
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    createdPorts[0].emit({ type: "done", text: "答案" })
    await promise

    expect(createdPorts[0].disconnect).toHaveBeenCalled()
  })

  it("ignores anything that arrives after the outcome", async () => {
    const onDelta = vi.fn()
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta })

    createdPorts[0].emit({ type: "done", text: "答案" })
    await promise

    createdPorts[0].emit({ type: "delta", text: "迟到" })
    expect(onDelta).not.toHaveBeenCalled()
  })

  it("reports a stream that was cut off before any outcome", async () => {
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    createdPorts[0].emit({ type: "delta", text: "半句" })
    createdPorts[0].emitDisconnect()

    await expect(promise).rejects.toThrow("翻译连接中断，请重试")
  })

  it("names the stale extension context when the reload is the reason", async () => {
    extensionContextInvalidatedMock.mockReturnValue(true)
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() })

    createdPorts[0].emitDisconnect()

    await expect(promise).rejects.toThrow("扩展已重新加载，请刷新页面后重试")
  })

  it("refuses to leak a dead binding as a raw TypeError", async () => {
    connectMock.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'length')")
    })
    extensionContextInvalidatedMock.mockReturnValue(true)

    await expect(
      requestSelectionTranslateStream(REQUEST, { onDelta: vi.fn() }),
    ).rejects.toThrow("扩展已重新加载，请刷新页面后重试")
  })

  it("drops messages that are not the protocol envelope", async () => {
    const onDelta = vi.fn()
    const promise = requestSelectionTranslateStream(REQUEST, { onDelta })

    createdPorts[0].emit(undefined)
    createdPorts[0].emit("nonsense")
    createdPorts[0].emit({ type: "delta", text: "答案" })
    createdPorts[0].emit({ type: "done", text: "答案" })

    await expect(promise).resolves.toBe("答案")
    expect(onDelta).toHaveBeenCalledTimes(1)
  })
})
