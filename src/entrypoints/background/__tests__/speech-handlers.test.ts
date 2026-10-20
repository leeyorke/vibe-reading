import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const synthesizeSpeechAudioMock = vi.fn()
const onMessageMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: (...args: unknown[]) => onMessageMock(...args),
}))

vi.mock("@/utils/speech", () => ({
  synthesizeSpeechAudio: (...args: unknown[]) => synthesizeSpeechAudioMock(...args),
}))

const { setupSpeechMessageHandlers } = await import("../speech-handlers")

type Handler = (message: { data?: unknown }) => Promise<unknown>

/** Collect the handlers the module registers, keyed by message name. */
function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  onMessageMock.mockImplementation((name: string, handler: Handler) => {
    handlers.set(name, handler)
  })

  setupSpeechMessageHandlers()
  return handlers
}

describe("speech message handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("hands the toolbar base64 text it can decode", async () => {
    synthesizeSpeechAudioMock.mockResolvedValue(btoa("\u00FF\u00FB\u0090\u0000"))
    const handler = captureHandlers().get("synthesizeSpeechAudio")!

    // The channel serialises messages as JSON, so this must not be a buffer.
    const payload = await handler({ data: { text: "ephemeral", sourceLanguage: "en" } })
    expect(typeof payload).toBe("string")
    expect(synthesizeSpeechAudioMock).toHaveBeenCalledWith({ text: "ephemeral", sourceLanguage: "en" })
    expect(JSON.parse(JSON.stringify(payload))).toBe(payload)
  })

  it("never lets a speech failure look like an empty answer", async () => {
    synthesizeSpeechAudioMock.mockRejectedValue(new Error("network down"))
    const handler = captureHandlers().get("synthesizeSpeechAudio")!

    await expect(handler({ data: { text: "ephemeral" } })).rejects.toThrow(/network down/)
  })
})
