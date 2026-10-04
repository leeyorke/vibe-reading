import type { ReviewCardData, ReviewRatingKind } from "@/types/review"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/base-ui/button"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import { REVIEW_CARD_WORD_PARAM } from "@/utils/constants/review"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { openOptionsPage } from "@/utils/navigation"
import { parseCardDefinitionLines, parsePhoneticLine, withDefinitionLineKeys } from "@/utils/review/definition-lines"

type CardPhase = "loading" | "ready" | "empty" | "failed"

/** The word the notification announced, if the page was opened from one. */
function requestedWordId(): string | undefined {
  const raw = new URLSearchParams(window.location.search).get(REVIEW_CARD_WORD_PARAM)
  return raw?.trim() || undefined
}

/**
 * Pronunciation button.
 *
 * Disabled while anything is playing, so a second click cannot stack two
 * overlapping utterances.
 */
function SpeakButton({
  text,
  sourceLanguage,
  speaking,
  disabled,
  onPlay,
}: {
  text: string
  sourceLanguage?: string
  speaking: boolean
  disabled: boolean
  onPlay: (text: string, sourceLanguage?: string) => void
}) {
  if (!text) {
    return null
  }

  const label = i18n.t("options.review.card.speak")

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onPlay(text, sourceLanguage)}
    >
      <Icon icon="tabler:volume" className={speaking ? "animate-pulse" : undefined} />
    </Button>
  )
}

function CardSkeleton() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-5 w-72" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

/** The definition block, parsed exactly the way the flashcard page parses it. */
function DefinitionLines({ card }: { card: ReviewCardData }) {
  const lines = useMemo(
    () => withDefinitionLineKeys(parseCardDefinitionLines(card.translation, card.word)),
    [card.translation, card.word],
  )

  if (lines.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5 text-sm leading-6">
      {lines.map(({ line, key }) => {
        const phonetics = parsePhoneticLine(line)
        if (phonetics) {
          return (
            <div key={key} className="flex flex-wrap items-center gap-x-4 text-muted-foreground">
              {phonetics.map(part => (
                <span key={part.label} className="inline-flex items-center gap-1">
                  <span className="font-medium text-foreground/80">{part.label}</span>
                  <span className="font-serif">{part.value}</span>
                </span>
              ))}
            </div>
          )
        }

        return (
          <p key={key} className="text-foreground/90">
            {line}
          </p>
        )
      })}
    </div>
  )
}

interface SpeakProps {
  speaking: boolean
  disabled: boolean
  onPlay: (text: string, sourceLanguage?: string) => void
}

