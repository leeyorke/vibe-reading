// @vitest-environment jsdom
import type { VocabularyWord } from "@/types/vocabulary"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// The real layout pulls in the sidebar, which needs a provider this test has
// no use for.
vi.mock("../../../components/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const AUDIO_BASE64 = btoa(String.fromCharCode(0xFF, 0xFB, 0x90, 0x00))

/** The cards the background hands out for the session. */
let sessionWords: VocabularyWord[] = []

function card(overrides: Partial<VocabularyWord> = {}): VocabularyWord {
  return {
    id: "word-1",
    word: "ephemeral",
    translation: "ephemeral\n英 /ɪˈfem(ə)rəl/ 美 /ɪˈfem(ə)rəl/\n1. adj. 短暂的",
    sourceLanguage: "eng",
    star: 3,
    createdAt: 0,
    reviewCount: 0,
    ...overrides,
  }
}

const { FlashcardsPage } = await import("../flashcard-session")

function speakButton() {
  return screen.getByTitle("朗读单词")
}

async function startSession(words: VocabularyWord[] = [card()]) {
  sessionWords = words
  render(<FlashcardsPage />)
  fireEvent.click(screen.getByText("开始复习"))
  await waitFor(() => expect(screen.getByTitle("朗读单词")).toBeInTheDocument())
  return words
}

describe("flashcard read-aloud button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeAudioContext.instances = []
    sessionWords = [card()]
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "getFlashcardSession") {
        return Promise.resolve(sessionWords)
      }
      if (type === "synthesizeSpeechAudio") {
        return Promise.resolve(AUDIO_BASE64)
      }
      return Promise.resolve(null)
    })
    vi.stubGlobal("AudioContext", FakeAudioContext)
  })

  it("asks the background to pronounce the word of the card", async () => {
    await startSession()

    fireEvent.click(speakButton())

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "ephemeral",
      sourceLanguage: "eng",
    }))
    // The source only starts after the audio has been fetched and decoded, so
    // asserting right after the message was sent is a race.
    await waitFor(() => expect(FakeAudioContext.instances[0]?.source.started).toBe(true))
    const context = FakeAudioContext.instances[0]
    // An unconnected source node plays into nothing — no error, no sound.
    expect(context.source.connectedTo).toBe(context.destination)
  })

  it("guesses the language when the card does not record one", async () => {
    await startSession([card({ sourceLanguage: undefined })])

    fireEvent.click(speakButton())

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "ephemeral",
      sourceLanguage: "en",
    }))
  })

  it("does not flip the card when the button is clicked", async () => {
    await startSession()

    fireEvent.click(speakButton())

    // The definition belongs to the back of the card; a click on the speaker
    // must not turn the card over.
    expect(screen.queryByText(/短暂的/)).not.toBeInTheDocument()
  })

  it("reads the word again from the back of the card", async () => {
    await startSession()

    fireEvent.click(screen.getByText("ephemeral"))
    await waitFor(() => expect(screen.getByText(/短暂的/)).toBeInTheDocument())

    fireEvent.click(speakButton())

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("synthesizeSpeechAudio", {
      text: "ephemeral",
      sourceLanguage: "eng",
    }))
  })

  it("turns into a stop button while the word is being read", async () => {
    await startSession()

    fireEvent.click(speakButton())

    await waitFor(() => expect(screen.getByTitle("停止朗读")).toBeInTheDocument())
  })

  it("stops the audio when the card is left behind", async () => {
    await startSession([card(), card({ id: "word-2", word: "lucid" })])

    fireEvent.click(speakButton())
    await waitFor(() => expect(screen.getByTitle("停止朗读")).toBeInTheDocument())

    // Flipping the card over does not change the word, but rating it moves on
    // to the next card, and the old word must not keep talking.
    fireEvent.click(screen.getByText("ephemeral"))
    await waitFor(() => expect(screen.getByText(/短暂的/)).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle("5 星")[0])

    await waitFor(() => expect(FakeAudioContext.instances[0].source.stopped).toBe(true))
    await waitFor(() => expect(screen.getByText("lucid")).toBeInTheDocument())
  })

  it("stops the audio when the session ends", async () => {
    await startSession([card()])

    fireEvent.click(speakButton())
    await waitFor(() => expect(screen.getByTitle("停止朗读")).toBeInTheDocument())

    fireEvent.click(screen.getByText("ephemeral"))
    await waitFor(() => expect(screen.getByText(/短暂的/)).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle("5 星")[0])

    await waitFor(() => expect(FakeAudioContext.instances[0].source.stopped).toBe(true))
  })

  it("shows the phonetic of a card that carries one", async () => {
    // A phonetic the card's own definition text does not contain, so the
    // assertion cannot accidentally match the embedded 英/美 lines.
    await startSession([card({ phonetic: "/ˈɛfəm(ə)rəl/" })])

    fireEvent.click(screen.getByText("ephemeral"))

    await waitFor(() => {
      expect(screen.getByText("/ˈɛfəm(ə)rəl/")).toBeInTheDocument()
    })
  })

  it("leaves the phonetic out when the card has none", async () => {
    await startSession([card({ translation: "ephemeral\n1. adj. 短暂的" })])

    fireEvent.click(screen.getByText("ephemeral"))

    await waitFor(() => expect(screen.getByText(/短暂的/)).toBeInTheDocument())
    expect(screen.queryByText(/^\/.*\/$/)).not.toBeInTheDocument()
  })
})
