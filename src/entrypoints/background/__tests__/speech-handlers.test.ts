import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const synthesizeSpeechMock = vi.fn()
const synthesizeSpeechAudioMock = vi.fn()
const onMessageMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: (...args: unknown[]) => onMessageMock(...args),
}))

vi.mock("@/utils/review/speech", () => ({
  synthesizeSpeech: (...args: unknown[]) => synthesizeSpeechMock(...args),
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

  it("hands the review card a playable data URL", async () => {
    synthesizeSpeechMock.mockResolvedValue("data:audio/mpeg;base64,AAAA")
    const handler = captureHandlers().get("synthesizeSpeech")!

    expect(await handler({ data: { text: "ephemeral" } })).toBe("data:audio/mpeg;base64,AAAA")
    expect(synthesizeSpeechMock).toHaveBeenCalledWith({ text: "ephemeral" })
  })

  it("hands the toolbar raw bytes it can decode", async () => {
    const bytes = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]).buffer
    synthesizeSpeechAudioMock.mockResolvedValue(bytes)
    const handler = captureHandlers().get("synthesizeSpeechAudio")!

    expect(await handler({ data: { text: "ephemeral", sourceLanguage: "en" } })).toBe(bytes)
    expect(synthesizeSpeechAudioMock).toHaveBeenCalledWith({ text: "ephemeral", sourceLanguage: "en" })
  })

  it("wraps a failure so the caller can show it", async () => {
    synthesizeSpeechMock.mockRejectedValue(new Error("Google TTS responded 429"))
    const handler = captureHandlers().get("synthesizeSpeech")!

    await expect(handler({ data: { text: "ephemeral" } })).rejects.toThrow(/发音生成失败/)
  })

  it("never lets a speech failure look like an empty answer", async () => {
    synthesizeSpeechAudioMock.mockRejectedValue(new Error("network down"))
    const handler = captureHandlers().get("synthesizeSpeechAudio")!

    await expect(handler({ data: { text: "ephemeral" } })).rejects.toThrow(/network down/)
  })
})
