import type { VocabularyWord } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { useSpeechPlayback } from "@/hooks/use-speech-playback"
import { sendMessage } from "@/utils/message"
import { errorMessage } from "@/utils/message-retry"

interface VocabularyDetailProps {
  word: VocabularyWord
  onDelete: (word: VocabularyWord) => void
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * The right-hand pane of the vocabulary page: everything the book has saved
 * about one word or sentence, read-only apart from the note and the star.
 *
 * It only reads fields already on the record — no dictionary lookup — so the
 * pane works offline and never disagrees with what the list row shows.
 */
export function VocabularyDetail({ word, onDelete }: VocabularyDetailProps) {
  const {
    state: speechState,
    speakingText,
    speak,
    stop: stopSpeaking,
  } = useSpeechPlayback()

  // A new word is a new voice: whatever the previous one was saying gives way,
  // exactly as the flashcard page does between cards.
  useEffect(() => {
    stopSpeaking()
  }, [word.id, stopSpeaking])

  const isMine = speakingText === word.word
  const isSpeaking = isMine && speechState === "playing"
  const isLoadingSpeech = isMine && speechState === "loading"

  return (
    <div className="flex h-full flex-col gap-6 text-sm">
      {/* Headword, with the destructive action pinned to the pane's top-right */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl break-words font-semibold tracking-tight">{word.word}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              title={isSpeaking ? "停止朗读" : "朗读"}
              aria-label={isSpeaking ? "停止朗读" : "朗读"}
              onClick={() => void speak(word.word, { sourceLanguage: word.sourceLanguage })}
            >
              <Icon
                icon={isSpeaking
                  ? "tabler:player-stop-filled"
                  : isLoadingSpeech
                    ? "tabler:loader-2"
                    : "tabler:volume"}
                className={`size-4 ${isLoadingSpeech ? "animate-spin" : ""}`}
              />
            </Button>
            {word.source === "eudic" && (
              <Badge variant="outline" size="sm" className="text-[10px]">
                欧路
              </Badge>
            )}
            {word.contextUrl && (
              <a
                href={word.contextUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground shrink-0 hover:text-foreground"
                title="查看原文页面"
              >
                <Icon icon="tabler:external-link" className="size-4" />
              </a>
            )}
          </div>

          {word.phonetic && (
            <p className="mt-1 font-serif text-muted-foreground">{word.phonetic}</p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          title={word.source === "eudic" ? "删除（同时删除欧路收藏）" : "删除"}
          aria-label="删除"
          onClick={() => onDelete(word)}
        >
          <Icon icon="tabler:trash" className="size-4" />
        </Button>
      </div>

      {/* Definition — rendered as Markdown, since sentence entries store a full
          LLM breakdown (headings, bold, code fences, lists) in this field. */}
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">释义</h3>
        {word.translation.trim()
          ? <MarkdownDefinition content={word.translation} />
          : <p className="text-muted-foreground">暂无释义</p>}
      </section>

      {/* Context sentence */}
      {word.contextText && word.contextText !== word.word && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">例句</h3>
          <blockquote className="border-l-2 pl-3 text-muted-foreground italic [overflow-wrap:anywhere]">
            {word.contextText}
          </blockquote>
        </section>
      )}

      {/* 出处 — the full sentence the word was collected from (frontend collect only) */}
      {word.from && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">出处</h3>
          <blockquote className="border-l-2 pl-3 text-muted-foreground [overflow-wrap:anywhere]">
            {word.from}
          </blockquote>
        </section>
      )}

      {/* Note */}
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">笔记</h3>
        <NoteEditor key={word.id} word={word} />
      </section>

      {/* Meta */}
      <section className="space-y-1 text-xs text-muted-foreground">
        <div>
          收藏时间：
          {word.createdAt ? formatDate(word.createdAt) : "—"}
        </div>
        <div>
          复习次数：
          {word.reviewCount}
        </div>
      </section>
    </div>
  )
}

/**
 * Renders the stored definition as GitHub-flavored Markdown.
 *
 * Sentence entries keep a whole LLM breakdown in this field — headings, bold,
 * code fences, nested lists — so it has to be rendered, not printed as text.
 * Single-word dictionary entries hold plain text ("1. n. 创造力"), which the
 * same renderer degrades gracefully: a sense line just becomes a list item.
 *
 * Unlike the selection toolbar's `MarkdownContent` (which lives in a Shadow DOM
 * and hard-codes light colours), this styles children through Tailwind so it
 * follows the options page theme, dark mode included.
 */
function MarkdownDefinition({ content }: { content: string }) {
  return (
    <div className="text-sm [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-medium [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:font-medium [&_hr]:border-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5 [&_p]:my-1.5 [&_p]:leading-6 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_strong]:font-semibold [&_table]:my-2 [&_table]:text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

/**
 * The note field of one word, edited in place and saved on blur.
 *
 * Keyed by the word's id, so switching words remounts it and the draft always
 * starts from what is actually stored rather than the previous word's text.
 */
function NoteEditor({ word }: { word: VocabularyWord }) {
  const [draft, setDraft] = useState(word.note ?? "")
  const [saving, setSaving] = useState(false)

  async function handleBlur() {
    const next = draft.trim()
    if (next === (word.note ?? "").trim()) {
      return
    }

    setSaving(true)
    try {
      await sendMessage("updateVocabularyWord", { id: word.id, updates: { note: next } })
    }
    catch (error) {
      toast.error(`笔记保存失败：${errorMessage(error)}`)
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <Textarea
        value={draft}
        placeholder="添加笔记..."
        onChange={e => setDraft(e.target.value)}
        onBlur={() => void handleBlur()}
        className="min-h-20"
      />
      {saving && <p className="text-xs text-muted-foreground">保存中...</p>}
    </div>
  )
}
