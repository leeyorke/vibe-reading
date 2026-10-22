import type { SpeechPlaybackState } from "@/hooks/use-speech-playback"
import type { VocabularyWord } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/base-ui/button"
import { useSpeechPlayback } from "@/hooks/use-speech-playback"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"
import { parseCardDefinitionLines, parsePhoneticLine, withDefinitionLineKeys } from "@/utils/vocabulary/definition-lines"
import { PageLayout } from "../../components/page-layout"
import { StarRating } from "../vocabulary/star-rating"

type SessionPhase = "idle" | "showing-front" | "showing-back" | "done"

interface ReviewStat {
  word: VocabularyWord
  oldStar: number
  newStar: number
}

/** What a speaker button needs to know about the voice it shares. */
interface SpeechControl {
  state: SpeechPlaybackState
  /** The utterance being spoken, so a button knows whether it is the one talking. */
  speakingText: string | null
  onSpeak: (text: string, sourceLanguage?: string) => void
}

/**
 * The read-aloud button of a card.
 *
 * It pronounces the word itself — the thing the learner is being asked to
 * recall — and it works on both faces of the card, so the pronunciation is
 * one click away while the meaning is on screen.
 */
function SpeechButton({
  text,
  sourceLanguage,
  title,
  control,
}: {
  text: string
  sourceLanguage?: string
  title: string
  control: SpeechControl
}) {
  const { state, speakingText, onSpeak } = control
  const isMine = speakingText === text
  const isPlaying = isMine && state === "playing"
  const isLoading = isMine && state === "loading"
  const label = isPlaying ? "停止朗读" : title

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      title={label}
      aria-label={label}
      onClick={(event) => {
        // The whole card flips on click, so the button has to keep its own
        // click to itself.
        event.stopPropagation()
        onSpeak(text, sourceLanguage)
      }}
    >
      <Icon
        icon={isPlaying ? "tabler:player-stop-filled" : isLoading ? "tabler:loader-2" : "tabler:volume"}
        className={cn("size-4", isLoading && "animate-spin")}
      />
    </Button>
  )
}

function FlashcardDefinition({
  word,
  translation,
  contextText,
  sourceLanguage,
  phonetic,
  speech,
}: {
  word: string
  translation: string
  contextText?: string
  sourceLanguage?: string
  phonetic?: string
  speech: SpeechControl
}) {
  const lines = withDefinitionLineKeys(parseCardDefinitionLines(translation, word))

  return (
    <div className="w-full min-w-0 text-left">
      <div className="mb-3 flex items-center gap-1">
        <h3 className="text-xl font-semibold tracking-tight">{word}</h3>
        <SpeechButton
          text={word}
          sourceLanguage={sourceLanguage}
          title="朗读单词"
          control={speech}
        />
      </div>

      {phonetic && (
        <p className="mb-3 font-serif text-sm text-muted-foreground">{phonetic}</p>
      )}

      <div className="space-y-1.5 text-sm leading-6">
        {lines.length > 0
          ? lines.map(({ line, key }) => {
              const phoneticParts = parsePhoneticLine(line)
              if (phoneticParts) {
                return (
                  <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                    {phoneticParts.map(part => (
                      <span key={part.label} className="inline-flex items-center gap-1">
                        <span className="font-medium text-foreground/80">{part.label}</span>
                        <span className="font-serif">{part.value}</span>
                      </span>
                    ))}
                  </div>
                )
              }

              const senseMatch = line.match(/^((?:\d+|❑)\.)\s+/)
              if (senseMatch) {
                const definition = line.slice(senseMatch[0].length)
                return (
                  <div
                    key={key}
                    className="flex min-w-0 items-start gap-2 [overflow-wrap:anywhere]"
                  >
                    <span className="shrink-0 font-medium text-brand">{senseMatch[1]}</span>
                    <span className="min-w-0 whitespace-pre-wrap">{definition}</span>
                  </div>
                )
              }

              return (
                <p key={key} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {line}
                </p>
              )
            })
          : (
              <p className="text-muted-foreground">暂无释义</p>
            )}
      </div>

      {contextText && contextText !== word && (
        <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground/60 italic [overflow-wrap:anywhere]">
          {contextText}
        </p>
      )}
    </div>
  )
}

