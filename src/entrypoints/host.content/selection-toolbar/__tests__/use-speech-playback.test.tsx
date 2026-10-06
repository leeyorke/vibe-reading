// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sendMessageMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args), success: vi.fn() },
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

class FakeBufferSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  connectedTo: unknown = null

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
  }

  connect(destination: unknown) {
    this.connectedTo = destination
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = "running"
  closed = false
  source = new FakeBufferSource()
  destination = Symbol("destination")
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ data }))

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  async resume() {}
  async close() {
    this.closed = true
  }

  createBufferSource() {
    return this.source as unknown as AudioBufferSourceNode
  }
}

function audioBytes(...bytes: number[]) {
  return btoa(String.fromCharCode(...bytes))
}

const { useSpeechPlayback } = await import("../use-speech-playback")

describe("useSpeechPlayback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.instances = []
    // What the channel can actually carry: base64 text, never a buffer.
    sendMessageMock.mockResolvedValue(audioBytes(0xFF, 0xFB, 0x90, 0x00))
    vi.stubGlobal("AudioContext", FakeAudioContext)
  })

  it("asks the background for audio and plays the decoded bytes", async () => {
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("ephemeral")
    })

    expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "ephemeral",
      sourceLanguage: "en",
    })
    const context = FakeAudioContext.instances[0]
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1)
    expect([...new Uint8Array(context.decodeAudioData.mock.calls[0][0] as ArrayBuffer)]).toEqual([0xFF, 0xFB, 0x90, 0x00])
    expect(context.source.started).toBe(true)
    // An unconnected source node plays into nothing — no error, no sound.
    expect(context.source.connectedTo).toBe(context.destination)
    expect(result.current.state).toBe("playing")
  })

  it("guesses the language of a non-Latin selection", async () => {
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("日本語の勉強")
    })

    expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "日本語の勉強",
      sourceLanguage: "ja",
    })
  })

  it("toggles to stop while playing", async () => {
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("ephemeral")
    })
    const source = FakeAudioContext.instances[0].source

    act(() => {
      void result.current.speak("ephemeral")
    })

    expect(source.stopped).toBe(true)
    expect(result.current.state).toBe("idle")
  })

  it("ignores a second click while the audio is still on its way", async () => {
    let resolveAudio: (value: string) => void = () => {}
    sendMessageMock.mockImplementation(() => new Promise<string>((resolve) => {
      resolveAudio = resolve
    }))
    const { result } = renderHook(() => useSpeechPlayback())

    act(() => {
      void result.current.speak("ephemeral")
    })
    expect(result.current.state).toBe("loading")

    act(() => {
      void result.current.speak("ephemeral")
    })
    expect(sendMessageMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAudio(audioBytes(0x01))
    })
    expect(result.current.state).toBe("playing")
  })

  it("drops the result of a request the user stopped mid-flight", async () => {
    let resolveAudio: (value: string) => void = () => {}
    sendMessageMock.mockImplementation(() => new Promise<string>((resolve) => {
      resolveAudio = resolve
    }))
    const { result } = renderHook(() => useSpeechPlayback())

    act(() => {
      void result.current.speak("ephemeral")
    })
    act(() => {
      result.current.stop()
    })
    await act(async () => {
      resolveAudio(audioBytes(0x01))
    })

    expect(result.current.state).toBe("idle")
    expect(FakeAudioContext.instances[0].source.started).toBe(false)
  })

  it("surfaces a failure as a toast and goes back to idle", async () => {
    sendMessageMock.mockRejectedValue(new Error("Google TTS responded 429"))
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("ephemeral")
    })

    expect(result.current.state).toBe("idle")
    expect(toastErrorMock).toHaveBeenCalledWith("朗读失败：Google TTS responded 429")
  })

  // The shape that made this silent for so long: the channel JSON-serialised a
  // buffer into `{}` and the button did nothing but look busy. Anything that is
  // not decodable must be reported, never swallowed.
  it("reports a payload that is not decodable audio instead of going quiet", async () => {
    sendMessageMock.mockResolvedValue("{}")
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("ephemeral")
    })

    expect(result.current.state).toBe("idle")
    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("朗读失败"))
  })

  it("does nothing for an empty selection", async () => {
    const { result } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("   ")
    })

    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(result.current.state).toBe("idle")
  })

  it("stops the audio and closes the context when the toolbar goes away", async () => {
    const { result, unmount } = renderHook(() => useSpeechPlayback())

    await act(async () => {
      await result.current.speak("ephemeral")
    })
    const context = FakeAudioContext.instances[0]

    unmount()

    expect(context.source.stopped).toBe(true)
    expect(context.closed).toBe(true)
  })
})
