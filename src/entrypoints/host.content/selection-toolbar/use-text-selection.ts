import { useCallback, useEffect, useRef, useState } from "react"

export interface SelectionState {
  /** The selected text content */
  text: string
  /** Bounding rect of the selection (for positioning the toolbar) */
  rect: DOMRect | null
  /** Whether the selection is visible/non-empty */
  isVisible: boolean
}

const TOOLBAR_HEIGHT = 40
const TOOLBAR_MARGIN = 8

/**
 * Tracks text selection on the page and returns position + text.
 * Only active in the top window (not iframes).
 */
export function useTextSelection(toolbarRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionState>({
    text: "",
    rect: null,
    isVisible: false,
  })

  // Store the last mousedown timestamp for hide-on-outside-click logic
  // Instead of using setTimeout for hide, we record the time and let mouseup decide
  const lastMousedownOutsideRef = useRef(0)

  const updateSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelection(prev => (prev.isVisible ? { text: "", rect: null, isVisible: false } : prev))
      return
    }

    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    // Adjust position above selection
    // getBoundingClientRect returns viewport-relative coords, matching position: fixed
    const adjustedRect = new DOMRect(
      rect.left,
      rect.top - TOOLBAR_HEIGHT - TOOLBAR_MARGIN,
      rect.width,
      rect.height,
    )

    setSelection({ text, rect: adjustedRect, isVisible: true })
  }, [])

  const hideToolbar = useCallback(() => {
    setSelection({ text: "", rect: null, isVisible: false })
  }, [])

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

  return selection
}
