// @vitest-environment jsdom
import type { VocabularyWord } from "@/types/vocabulary"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { VocabularyPage } from "../vocabulary-page"

const { sendMessageMock, toastMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("@/utils/i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("sonner", () => ({
  toast: toastMock,
}))

vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}))

// The real layout pulls in the sidebar, which needs a provider this test has
// no use for.
vi.mock("../../../components/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function word(overrides: Partial<VocabularyWord> = {}): VocabularyWord {
  return {
    id: "w1",
    word: "ephemeral",
    translation: "adj. 短暂的",
    sourceLanguage: "eng",
    star: 3,
    createdAt: 0,
    reviewCount: 0,
    source: "local",
    ...overrides,
  }
}

/** The words the backend hands out, keyed by the source that was asked for. */
let words: VocabularyWord[] = []

/** How many words each source holds */
let bySource = { all: 0, local: 0, eudic: 0 }

function route() {
  sendMessageMock.mockImplementation((type: string) => {
    if (type === "getVocabularyWords")
      return Promise.resolve({ words, total: words.length, bySource })
    if (type === "updateVocabularyWord")
      return Promise.resolve({})
    if (type === "deleteVocabularyWord")
      return Promise.resolve({})
    return Promise.resolve(null)
  })
}

describe("vocabulary page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    words = [word()]
    bySource = { all: 1, local: 1, eudic: 0 }
    route()
  })

  it("asks for every source by default", async () => {
    render(<VocabularyPage />)

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "getVocabularyWords",
        expect.objectContaining({ source: "all" }),
      )
    })
  })

  it("shows how many words each source holds", async () => {
    bySource = { all: 407, local: 398, eudic: 9 }
    route()

    render(<VocabularyPage />)

    // The counts have to be on screen without opening a menu — the Eudic
    // words sit on the last page of the default sort otherwise.
    await waitFor(() => {
      expect(screen.getByText("欧路").parentElement?.textContent).toContain("9")
    })
  })

  it("asks the backend for one source when the filter changes", async () => {
    render(<VocabularyPage />)

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled())

    fireEvent.click(screen.getByText("欧路"))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "getVocabularyWords",
        expect.objectContaining({ source: "eudic" }),
      )
    })
  })

  it("marks a word that came from Eudic and shows its phonetic", async () => {
    words = [word({ source: "eudic", phonetic: "/ɪˈfemərəl/" })]
    bySource = { all: 1, local: 0, eudic: 1 }
    route()

    render(<VocabularyPage />)

    await waitFor(() => {
      expect(screen.getByText("/ɪˈfemərəl/")).toBeInTheDocument()
    })
    expect(screen.getByTitle("来自欧路生词本")).toBeInTheDocument()
  })

  it("warns when a rating did not reach Eudic", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "getVocabularyWords")
        return Promise.resolve({ words: [word({ source: "eudic" })], total: 1, bySource })
      if (type === "updateVocabularyWord")
        return Promise.resolve({ eudicSync: { ok: false, error: "token 无效" } })
      return Promise.resolve(null)
    })

    render(<VocabularyPage />)

    await waitFor(() => expect(screen.getByText("ephemeral")).toBeInTheDocument())

    fireEvent.click(screen.getByTitle("5 星"))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("token 无效"),
      )
    })
  })
})
