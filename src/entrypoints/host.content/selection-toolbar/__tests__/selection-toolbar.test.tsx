// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { selectionMock, sendMessageMock, streamMock } = vi.hoisted(() => ({
  selectionMock: {
    current: {
      text: "ephemeral",
      rect: new DOMRect(0, 100, 80, 20),
      isVisible: true,
    } as { text: string, rect: DOMRect | null, isVisible: boolean },
  },
  sendMessageMock: vi.fn(),
  streamMock: vi.fn(),
}))

vi.mock("../use-text-selection", () => ({
  useTextSelection: () => selectionMock.current,
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

// The streamed AI path. Every argument the toolbar passes is asserted by name
// in the tests below, so a stub is enough here.
vi.mock("../selection-translate-stream", () => ({
  requestSelectionTranslateStream: (...args: unknown[]) => streamMock(...args),
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

function translateButton() {
  return screen.getByTitle("翻译")
}

const AUDIO_BASE64 = btoa(String.fromCharCode(0xFF, 0xFB, 0x90, 0x00))

describe("selection toolbar speak button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.last = null
    selectionMock.current = { text: "ephemeral", rect: new DOMRect(0, 100, 80, 20), isVisible: true }
    sendMessageMock.mockImplementation((type: string) =>
      type === "synthesizeSpeechAudio" ? Promise.resolve(AUDIO_BASE64) : Promise.resolve(null))
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

describe("selection toolbar translate button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.last = null
    selectionMock.current = { text: "ephemeral", rect: new DOMRect(0, 100, 80, 20), isVisible: true }
    // A dictionary miss (null) is what routes a single word to the AI path.
    sendMessageMock.mockResolvedValue(null)
    vi.stubGlobal("AudioContext", FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders each slice of the answer as it arrives", async () => {
    streamMock.mockImplementation(async (_data: unknown, handlers: { onDelta: (delta: string) => void }) => {
      handlers.onDelta("## declare\n")
      handlers.onDelta("verb， 动词")
      return "## declare\nverb， 动词"
    })

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    // The answer is on screen before the request has finished, which is the
    // whole point of the stream.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "declare" })).toBeInTheDocument()
    })
    expect(screen.getByText("verb， 动词")).toBeInTheDocument()
  })

  it("keeps the spinner until the first slice arrives, not until the end", async () => {
    let emitDelta: (delta: string) => void = () => {}
    streamMock.mockImplementation((_data: unknown, handlers: { onDelta: (delta: string) => void }) =>
      new Promise<string>((resolve) => {
        emitDelta = handlers.onDelta
        // Deliberately never resolved: the point is what happens *before* that.
        void resolve
      }))

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    // The toolbar button also says 翻译中..., so scope to the popover's div.
    expect(await screen.findByText("翻译中...", { selector: "div" })).toBeInTheDocument()

    emitDelta("答案")

    await waitFor(() => {
      expect(screen.queryByText("翻译中...", { selector: "div" })).not.toBeInTheDocument()
    })
    expect(screen.getByText("答案")).toBeInTheDocument()
  })

  it("hands the selected text to the stream, untrimmed like before", async () => {
    streamMock.mockResolvedValue("答案")
    selectionMock.current = { text: "  a fleeting moment  ", rect: new DOMRect(0, 100, 80, 20), isVisible: true }

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1)
    })
    expect(streamMock.mock.calls[0][0]).toEqual({ text: "  a fleeting moment  " })
  })

  it("asks the stream for the multi-word selection, skipping the dictionary", async () => {
    streamMock.mockResolvedValue("答案")
    selectionMock.current = { text: "a fleeting moment", rect: new DOMRect(0, 100, 80, 20), isVisible: true }

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1)
    })
    expect(sendMessageMock).not.toHaveBeenCalledWith("translateSelectedTextStructured", expect.anything())
  })

  it("shows the provider's reason when the stream fails", async () => {
    streamMock.mockRejectedValue(new Error("401 Unauthorized"))

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    expect(await screen.findByText("翻译失败：401 Unauthorized")).toBeInTheDocument()
  })

  it("keeps whatever streamed in and appends the failure when the stream dies halfway", async () => {
    streamMock.mockImplementation(async (_data: unknown, handlers: { onDelta: (delta: string) => void }) => {
      handlers.onDelta("半句翻译")
      throw new Error("翻译连接中断，请重试")
    })

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    expect(await screen.findByText(/翻译连接中断，请重试/)).toBeInTheDocument()
    // The partial answer is not wiped out by the failure beneath it.
    expect(screen.getByText("半句翻译")).toBeInTheDocument()
  })

  it("does not offer to collect before anything has streamed in", async () => {
    let emitDelta: (delta: string) => void = () => {}
    streamMock.mockImplementation((_data: unknown, handlers: { onDelta: (delta: string) => void }) =>
      new Promise<string>((resolve) => {
        emitDelta = handlers.onDelta
        void resolve
      }))

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await screen.findByText("翻译中...", { selector: "div" })
    expect(screen.getByTitle("加入生词本")).toBeDisabled()

    emitDelta("答案")

    await waitFor(() => {
      expect(screen.getByTitle("加入生词本")).toBeEnabled()
    })
  })

  it("saves the streamed answer to the vocabulary book", async () => {
    streamMock.mockImplementation(async (_data: unknown, handlers: { onDelta: (delta: string) => void }) => {
      handlers.onDelta("答案 ")
      return "答案"
    })
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "addVocabularyWord") {
        return Promise.resolve("word-id")
      }
      return Promise.resolve(null)
    })

    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(screen.getByTitle("加入生词本")).toBeEnabled()
    })

    fireEvent.click(screen.getByTitle("加入生词本"))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("addVocabularyWord", expect.objectContaining({
        word: "ephemeral",
        translation: "答案",
      }))
    })
  })
})

