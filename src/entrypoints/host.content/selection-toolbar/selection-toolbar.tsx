import type { WordDefinition } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { sendMessage } from "@/utils/message"
import { useTextSelection } from "./use-text-selection"

interface ToolbarPosition {
  top: number
  left: number
}

export function SelectionToolbar() {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selection = useTextSelection(toolbarRef)
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

  // Show condition: either there's a fresh selection, or we're pinned (translating/showing result)
  const shouldShow = selection.isVisible || pinned

  // Use the freshest rect available
  const activeRect = selection.isVisible ? selection.rect : pinnedRectRef.current

  // When a new selection appears, reset translation state
  useEffect(() => {
    if (selection.isVisible) {
      setShowTranslation(false)
      setTranslation(null)
      setWordDef(null)
      setTranslating(false)
      setPinned(false)
      pinnedRectRef.current = null
      setCollectState("idle")
      clearTimeout(collectTimerRef.current)
    }
  }, [selection.isVisible])

  // Reset pinned state when user clicks outside (selection becomes invisible and not pinned)
  useEffect(() => {
    if (!selection.isVisible && !pinned) {
      setShowTranslation(false)
      setTranslation(null)
      setWordDef(null)
    }
  }, [selection.isVisible, pinned])

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

    const trimmed = selection.text.trim()
    const wordCount = trimmed.split(/\s+/).length

    try {
      // Single word: try structured dictionary lookup first
      if (wordCount === 1) {
        const def = await sendMessage("translateSelectedTextStructured", {
          text: trimmed,
        })
        if (def) {
          setWordDef(def)
          setTranslating(false)
          return
        }
      }

      // Fallback to AI translation (multi-word or dictionary miss)
      const result = await sendMessage("translateSelectedText", {
        text: selection.text,
      })
      setTranslation(result)
    }
    catch {
      setTranslation("翻译失败，请重试")
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
    setPinned(false)
    setShowTranslation(false)
    setTranslation(null)
    setWordDef(null)
    setTranslating(false)
    pinnedRectRef.current = null
    setCollectState("idle")
    clearTimeout(collectTimerRef.current)
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
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: "240px",
            maxWidth: "380px",
            background: "#fff",
            borderRadius: "15px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
            overflow: "hidden",
            color: "#1f2937",
            wordBreak: "break-word",
            pointerEvents: "auto",
          }}
          className="notranslate"
        >
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
              : (
                  <div style={{ padding: "14px 18px", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {translation}
                  </div>
                )}
        </div>
      )}

      {/* Keyframes for spinner and bounce */}
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
      `}
      </style>
    </div>
  )
}
