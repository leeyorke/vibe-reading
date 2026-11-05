import { useCallback, useEffect, useRef, useState } from "react"

export interface SelectionState {
  /** The selected text content */
  text: string
  /** Bounding rect of the selection (for positioning the toolbar) */
  rect: DOMRect | null
  /** Whether the selection is visible/non-empty */
  isVisible: boolean
  /**
   * The full sentence the selection sits inside (its 出处), e.g. selecting
   * "option" in "When you're left with no option." yields that whole
   * sentence. Empty when none can be determined.
   */
  sentence: string
}

const TOOLBAR_HEIGHT = 40
const TOOLBAR_MARGIN = 8

/** Characters that end a sentence — Latin and CJK terminators. */
const SENTENCE_END = /[.!?;。！？；]/

/**
 * Block-level containers we're willing to read a passage out of. We walk up
 * to the *nearest* one, so a word inside a `<p>` reads its paragraph rather
 * than a sprawling ancestor `<div>`.
 */
const BLOCK_SELECTOR
  = "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, pre, div, section, article"

/**
 * How many characters of `block`'s text precede `node`/`offset`.
 */
function offsetWithin(block: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange()
  r.selectNodeContents(block)
  try {
    r.setEnd(node, offset)
  }
  catch {
    return 0
  }
  return r.toString().length
}

/**
 * The full sentence (the word's 出处) that a selection sits inside.
 *
 * Walks up to the nearest block-level ancestor so the sentence is read from
 * the same passage the word lives in, locates the selection's character
 * offsets within that passage, then expands to the surrounding sentence
 * boundaries. Returns "" when nothing sensible can be determined — callers
 * store it as-is, and an empty 出处 is fine.
 */
export function extractSentence(range: Range): string {
  const selected = range.toString().trim()
  if (!selected) {
    return ""
  }

  let block: HTMLElement | null = null
  let node: Node | null = range.startContainer
  while (node) {
    if (node instanceof HTMLElement && node.matches(BLOCK_SELECTOR)) {
      block = node
      break
    }
    node = node.parentNode
  }
  if (!block) {
    return ""
  }

  const blockText = block.textContent ?? ""
  if (!blockText) {
    return ""
  }

  // A selection spanning several paragraphs has an endpoint outside this
  // block — offsets computed against `block` would be meaningless, so fall
  // back to the selection itself rather than a garbled slice.
  if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) {
    return selected
  }

  const startOffset = offsetWithin(block, range.startContainer, range.startOffset)
  const endOffset = offsetWithin(block, range.endContainer, range.endOffset)

  // Sentence start: just after the last terminator before the selection.
  let sentStart = 0
  for (let i = Math.min(startOffset, blockText.length) - 1; i >= 0; i--) {
    if (SENTENCE_END.test(blockText[i])) {
      sentStart = i + 1
      break
    }
  }

  // Sentence end: the first terminator at or after the selection's end.
  let sentEnd = blockText.length
  for (let i = Math.max(endOffset, 0); i < blockText.length; i++) {
    if (SENTENCE_END.test(blockText[i])) {
      sentEnd = i + 1
      break
    }
  }

  return blockText.slice(sentStart, sentEnd).replace(/\s+/g, " ").trim()
}

/**
 * Tracks text selection on the page and returns position + text.
 * Only active in the top window (not iframes).
 */