describe("selection toolbar result popover placement", () => {
  const originalSetCapture = Element.prototype.setPointerCapture
  const originalReleaseCapture = Element.prototype.releasePointerCapture

  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.last = null
    selectionMock.current = { text: "ephemeral", rect: new DOMRect(0, 100, 80, 20), isVisible: true }
    sendMessageMock.mockResolvedValue(null)
    streamMock.mockResolvedValue("答案")
    vi.stubGlobal("AudioContext", FakeAudioContext)
    // jsdom ships neither of these, and the drag handle calls both.
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Element.prototype.setPointerCapture = originalSetCapture
    Element.prototype.releasePointerCapture = originalReleaseCapture
  })

  function popover() {
    return document.querySelector(".vibe-selection-popover") as HTMLElement
  }

  it("bolts the answer to the right-centre of the viewport instead of under the capsule", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    const style = popover().style
    expect(style.position).toBe("fixed")
    expect(style.right).toBe("16px")
    expect(style.top).toBe("50%")
    // Vertically centred against the viewport, not anchored to the selection.
    expect(style.transform).toBe("translateY(-50%)")
  })

  it("keeps the popover inside the toolbar root, so clicks in it are not clicks outside", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    // The wrapper is what the selection hook treats as "inside". If the popover
    // ever moves out of it, scrolling the result would count as a click outside
    // and strand the capsule.
    const capsule = screen.getByTitle("翻译").closest(".notranslate") as HTMLElement
    expect(popover().parentElement).toBe(capsule.parentElement)
  })

  it("leaves the wrapper transform-free so the fixed popover is really fixed", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    const capsule = screen.getByTitle("翻译").closest(".notranslate") as HTMLElement
    // The centring transform belongs on the capsule. On the wrapper it would
    // become the containing block for the fixed popover and drag it back down
    // to the selection.
    expect(capsule.style.transform).toBe("translateX(-50%) translateY(-100%)")
    expect((capsule.parentElement as HTMLElement).style.transform).toBe("")
    expect((capsule.parentElement as HTMLElement).style.position).toBe("fixed")
  })

  it("drags in viewport pixels and clamps to the viewport", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    // jsdom has no layout, so feed the drag handle the box the popover occupies.
    vi.spyOn(popover(), "getBoundingClientRect").mockReturnValue(new DOMRect(600, 100, 380, 500))

    const handle = popover().querySelector("[title='按住拖动']") as HTMLElement
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 460, clientY: 380 })
    fireEvent.pointerUp(handle, { clientX: 460, clientY: 380, pointerId: 1 })

    const style = popover().style
    // Plain viewport delta: 600 + (460 - 500), 100 + (380 - 400).
    expect(style.left).toBe("560px")
    expect(style.top).toBe("80px")
    // Once dragged it no longer claims the default right-centre spot.
    expect(style.right).toBe("")
    expect(style.transform).toBe("")
  })

  it("clamps a drag to the viewport instead of letting the popover escape", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())
    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    vi.spyOn(popover(), "getBoundingClientRect").mockReturnValue(new DOMRect(600, 100, 380, 500))

    const handle = popover().querySelector("[title='按住拖动']") as HTMLElement
    // Far off the top-left corner: the popover stops at the viewport margin.
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -200, clientY: -200 })
    fireEvent.pointerUp(handle, { clientX: -200, clientY: -200, pointerId: 1 })

    expect(popover().style.left).toBe("8px")
    expect(popover().style.top).toBe("8px")
  })

  it("hands the next translation the default right-centre spot again", async () => {
    render(<SelectionToolbar />)
    fireEvent.click(translateButton())
    await waitFor(() => {
      expect(popover()).toBeInTheDocument()
    })

    vi.spyOn(popover(), "getBoundingClientRect").mockReturnValue(new DOMRect(600, 100, 380, 500))

    const handle = popover().querySelector("[title='按住拖动']") as HTMLElement
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 460, clientY: 380 })
    fireEvent.pointerUp(handle, { clientX: 460, clientY: 380, pointerId: 1 })

    expect(popover().style.left).toBe("560px")

    // A fresh translation resets it.
    fireEvent.click(translateButton())

    await waitFor(() => {
      expect(popover().style.right).toBe("16px")
    })
    expect(popover().style.left).toBe("")
  })
})
