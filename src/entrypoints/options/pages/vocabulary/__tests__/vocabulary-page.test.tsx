// @vitest-environment jsdom
import type { VocabularyWord } from "@/types/vocabulary"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

// EntityListRail watches its scroll container with a ResizeObserver, which
// jsdom does not ship. The observed element reports zero size here, so a
// no-op observer is enough — the rail just never shows its scroll arrows.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

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

/**
 * The detail pane's own copy of a word. The list row and the detail heading
 * both render the word itself, so the heading (which only the detail has) is
 * the unambiguous way to tell which word the pane is showing.
 */
function detailHeading(name: string) {
  return screen.getByRole("heading", { name })
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

    await waitFor(() => expect(detailHeading("ephemeral")).toBeInTheDocument())

    fireEvent.click(screen.getByTitle("5 星"))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("token 无效"),
      )
    })
  })

  it("selects the first word on load and shows its detail", async () => {
    words = [word(), word({ id: "w2", word: "serene" })]
    bySource = { all: 2, local: 2, eudic: 0 }
    route()

    render(<VocabularyPage />)

    await waitFor(() => expect(detailHeading("ephemeral")).toBeInTheDocument())

    // The detail pane carries what the list row does not: an editable note.
    expect(screen.getByPlaceholderText("添加笔记...")).toBeInTheDocument()
    expect(screen.getByText(/复习次数/)).toBeInTheDocument()
  })

  it("switches the detail when another word is clicked", async () => {
    words = [word(), word({ id: "w2", word: "serene", translation: "adj. 平静的" })]
    bySource = { all: 2, local: 2, eudic: 0 }
    route()

    render(<VocabularyPage />)

    await waitFor(() => expect(detailHeading("ephemeral")).toBeInTheDocument())

    // "serene" is not the selected word yet, so it only appears in the list.
    fireEvent.click(screen.getByText("serene"))

    await waitFor(() => expect(detailHeading("serene")).toBeInTheDocument())
  })

  it("falls back to the first word when the selected word is deleted", async () => {
    const store = [word(), word({ id: "w2", word: "serene", translation: "adj. 平静的" })]
    sendMessageMock.mockImplementation((type: string, payload: { id?: string }) => {
      if (type === "getVocabularyWords") {
        // A fresh array each call, as the backend would hand back — handing the
        // same reference would let React bail out of the post-delete re-render.
        return Promise.resolve({
          words: [...store],
          total: store.length,
          bySource: { all: store.length, local: store.length, eudic: 0 },
        })
      }
      if (type === "deleteVocabularyWord") {
        const index = store.findIndex(w => w.id === payload?.id)
        if (index >= 0)
          store.splice(index, 1)
        return Promise.resolve({})
      }
      return Promise.resolve(null)
    })

    render(<VocabularyPage />)

    await waitFor(() => expect(detailHeading("ephemeral")).toBeInTheDocument())

    fireEvent.click(screen.getByText("serene"))
    await waitFor(() => expect(detailHeading("serene")).toBeInTheDocument())

    // The delete action lives in the detail pane.
    fireEvent.click(screen.getByTitle("删除"))

    await waitFor(() => expect(detailHeading("ephemeral")).toBeInTheDocument())
  })

  it("shows an empty-state hint in the detail pane when the book is empty", async () => {
    words = []
    bySource = { all: 0, local: 0, eudic: 0 }
    route()

    render(<VocabularyPage />)

    await waitFor(() => {
      expect(screen.getByText("还没有生词，划词翻译时收藏即可加入")).toBeInTheDocument()
    })
    expect(screen.getByText("从左侧选择一个单词查看详情")).toBeInTheDocument()
  })

  it("renders the note editor for the selected word and saves on blur", async () => {
    words = [word({ note: " 旧的笔记 " })]
    route()

    render(<VocabularyPage />)

    const note = await waitFor(() => screen.getByPlaceholderText("添加笔记..."))
    expect(note).toHaveValue(" 旧的笔记 ")

    // Re-rendering the same content is a no-op: no write goes out.
    fireEvent.blur(note)
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      "updateVocabularyWord",
      expect.objectContaining({ updates: expect.objectContaining({ note: expect.any(String) }) }),
    )

    const pane = within(note.closest("section")!.parentElement!)
    fireEvent.change(pane.getByPlaceholderText("添加笔记..."), {
      target: { value: "新的笔记" },
    })
    fireEvent.blur(screen.getByPlaceholderText("添加笔记..."))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("updateVocabularyWord", {
        id: "w1",
        updates: { note: "新的笔记" },
      })
    })
  })

  it("renders a sentence's Markdown breakdown instead of raw markers", async () => {
    // Sentence entries store an LLM breakdown in the translation field. The
    // markers have to become elements — a bare "**语法**" on screen would mean
    // the pane is printing the source, not rendering it.
    words = [word({
      word: "When you're left with no option",
      translation: "## 句子解析\n\n**原文**：When you're left with no option\n\n- 省略了主句\n- 被动语态",
    })]
    route()

    render(<VocabularyPage />)

    await waitFor(() => expect(detailHeading("When you're left with no option")).toBeInTheDocument())

    // The heading and the emphasised label come out as real elements.
    expect(screen.getByRole("heading", { name: "句子解析" })).toBeInTheDocument()
    const emphasised = screen.getByText("原文")
    expect(emphasised).toBeInTheDocument()
    expect(emphasised.closest("strong")).not.toBeNull()

    // The list markers are consumed by the list, not shown as literal dashes.
    expect(screen.getByText("省略了主句")).toBeInTheDocument()

    // No raw Markdown markers survive anywhere in the definition: the source is
    // rendered, not printed. Check the whole pane's text, since a marker could
    // hide inside any element.
    const definition = screen.getByRole("heading", { name: "句子解析" }).closest("section")
    expect(definition?.textContent).not.toContain("**")
    expect(definition?.textContent).not.toContain("##")
  })
})