export function useTextSelection(toolbarRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionState>({
    text: "",
    rect: null,
    isVisible: false,
    sentence: "",
  })

  // Store the last mousedown timestamp for hide-on-outside-click logic
  // Instead of using setTimeout for hide, we record the time and let mouseup decide
  const lastMousedownOutsideRef = useRef(0)

  // The rect is viewport-relative, so scrolling walks the text out from under
  // the capsule. Re-measuring is the only way to catch up, and the selection
  // does not always survive to be re-read — a click inside the Shadow-DOM
  // toolbar clears it — so keep the range we measured while it was live and
  // fall back to it. Without this the capsule is stranded at wherever the
  // selection happened to be.
  const lastRangeRef = useRef<Range | null>(null)

  const measureRange = useCallback((range: Range) => {
    const rect = range.getBoundingClientRect()
    // Adjust position above selection.
    // getBoundingClientRect returns viewport-relative coords, matching position: fixed
    return new DOMRect(
      rect.left,
      rect.top - TOOLBAR_HEIGHT - TOOLBAR_MARGIN,
      rect.width,
      rect.height,
    )
  }, [])

  /** The range to measure: the live one if the browser still has it, ours otherwise. */
  const currentRange = useCallback((): Range | null => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim() !== "") {
      return sel.getRangeAt(0)
    }
    return lastRangeRef.current
  }, [])

  const updateSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      lastRangeRef.current = null
      setSelection(prev => (prev.isVisible ? { text: "", rect: null, isVisible: false, sentence: "" } : prev))
      return
    }

    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    lastRangeRef.current = range.cloneRange()

    setSelection({ text, rect: measureRange(range), isVisible: true, sentence: extractSentence(range) })
  }, [measureRange])

  const hideToolbar = useCallback(() => {
    lastRangeRef.current = null
    setSelection({ text: "", rect: null, isVisible: false, sentence: "" })
  }, [])

  /**
   * Re-measures after a scroll or a resize — what makes the capsule ride along
   * with the text it belongs to instead of being left behind mid-page.
   */
  const syncRect = useCallback(() => {
    const range = currentRange()
    if (!range) {
      return
    }

    setSelection((prev) => {
      const text = prev.text !== "" ? prev.text : range.toString().trim()
      if (text === "") {
        return prev
      }
      return { text, rect: measureRange(range), isVisible: true, sentence: prev.sentence }
    })
  }, [currentRange, measureRange])

  useEffect(() => {
    const isInsideToolbar = (e: Event) => {
      return toolbarRef.current && e.composedPath().includes(toolbarRef.current)
    }

    const handleMouseUp = (e: MouseEvent) => {
      // If clicking inside the toolbar, don't change anything
      if (isInsideToolbar(e)) {
        return
      }

      // Check if there's a selection after mouseup
      // If there IS a valid selection, this was a text selection action, not a click-outside
      const sel = window.getSelection()
      const hasSelection = sel && !sel.isCollapsed && sel.toString().trim()

      // If there was a recent mousedown outside AND there's no fresh selection,
      // this was a click-outside action → hide the toolbar
      const now = Date.now()
      if (!hasSelection && lastMousedownOutsideRef.current && now - lastMousedownOutsideRef.current < 300) {
        lastMousedownOutsideRef.current = 0
        hideToolbar()
        return
      }

      // Normal action: let selectionchange or updateSelection handle it
      lastMousedownOutsideRef.current = 0

      // If there's a valid selection from mouse drag, wait for browser to finish
      if (hasSelection) {
        requestAnimationFrame(updateSelection)
      }
    }

    const handleSelectionChange = () => {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        // Selection appeared (keyboard selection, or after mouse selection)
        requestAnimationFrame(updateSelection)
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (isInsideToolbar(e)) {
        return
      }
      // Don't hide immediately — just record the time.
      // mouseup will check this timestamp and hide if close enough.
      lastMousedownOutsideRef.current = Date.now()
    }

    document.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("mousedown", handleClickOutside)

    return () => {
      document.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("selectionchange", handleSelectionChange)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [updateSelection, hideToolbar, toolbarRef])

  // Scroll listeners live apart from the selection listeners above: they have to
  // stay subscribed whether or not the toolbar is currently showing, otherwise
  // the first scroll after a selection would be missed.
  useEffect(() => {
    let frame = 0

    const scheduleSync = () => {
      // One measurement per frame at most, and none at all when there is
      // nothing selected (every page scroll would otherwise pay for it).
      if (frame !== 0 || lastRangeRef.current == null) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        syncRect()
      })
    }

    // `capture` matters: a scroll inside an `overflow: auto` container never
    // bubbles to `window`, and pages are full of those.
    const scrollOptions = { capture: true, passive: true } as const
    window.addEventListener("scroll", scheduleSync, scrollOptions)
    window.addEventListener("resize", scheduleSync)

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
      window.removeEventListener("scroll", scheduleSync, scrollOptions)
      window.removeEventListener("resize", scheduleSync)
    }
  }, [syncRect])

  return selection
}
