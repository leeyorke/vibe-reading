import type { Mock } from "vitest"
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { extractSentence, useTextSelection } from "../use-text-selection"

// jsdom ships no layout, so `Range.getBoundingClientRect()` is missing entirely.
// Install it once per test and let each test steer what it reports.
let rectSpy: Mock
let rect: DOMRect

/** Puts a real range over real text in the document, so `Selection.toString()` works. */
function selectText(text: string) {
  const host = document.createElement("div")
  host.textContent = text
  document.body.appendChild(host)

  const range = document.createRange()
  range.selectNodeContents(host)

  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  return range
}

/** Lets the queued animation frames run, which is when the hook measures. */
function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve(null)))
}

/**
 * Builds a real `<p>` holding `text`, then selects the substring `word` inside
 * it — the shape of a user dragging over one word of a sentence. Returns the
 * range so tests can hand it straight to `extractSentence`.
 */
function selectWordIn(text: string, word: string) {
  const p = document.createElement("p")
  p.textContent = text
  document.body.appendChild(p)

  const start = text.indexOf(word)
  expect(start).toBeGreaterThanOrEqual(0)

  const range = document.createRange()
  range.setStart(p.firstChild!, start)
  range.setEnd(p.firstChild!, start + word.length)
  return range
}

describe("useTextSelection", () => {
  beforeEach(() => {
    rect = new DOMRect(0, 0, 0, 0)
    rectSpy = vi.fn(() => rect)
    Range.prototype.getBoundingClientRect = rectSpy
    document.body.innerHTML = ""
    window.getSelection()?.removeAllRanges()
  })

  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect")
  })

  it("re-measures the selection when the page scrolls, so the capsule follows the text", async () => {
    rect = new DOMRect(100, 300, 80, 20)
    selectText("ephemeral")

    const { result } = renderHook(() => useTextSelection({ current: null }))

    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"))
      await nextFrame()
    })

    expect(result.current.isVisible).toBe(true)
    expect(result.current.rect?.top).toBe(300 - 40 - 8)

    // The page scrolled: the same text now sits higher in the viewport.
    rect = new DOMRect(100, 120, 80, 20)
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await nextFrame()
    })

    expect(result.current.rect?.top).toBe(120 - 40 - 8)
    expect(result.current.text).toBe("ephemeral")
  })

  it("keeps measuring from the stored range after the browser drops the selection", async () => {
    // Clicking inside the Shadow-DOM toolbar clears the document selection, so
    // the scroll syncer has nothing live to read — it must fall back to the
    // range captured while the selection was live.
    rect = new DOMRect(100, 300, 80, 20)
    selectText("ephemeral")

    const { result } = renderHook(() => useTextSelection({ current: null }))

    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"))
      await nextFrame()
    })

    window.getSelection()?.removeAllRanges()

    rect = new DOMRect(100, 40, 80, 20)
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await nextFrame()
    })

    expect(result.current.isVisible).toBe(true)
    expect(result.current.rect?.top).toBe(40 - 40 - 8)
  })

  it("stops measuring once the selection is dismissed", async () => {
    rect = new DOMRect(100, 300, 80, 20)
    selectText("ephemeral")

    const { result } = renderHook(() => useTextSelection({ current: null }))

    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"))
      await nextFrame()
    })

    // A click elsewhere with no selection left is what dismisses the toolbar.
    await act(async () => {
      window.getSelection()?.removeAllRanges()
      document.dispatchEvent(new MouseEvent("mousedown"))
      document.dispatchEvent(new MouseEvent("mouseup"))
    })

    expect(result.current.isVisible).toBe(false)

    rectSpy.mockClear()
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await nextFrame()
    })

    expect(rectSpy).not.toHaveBeenCalled()
  })

  it("pays nothing for scrolling a page that was never selected on", async () => {
    const { result } = renderHook(() => useTextSelection({ current: null }))

    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await nextFrame()
    })

    expect(result.current.isVisible).toBe(false)
    expect(rectSpy).not.toHaveBeenCalled()
  })
})

describe("extractSentence", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("returns the whole sentence a mid-sentence word sits inside", () => {
    const range = selectWordIn("When you're left with no option.", "option")
    expect(extractSentence(range)).toBe("When you're left with no option.")
  })

  it("isolates one sentence from a multi-sentence paragraph", () => {
    const range = selectWordIn(
      "First sentence here. The quick brown fox jumps. Third one follows.",
      "fox",
    )
    expect(extractSentence(range)).toBe("The quick brown fox jumps.")
  })

  it("captures a word at the very start of the paragraph", () => {
    const range = selectWordIn("Creativity is intelligence having fun.", "Creativity")
    expect(extractSentence(range)).toBe("Creativity is intelligence having fun.")
  })

  it("keeps the selected text itself when the selection spans two paragraphs", () => {
    // A cross-paragraph selection has an endpoint outside the block, so the
    // slice against one block would be garbled — fall back to the selection.
    const p1 = document.createElement("p")
    p1.textContent = "First paragraph."
    const p2 = document.createElement("p")
    p2.textContent = "Second paragraph."
    document.body.append(p1, p2)

    const range = document.createRange()
    range.setStart(p1.firstChild!, 0)
    range.setEnd(p2.firstChild!, "Second".length)

    expect(extractSentence(range)).toBe("First paragraph.Second")
  })

  it("returns empty for a selection with no text", () => {
    const p = document.createElement("p")
    p.textContent = "Some text."
    document.body.appendChild(p)

    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 0)

    expect(extractSentence(range)).toBe("")
  })

  it("returns empty when the selection is not inside a block container", () => {
    // Text nodes directly under body (no <p>/<div>/… ancestor) have no passage
    // to read a sentence out of.
    const text = document.createTextNode("Orphan words here.")
    document.body.appendChild(text)

    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, "Orphan".length)

    expect(extractSentence(range)).toBe("")
  })
})