function ReviewBody({ card, speak }: { card: ReviewCardData, speak: SpeakProps }) {
  const { definition } = card
  const phonetics = [
    { label: "英", value: definition?.phoneticUK },
    { label: "美", value: definition?.phoneticUS },
  ].filter(part => Boolean(part.value))

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <h1 className="text-4xl font-semibold tracking-tight">{card.word}</h1>
          <SpeakButton text={card.word} sourceLanguage={card.sourceLanguage} {...speak} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {definition?.pos && <span className="font-medium">{definition.pos}</span>}
          {phonetics.map(part => (
            <span key={part.label} className="inline-flex items-center gap-1">
              <span className="font-medium text-foreground/80">{part.label}</span>
              <span className="font-serif">{part.value}</span>
            </span>
          ))}
          <span className="tabular-nums">
            {i18n.t("options.review.card.progress", [String(card.stage + 1), String(card.totalStages)])}
          </span>
        </div>
      </header>

      {card.example && (
        <section className="bg-muted/40 ring-foreground/10 space-y-2 rounded-xl p-4 ring-1">
          <div className="flex items-start gap-1">
            <p className="text-lg leading-7">{card.example}</p>
            <SpeakButton text={card.example} sourceLanguage={card.sourceLanguage} {...speak} />
          </div>
          {card.sentenceChinese && <p className="text-sm leading-6 text-muted-foreground">{card.sentenceChinese}</p>}
        </section>
      )}

      {(card.translation || card.contextText) && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {i18n.t("options.review.card.meaning")}
          </h2>
          <DefinitionLines card={card} />
          {!card.translation && card.contextText && (
            <p className="text-sm leading-6 text-muted-foreground italic">{card.contextText}</p>
          )}
        </section>
      )}

      {card.collocations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {i18n.t("options.review.card.collocations")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {card.collocations.map(collocation => (
              <li
                key={collocation}
                className="bg-secondary text-secondary-foreground rounded-md px-2.5 py-1 text-sm"
              >
                {collocation}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function EmptyState({ failed }: { failed: boolean }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <Icon
        icon={failed ? "tabler:alert-triangle" : "tabler:circle-check"}
        className="text-muted-foreground size-10"
      />
      <div className="space-y-1.5">
        <h1 className="text-lg font-medium">
          {i18n.t(failed ? "options.review.card.errorTitle" : "options.review.card.doneTitle")}
        </h1>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-6">
          {i18n.t(failed ? "options.review.card.errorDescription" : "options.review.card.doneDescription")}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => void openOptionsPage({ route: "/review" })}
      >
        {i18n.t("options.review.card.openSettings")}
      </Button>
    </div>
  )
}

export default function ReviewCard() {
  // `null` means "the queue is drained"; `undefined` would conflate that with loading.
  const [card, setCard] = useState<ReviewCardData | null | undefined>(undefined)
  const [phase, setPhase] = useState<CardPhase>("loading")
  const [submitting, setSubmitting] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  // A ref, not state: pausing must not re-render the whole card.
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause()
    setSpeaking(false)
  }, [])

  const play = useCallback(async (text: string, sourceLanguage?: string) => {
    stopSpeaking()

    try {
      const audioUrl = await sendMessage("synthesizeSpeech", { text, sourceLanguage })
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      audio.addEventListener("ended", stopSpeaking, { once: true })
      audio.addEventListener("error", stopSpeaking, { once: true })
      setSpeaking(true)
      await audio.play()
    }
    catch (error) {
      logger.error("[ReviewCard] Pronunciation failed:", error)
      setSpeaking(false)
      toast.error(i18n.t("options.review.card.speakFailed"))
    }
  }, [stopSpeaking])

  const loadCard = useCallback(async () => {
    setPhase("loading")
    try {
      const next = await sendMessage("getReviewCard", { wordId: requestedWordId() })
      setCard(next ?? null)
      setPhase(next ? "ready" : "empty")
    }
    catch (error) {
      logger.error("[ReviewCard] Failed to load the card:", error)
      setCard(null)
      setPhase("failed")
    }
  }, [])

  useEffect(() => {
    void loadCard()
  }, [loadCard])

  const rate = useCallback(async (kind: ReviewRatingKind) => {
    if (!card || submitting) {
      return
    }

    setSubmitting(true)
    try {
      const next = await sendMessage("rateReviewWord", { wordId: card.wordId, kind })
      setCard(next ?? null)
      setPhase(next ? "ready" : "empty")
      window.scrollTo({ top: 0 })
    }
    catch (error) {
      logger.error(`[ReviewCard] Failed to record "${kind}":`, error)
    }
    finally {
      setSubmitting(false)
    }
  }, [card, submitting])

  // A card session is a look → judge → next loop; the verdict is the only
  // action, so it deserves a key that does not require aiming.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key === "1" || event.key === "ArrowRight") {
        event.preventDefault()
        void rate("remembered")
      }
      else if (event.key === "2" || event.key === "ArrowLeft") {
        event.preventDefault()
        void rate("forgotten")
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [rate])

  if (phase === "loading") {
    return <CardSkeleton />
  }

  if (phase === "empty" || phase === "failed" || !card) {
    return <EmptyState failed={phase === "failed"} />
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex-1">
        <ReviewBody card={card} speak={{ speaking, disabled: speaking, onPlay: play }} />
      </div>

      <footer className="ring-foreground/10 bg-card sticky bottom-0 flex items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1">
        <span className="text-muted-foreground text-sm tabular-nums">
          {i18n.t("options.review.card.remaining", [String(card.pendingCount)])}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={submitting}
            onClick={() => void rate("forgotten")}
          >
            <Icon icon="tabler:thumb-down" data-icon="inline-start" />
            {i18n.t("options.review.rate.forgotten")}
            <kbd className="text-muted-foreground ml-1 text-xs">2</kbd>
          </Button>
          <Button
            type="button"
            variant="brand"
            size="lg"
            disabled={submitting}
            onClick={() => void rate("remembered")}
          >
            {i18n.t("options.review.rate.remembered")}
            <kbd className="ml-1 text-xs opacity-70">1</kbd>
          </Button>
        </div>
      </footer>
    </div>
  )
}
