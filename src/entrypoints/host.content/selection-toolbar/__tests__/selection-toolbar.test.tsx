// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { selectionMock, sendMessageMock } = vi.hoisted(() => ({
  selectionMock: {
    current: {
      text: "ephemeral",
      rect: new DOMRect(0, 100, 80, 20),
      isVisible: true,
    } as { text: string, rect: DOMRect | null, isVisible: boolean },
  },
  sendMessageMock: vi.fn(),
}))

vi.mock("../use-text-selection", () => ({
  useTextSelection: () => selectionMock.current,
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

class FakeBufferSource {
  started = false
  stopped = false
  onended: (() => void) | null = null
  buffer: unknown = null
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
  static last: FakeAudioContext | null = null
  state = "running"
  source = new FakeBufferSource()
  destination = Symbol("destination")
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ data }))

  constructor() {
    FakeAudioContext.last = this
  }

  async resume() {}
  async close() {}

  createBufferSource() {
    return this.source as unknown as AudioBufferSourceNode
  }
}

const { SelectionToolbar } = await import("../selection-toolbar")
const { EXTENSION_STALE_MESSAGE } = await import("../message-retry")

function speakButton() {
  return screen.getByTitle("朗读选中的句子或单词")
}

describe("selection toolbar speak button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.last = null
    selectionMock.current = { text: "ephemeral", rect: new DOMRect(0, 100, 80, 20), isVisible: true }
    sendMessageMock.mockResolvedValue(new Uint8Array([0xFF, 0xFB, 0x90, 0x00]).buffer)
    vi.stubGlobal("AudioContext", FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("pronounces the selected text through Web Audio", async () => {
    render(<SelectionToolbar />)

    fireEvent.click(speakButton())

    await waitFor(() => {
      expect(screen.getByTitle("停止朗读")).toBeInTheDocument()
    })

    expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "ephemeral",
      sourceLanguage: "en",
    })
    expect(FakeAudioContext.last?.source.started).toBe(true)
    expect(FakeAudioContext.last?.source.connectedTo).toBe(FakeAudioContext.last?.destination)
  })

  it("stops the playback when clicked again while playing", async () => {
    render(<SelectionToolbar />)

    fireEvent.click(speakButton())
    await waitFor(() => {
      expect(screen.getByTitle("停止朗读")).toBeInTheDocument()
    })
    const source = FakeAudioContext.last!.source

    fireEvent.click(screen.getByTitle("停止朗读"))

    await waitFor(() => {
      expect(speakButton()).toBeInTheDocument()
    })
    expect(source.stopped).toBe(true)
  })

  it("keeps the button disabled while the audio is on its way", async () => {
    sendMessageMock.mockReturnValue(new Promise(() => {}))
    render(<SelectionToolbar />)

    fireEvent.click(speakButton())

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /朗读中/ })).toBeDisabled()
    })
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it("reports a failed synthesis instead of staying stuck in loading", async () => {
    sendMessageMock.mockRejectedValue(new Error("network down"))
    render(<SelectionToolbar />)

    fireEvent.click(speakButton())

    await waitFor(() => {
      expect(speakButton()).toBeInTheDocument()
    })
  })

  it("still offers translation and collecting next to the new button", () => {
    render(<SelectionToolbar />)

    expect(screen.getByTitle("翻译")).toBeInTheDocument()
    expect(screen.getByTitle("加入生词本")).toBeInTheDocument()
    expect(speakButton()).toBeInTheDocument()
  })

  it("swaps the action buttons for a refresh hint once the extension context is gone", () => {
    // The extension was reloaded while this page stayed open: the script
    // behind the toolbar is now orphaned and every action would fail.
    vi.stubGlobal("chrome", { runtime: {} })
    render(<SelectionToolbar />)

    expect(screen.getByTitle(EXTENSION_STALE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByTitle("翻译")).not.toBeInTheDocument()
    expect(screen.queryByTitle("加入生词本")).not.toBeInTheDocument()
  })
})
