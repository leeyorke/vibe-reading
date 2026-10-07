import type { Mock } from "vitest"
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTextSelection } from "../use-text-selection"

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