export function FlashcardsPage() {
  const [phase, setPhase] = useState<SessionPhase>("idle")
  const [cards, setCards] = useState<VocabularyWord[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [stats, setStats] = useState<ReviewStat[]>([])
  const [loading, setLoading] = useState(false)
  const {
    state: speechState,
    speakingText,
    speak: speakAudio,
    stop: stopSpeaking,
  } = useSpeechPlayback()

  const currentCard = cards[currentIndex]

  // A new card is a new word: the voice of the old one has to give way. The
  // same goes for the end of the session, where the cards are gone.
  useEffect(() => {
    stopSpeaking()
  }, [currentIndex, phase, stopSpeaking])

  const speech: SpeechControl = {
    state: speechState,
    speakingText,
    onSpeak: (text, sourceLanguage) => {
      void speakAudio(text, { sourceLanguage })
    },
  }

  const startSession = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sendMessage("getFlashcardSession", { count: 10 })
      setCards(result)
      setCurrentIndex(0)
      setFlipped(false)
      setStats([])
      setPhase(result.length > 0 ? "showing-front" : "idle")
    }
    catch (error) {
      console.error("Failed to get flashcard session:", error)
    }
    finally {
      setLoading(false)
    }
  }, [])

  const handleFlip = useCallback(() => {
    setFlipped(true)
  }, [])

  const handleRate = useCallback(async (star: 1 | 2 | 3 | 4 | 5) => {
    if (!currentCard)
      return

    try {
      const result = await sendMessage("markWordReviewed", { wordId: currentCard.id, star })
      // The rating is saved locally either way — but when the word came from
      // Eudic, a failed write-back means the two sides now disagree.
      if (result?.eudicSync && !result.eudicSync.ok) {
        toast.warning(`评分已保存，但同步到欧路失败：${result.eudicSync.error ?? "未知错误"}`)
      }
      // Record stat
      setStats(prev => [...prev, {
        word: currentCard,
        oldStar: currentCard.star,
        newStar: star,
      }])
      setFlipped(false)

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1)
      }
      else {
        setPhase("done")
      }
    }
    catch (error) {
      console.error("Failed to mark word reviewed:", error)
    }
  }, [currentCard, currentIndex, cards.length])

  const goToNext = useCallback(() => {
    // If not rated yet, just move to next without saving
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(i => i + 1)
      setFlipped(false)
    }
    else {
      setPhase("done")
    }
  }, [currentIndex, cards.length])

  return (
    <PageLayout title="闪卡复习" innerClassName="flex flex-col items-center">
      {phase === "idle" && (
        <div className="flex flex-col items-center gap-6 p-8">
          <Icon icon="tabler:cards" className="size-16 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            从生词本中抽取单词，优先复习最难（低星）的单词。
            每次 10 张，帮助巩固记忆。
          </p>
          <Button onClick={startSession} disabled={loading} size="lg" variant="brand">
            {loading ? "加载中..." : "开始复习"}
          </Button>
        </div>
      )}

      {phase === "showing-front" && currentCard && (
        <div className="flex w-full max-w-md flex-col items-center gap-6 p-8">
          {/* Progress indicator */}
          <div className="text-xs text-muted-foreground">
            {currentIndex + 1}
            {" "}
            /
            {" "}
            {cards.length}
          </div>

          {/* Card */}
          <div
            className={cn(
              "flex h-96 w-full cursor-pointer rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md",
              flipped
                ? "flashcard-scroll items-start justify-start overflow-y-auto"
                : "items-center justify-center",
            )}
            onClick={handleFlip}
          >
            {flipped
              ? (
                  <FlashcardDefinition
                    word={currentCard.word}
                    translation={currentCard.translation}
                    contextText={currentCard.contextText}
                    sourceLanguage={currentCard.sourceLanguage}
                    phonetic={currentCard.phonetic}
                    speech={speech}
                  />
                )
              : (
                  <div className="flex items-center gap-1">
                    <span className="text-2xl font-bold">{currentCard.word}</span>
                    <SpeechButton
                      text={currentCard.word}
                      sourceLanguage={currentCard.sourceLanguage}
                      title="朗读单词"
                      control={speech}
                    />
                  </div>
                )}
          </div>

          {flipped && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">记忆程度</p>
              <StarRating
                value={currentCard.star}
                onChange={handleRate}
                size="lg"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={goToNext}>
                  跳过
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFlipped(false)}>
                  重新翻面
                </Button>
              </div>
            </div>
          )}
          {!flipped && (
            <p className="text-xs text-muted-foreground animate-pulse">
              点击卡片翻转
            </p>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="flex w-full max-w-md flex-col items-center gap-4 p-8">
          <Icon icon="tabler:check-circle" className="size-12 text-green-500" />
          <h2 className="text-lg font-semibold">复习完成！</h2>

          <div className="w-full space-y-2">
            <p className="text-sm text-muted-foreground text-center">
              本次复习
              {stats.length}
              {" "}
              个单词
            </p>
            {stats.length > 0 && (
              <div className="mt-4 divide-y rounded-lg border">
                {stats.map(s => (
                  <div key={s.word.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium truncate max-w-[120px]">{s.word.word}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {s.oldStar}
                        ★
                      </span>
                      <Icon icon="tabler:arrow-right" className="size-3 text-muted-foreground" />
                      <span className="text-xs">
                        {s.newStar}
                        ★
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={startSession} variant="brand" size="lg">
              再来一轮
            </Button>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
