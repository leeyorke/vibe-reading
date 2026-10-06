import type { PointerEvent as ReactPointerEvent } from "react"
import type { WordDefinition } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { MarkdownContent } from "./markdown-content"
import { errorMessage, EXTENSION_STALE_MESSAGE, isExtensionContextInvalidated, withMessageRetry } from "./message-retry"
import { useSpeechPlayback } from "./use-speech-playback"
import { useTextSelection } from "./use-text-selection"

interface ToolbarPosition {
  top: number
  left: number
}

interface PopoverPosition {
  left: number
  top: number
}

interface PopoverDragOrigin {
  // Popover offset relative to the toolbar wrapper while anchored
  left: number
  top: number
  pointerX: number
  pointerY: number
  wrapLeft: number
  wrapTop: number
}

const POPOVER_VIEWPORT_MARGIN = 8

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export function SelectionToolbar() {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selection = useTextSelection(toolbarRef)
  const { state: speakState, speak, stop: stopSpeaking } = useSpeechPlayback()
  const [translating, setTranslating] = useState(false)
  const [translation, setTranslation] = useState<string | null>(null)
  const [wordDef, setWordDef] = useState<WordDefinition | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  // Track whether we're in an "active" state (translating or showing result)
  // so the toolbar stays visible even after selection is cleared by clicking it
  const [pinned, setPinned] = useState(false)

  // The pinned rect saved from the original selection so we keep position
  const pinnedRectRef = useRef<DOMRect | null>(null)

  // Animation state for collect button
  const [collectState, setCollectState] = useState<"idle" | "collecting" | "collected">("idle")
  const collectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Reloading the extension leaves this script's context invalidated while the
  // page keeps running it — every button then fails with a message that names
  // none of that. Watch the one tell that does, and offer the way out. Seeded
  // eagerly so an already-dead script never renders live buttons at all.
  const [staleContext, setStaleContext] = useState(isExtensionContextInvalidated)
  const staleTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (staleContext)
      return

    staleTimerRef.current = window.setInterval(() => {
      if (!isExtensionContextInvalidated())
        return
      window.clearInterval(staleTimerRef.current)
      staleTimerRef.current = undefined
      stopSpeaking()
      setStaleContext(true)
    }, 1000)

    return () => {
      window.clearInterval(staleTimerRef.current)
      staleTimerRef.current = undefined
    }
  }, [staleContext, stopSpeaking])

  // Drag state for the result popover (positions are wrapper-relative pixels)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = useState<PopoverPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragOriginRef = useRef<PopoverDragOrigin | null>(null)

  // Show condition: either there's a fresh selection, or we're pinned (translating/showing result)
  const shouldShow = selection.isVisible || pinned

  // Use the freshest rect available
  const activeRect = selection.isVisible ? selection.rect : pinnedRectRef.current

  // When a new selection appears, reset translation state
  useEffect(() => {
    if (selection.isVisible) {
      // Pronunciation belongs to the old selection; drop it with the rest.
      stopSpeaking()
      setShowTranslation(false)
      setTranslation(null)
      setWordDef(null)
      setTranslating(false)
      setPinned(false)
      pinnedRectRef.current = null
      setCollectState("idle")
      clearTimeout(collectTimerRef.current)
      setPopoverPos(null)
      setDragging(false)
      dragOriginRef.current = null
    }
  }, [selection.isVisible, stopSpeaking])

  // Reset pinned state when user clicks outside (selection becomes invisible and not pinned)
  useEffect(() => {
    if (!selection.isVisible && !pinned) {
      stopSpeaking()
      setShowTranslation(false)
      setTranslation(null)
      setWordDef(null)
    }
  }, [selection.isVisible, pinned, stopSpeaking])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(collectTimerRef.current)
  }, [])

  const position: ToolbarPosition | null = shouldShow && activeRect
    ? {
        left: activeRect.left + activeRect.width / 2,
        top: activeRect.top,
      }
    : null

  const handleTranslate = useCallback(async () => {
    if (!selection.text || translating)
      return

    // Pin the toolbar and save rect position
    pinnedRectRef.current = selection.rect
    setPinned(true)
    setTranslating(true)
    setShowTranslation(true)
    setTranslation(null)
    setWordDef(null)
    // A fresh result snaps back to its anchored spot under the toolbar
    setPopoverPos(null)

    const trimmed = selection.text.trim()
    const wordCount = trimmed.split(/\s+/).length

    try {
      // Single word: try structured dictionary lookup first
      if (wordCount === 1) {
        const def = await withMessageRetry(() =>
          sendMessage("translateSelectedTextStructured", { text: trimmed }),
        )
        if (def) {
          setWordDef(def)
          setTranslating(false)
          return
        }
      }

      // Fallback to AI translation (multi-word or dictionary miss)
      const result = await withMessageRetry(() =>
        sendMessage("translateSelectedText", { text: selection.text }),
      )
      setTranslation(result)
    }
    catch (error) {
      // The real reason, not a shrug: a lost message port, a refused handler
      // and a provider error all look identical from the outside otherwise.
      logger.error("[SelectionToolbar] Translation failed:", error)
      setTranslation(`翻译失败：${errorMessage(error)}`)
    }
    finally {
      setTranslating(false)
    }
  }, [selection.text, selection.rect, translating])

  const handleAddToVocab = useCallback(async () => {
    if (!selection.text || collectState !== "idle")
      return

    // Determine the translation string to save
    let translationToSave: string | null = translation
    let wordToSave = selection.text

    if (!translationToSave && wordDef) {
      const ukPhonetic = wordDef.phoneticUK ?? ""
      const usPhonetic = wordDef.phoneticUS ?? ""
      const phoneticLine = ukPhonetic || usPhonetic
        ? `英 ${ukPhonetic || ""}${usPhonetic ? ` 美 ${usPhonetic}` : ""}`.trim()
        : ""
      const sensesLine = wordDef.senses
        .map(s => `${s.number}. ${wordDef.pos ? `${wordDef.pos}. ` : ""}${s.chineseDefinition}`)
        .join("\n")
      translationToSave = [wordDef.headword, phoneticLine, sensesLine]
        .filter(Boolean)
        .join("\n")
      wordToSave = wordDef.headword
    }

    if (!translationToSave)
      return

    setCollectState("collecting")

    try {
      await sendMessage("addVocabularyWord", {
        word: wordToSave,
        translation: translationToSave,
        contextUrl: window.location.href,
        contextText: selection.text,
      })
      setCollectState("collected")
      toast.success("已加入生词本")

      // Reset after 2 seconds
      clearTimeout(collectTimerRef.current)
      collectTimerRef.current = setTimeout(() => {
        setCollectState("idle")
      }, 2000)
    }
    catch {
      setCollectState("idle")
      toast.error("收藏失败")
    }
  }, [selection.text, translation, wordDef, collectState])

  // Dismiss toolbar and popover when user clicks outside
  const handleDismiss = useCallback(() => {
    stopSpeaking()
    setPinned(false)
    setShowTranslation(false)
    setTranslation(null)
    setWordDef(null)
    setTranslating(false)
    pinnedRectRef.current = null
    setCollectState("idle")
    clearTimeout(collectTimerRef.current)
    setPopoverPos(null)
  }, [stopSpeaking])

  // Drag the result popover via its top handle. The popover stays absolutely
  // positioned inside the fixed wrapper, so we only move it in wrapper-relative
  // coordinates — no position:fixed (the wrapper's transform would trap it).
  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const popover = popoverRef.current
    const wrapper = toolbarRef.current
    if (!popover || !wrapper || event.button !== 0)
      return

    event.preventDefault()
    const popRect = popover.getBoundingClientRect()
    const wrapRect = wrapper.getBoundingClientRect()
    dragOriginRef.current = {
      left: popRect.left - wrapRect.left,
      top: popRect.top - wrapRect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
      wrapLeft: wrapRect.left,
      wrapTop: wrapRect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  const handleDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    if (!origin)
      return

    const width = popoverRef.current?.offsetWidth ?? 0
    const height = popoverRef.current?.offsetHeight ?? 0
    const left = clampValue(
      origin.left + event.clientX - origin.pointerX,
      -origin.wrapLeft + POPOVER_VIEWPORT_MARGIN,
      window.innerWidth - origin.wrapLeft - width - POPOVER_VIEWPORT_MARGIN,
    )
    const top = clampValue(
      origin.top + event.clientY - origin.pointerY,
      -origin.wrapTop + POPOVER_VIEWPORT_MARGIN,
      window.innerHeight - origin.wrapTop - height - POPOVER_VIEWPORT_MARGIN,
    )
    setPopoverPos({ left, top })
  }, [])

  const handleDragEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current)
      return
    dragOriginRef.current = null
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    catch {
      // Capture was already released; nothing to do
    }
  }, [])

  const isCollectActive = collectState !== "idle"
  const hasResult = translation !== null || wordDef !== null
  const isCollectDisabled = !hasResult || isCollectActive

  if (!position) {
    return null
  }

  return (
    <div
      ref={toolbarRef}
      style={{
        position: "fixed",
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: "translateX(-50%) translateY(-100%)",
        zIndex: 2147483646,
        pointerEvents: "none",
      }}
    >
      {/* Floating toolbar buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 6px",
          background: "var(--color-surface, #fff)",
          border: "1px solid var(--color-border, #e5e7eb)",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontSize: "13px",
        }}
        className="notranslate"
      >
        {/* The extension was reloaded while this page stayed open: the script
            behind this toolbar lost its API bindings, so every action button
            would fail with a message that explains nothing. Offer the way out
            instead. */}
        {staleContext
          ? (
              <button
                onClick={() => window.location.reload()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "6px",
                  background: "var(--color-brand, #3b82f6)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 500,
                  pointerEvents: "auto",
                }}
                title={EXTENSION_STALE_MESSAGE}
              >
                <Icon icon="tabler:refresh" width="16" height="16" />
                {EXTENSION_STALE_MESSAGE}
              </button>
            )
          : (
              <>
                <button
                  onClick={handleTranslate}
                  disabled={translating}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    border: "none",
                    borderRadius: "6px",
                    background: "var(--color-brand, #3b82f6)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 500,
                    opacity: translating ? 0.6 : 1,
                    pointerEvents: "auto",
                  }}
                  title="翻译"
                >
                  <Icon icon="tabler:language" width="16" height="16" />
                  {translating ? "翻译中..." : "翻译"}
                </button>

                <button
                  onClick={() => void speak(selection.text)}
                  disabled={!selection.text || speakState === "loading"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    border: "1px solid",
                    borderRadius: "6px",
                    background: speakState === "playing" ? "var(--color-brand-50, #eff6ff)" : "transparent",
                    color: speakState === "playing" ? "var(--color-brand-700, #1d4ed8)" : "var(--color-text, #374151)",
                    borderColor: speakState === "playing" ? "var(--color-brand-300, #93c5fd)" : "var(--color-border, #e5e7eb)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 500,
                    opacity: selection.text ? 1 : 0.4,
                    transition: "all 0.2s ease",
                    pointerEvents: "auto",
                  }}
                  title={speakState === "playing" ? "停止朗读" : "朗读选中的句子或单词"}
                >
                  <Icon
                    icon={speakState === "playing" ? "tabler:player-stop-filled" : "tabler:volume"}
                    width="16"
                    height="16"
                    style={{
                      animation: speakState === "loading" ? "vibe-reading-spin 0.6s linear infinite" : "none",
                    }}
                  />
                  {speakState === "loading" ? "朗读中..." : speakState === "playing" ? "停止" : "朗读"}
                </button>

                <button
                  onClick={handleAddToVocab}
                  disabled={isCollectDisabled}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    border: "1px solid",
                    borderRadius: "6px",
                    background: isCollectActive ? "var(--color-green-100, #dcfce7)" : "transparent",
                    color: collectState === "collected" ? "var(--color-green-700, #15803d)" : "var(--color-text, #374151)",
                    borderColor: isCollectActive ? "var(--color-green-300, #86efac)" : "var(--color-border, #e5e7eb)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 500,
                    opacity: hasResult ? 1 : 0.4,
                    transition: "all 0.2s ease",
                    animation: isCollectActive ? "vibe-reading-bounce 0.3s ease" : "none",
                    pointerEvents: "auto",
                  }}
                  title={collectState === "collected" ? "已加入生词本" : "加入生词本"}
                >
                  <Icon
                    icon={collectState === "collected" ? "tabler:bookmark-filled" : "tabler:bookmark-plus"}
                    width="16"
                    height="16"
                    style={{
                      transition: "transform 0.2s ease",
                      transform: collectState === "collecting" ? "scale(1.2)" : "scale(1)",
                    }}
                  />
                  {collectState === "collected" ? "已收藏" : "收藏"}
                </button>
              </>
            )}

        {/* Close button when pinned */}
        {pinned && (
          <button
            onClick={handleDismiss}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              border: "none",
              borderRadius: "4px",
              background: "transparent",
              color: "var(--color-text, #374151)",
              cursor: "pointer",
              opacity: 0.5,
              pointerEvents: "auto",
            }}
            title="关闭"
          >
            <Icon icon="tabler:x" width="14" height="14" />
          </button>
        )}
      </div>

      {/* Translation result popover */}
      {showTranslation && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            ...(popoverPos
              ? { left: `${popoverPos.left}px`, top: `${popoverPos.top}px` }
              : { top: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)" }),
            minWidth: "240px",
            maxWidth: "380px",
            maxHeight: "65vh",
            background: "#fff",
            borderRadius: "15px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
            // Any non-visible overflow clips children to the rounded corners;
            // vertical scroll keeps long analysis results within the viewport.
            // The scrollbar itself is styled below so it never squares off the
            // rounded right corners.
            overflowX: "hidden",
            overflowY: "auto",
            color: "#1f2937",
            wordBreak: "break-word",
            pointerEvents: "auto",
          }}
          className={`notranslate vibe-selection-popover${dragging ? " vibe-selection-popover-dragging" : ""}`}
        >
          {/* Drag handle */}
          <div
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "16px",
              paddingTop: "2px",
              cursor: dragging ? "grabbing" : "grab",
              touchAction: "none",
              userSelect: "none",
            }}
            title="按住拖动"
          >
            <span style={{ width: "36px", height: "4px", borderRadius: "999px", background: "#d1d5db" }} />
          </div>
          {translating
            ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 18px", fontSize: "14px" }}>
                  <span style={{
                    width: "14px",
                    height: "14px",
                    border: "2px solid var(--color-border, #e5e7eb)",
                    borderTopColor: "var(--color-brand, #3b82f6)",
                    borderRadius: "50%",
                    animation: "vibe-reading-spin 0.6s linear infinite",
                  }}
                  />
                  翻译中...
                </div>
              )
            : wordDef
              ? (
                  <>
                    {/* Top blue accent bar */}
                    <div style={{ height: "3px", background: "var(--color-brand, #3b82f6)" }} />
                    <div style={{ padding: "16px 18px" }}>
                      {/* Headword + pos tag */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1.2, color: "#111827" }}>
                          {wordDef.headword}
                        </span>
                        {wordDef.pos && (
                          <span style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background: "var(--color-brand-50, #eff6ff)",
                            color: "var(--color-brand-700, #1d4ed8)",
                          }}
                          >
                            {wordDef.pos}
                          </span>
                        )}
                      </div>
                      {/* Phonetics */}
                      {(wordDef.phoneticUK || wordDef.phoneticUS) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                          {wordDef.phoneticUK && (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              padding: "3px 10px",
                              borderRadius: "999px",
                              background: "#f3f4f6",
                              color: "#4b5563",
                            }}
                            >
                              <span style={{ fontWeight: 600 }}>英</span>
                              <span style={{ fontFamily: "ui-serif, Georgia, serif" }}>
                                /
                                {wordDef.phoneticUK}
                                /
                              </span>
                            </span>
                          )}
                          {wordDef.phoneticUS && (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              padding: "3px 10px",
                              borderRadius: "999px",
                              background: "#f3f4f6",
                              color: "#4b5563",
                            }}
                            >
                              <span style={{ fontWeight: 600 }}>美</span>
                              <span style={{ fontFamily: "ui-serif, Georgia, serif" }}>
                                /
                                {wordDef.phoneticUS}
                                /
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      {/* Senses list */}
                      <ol style={{ listStyle: "none", padding: 0, margin: "14px 0 0 0", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {wordDef.senses.map(sense => (
                          <li
                            key={sense.number}
                            style={{
                              display: "flex",
                              gap: "8px",
                              fontSize: "14px",
                              lineHeight: 1.5,
                              color: "#374151",
                            }}
                          >
                            <span style={{ color: "var(--color-brand, #3b82f6)", fontWeight: 600, flexShrink: 0 }}>
                              {sense.number}
                              .
                            </span>
                            <span>{sense.chineseDefinition}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )
              : translation
                ? <MarkdownContent content={translation} />
                : null}
        </div>
      )}

      {/* Keyframes for spinner and bounce + popover scrollbar */}
      <style>
        {`
        @keyframes vibe-reading-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes vibe-reading-bounce {
          0% { transform: scale(1); }
          30% { transform: scale(1.15); }
          60% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        .vibe-selection-popover {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.22) transparent;
        }
        .vibe-selection-popover::-webkit-scrollbar {
          width: 6px;
        }
        .vibe-selection-popover::-webkit-scrollbar-track {
          background: transparent;
        }
        .vibe-selection-popover::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.18);
          border-radius: 3px;
        }
        .vibe-selection-popover-dragging {
          cursor: grabbing;
        }
      `}
      </style>
    </div>
  )
}
