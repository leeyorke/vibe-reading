import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { EXTENSION_STALE_MESSAGE, withMessageRetry } = await import("../message-retry")

describe("withMessageRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes a successful response through untouched", async () => {
    const request = vi.fn().mockResolvedValue("ok")

    await expect(withMessageRetry(request)).resolves.toBe("ok")
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("retries once when the message port closed before the response", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("The message port closed before a response was received"))
      .mockResolvedValueOnce("ok")

    await expect(withMessageRetry(request)).resolves.toBe("ok")
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("retries once on the library's own \"No response\" error", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("No response"))
      .mockResolvedValueOnce("ok")

    await expect(withMessageRetry(request)).resolves.toBe("ok")
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("does not retry a real failure — the handler answered with an error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("发音生成失败: Google TTS responded 429"))

    await expect(withMessageRetry(request)).rejects.toThrow(/429/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("gives up after the retry instead of hammering the worker", async () => {
    const request = vi.fn().mockRejectedValue(new Error("message port closed"))

    await expect(withMessageRetry(request)).rejects.toThrow(/port closed/)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("turns an invalidated extension context into a refresh-the-page hint", async () => {
    // Reloading the extension orphans the content scripts of open tabs; their
    // API bindings are gone and no retry can bring them back.
    const request = vi.fn().mockRejectedValue(new Error("Extension context invalidated."))

    await expect(withMessageRetry(request)).rejects.toThrow(EXTENSION_STALE_MESSAGE)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("recognises the dead-context TypeError the polyfill throws instead", async () => {
    // With the binding torn down the argument shim reads `.length` off
    // undefined and the real cause never reaches the message. The probe is what
    // tells the two apart here: `runtime.id` is gone.
    vi.stubGlobal("chrome", { runtime: {} })
    const request = vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'length')"))

    await expect(withMessageRetry(request)).rejects.toThrow(EXTENSION_STALE_MESSAGE)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("recognises a stripped sendMessage, whatever the error says", async () => {
    vi.stubGlobal("chrome", { runtime: { id: "extension-id", sendMessage: undefined } })
    const request = vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'x')"))

    await expect(withMessageRetry(request)).rejects.toThrow(EXTENSION_STALE_MESSAGE)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("does not blame a dead context for a TypeError of the extension's own code", async () => {
    // Mapping a sparse dictionary payload threw exactly
    // "Cannot read properties of undefined (reading 'length')" once, and the
    // toolbar answered "扩展已重新加载，请刷新页面后重试" — it never was. A
    // healthy context means the message belongs to the code, not the binding,
    // so it must survive as itself for the reader to see the real reason.
    vi.stubGlobal("chrome", { runtime: { id: "extension-id", sendMessage: vi.fn() } })
    const request = vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'length')"))

    let caught: unknown
    try {
      await withMessageRetry(request)
    }
    catch (error) {
      caught = error
    }

    expect((caught as Error).message).toContain("reading 'length'")
    expect((caught as Error).message).not.toContain(EXTENSION_STALE_MESSAGE)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("does not blame a dead context for a plain TypeError in healthy code", async () => {
    vi.stubGlobal("chrome", { runtime: { id: "extension-id", sendMessage: vi.fn() } })
    const request = vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'x')"))

    await expect(withMessageRetry(request)).rejects.toThrow(/reading 'x'/)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
