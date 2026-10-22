import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { guessSpeechLang } from "@/utils/guess-speech-lang"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { errorMessage, withMessageRetry } from "@/utils/message-retry"

export type SpeechPlaybackState = "idle" | "loading" | "playing"

export interface SpeakOptions {
  /**
   * The language of the text, as the vocabulary book records it — ISO 639-3,
   * e.g. `eng`. A card knows its own language; a page selection does not, so
   * the script of the text is the only honest signal left and is used
   * instead when this is missing.
   */
  sourceLanguage?: string
}

export interface SpeechPlayback {
  state: SpeechPlaybackState
  /**
   * The utterance being spoken or awaited, `null` while the speaker is idle.
   *
   * The state alone cannot say *what* is being said, so a button that shares
   * the hook with another one cannot tell whether it is the one talking — the
   * flashcard page renders its speaker on both faces of a card, and only the
   * visible one may show as playing.
   */
  speakingText: string | null
  /** Speak the text, or stop it when it is already playing. */
  speak: (text: string, options?: SpeakOptions) => Promise<void>
  stop: () => void
}

/**
 * Pronunciation for anything that has a word or a sentence to pronounce — the
 * selection toolbar in a page and the flashcard page in the options screen.
 *
 * The audio arrives from the background as raw bytes over extension messaging
 * and is played through Web Audio, not an `<audio>` element: a content script
 * shares the page's document, so any URL handed to a media element — `data:`,
 * `blob:` or remote — is a subresource load the page's CSP can refuse, while
 * `decodeAudioData` has no CSP directive to answer to. The isolated world also
 * keeps page JavaScript from tampering with the playback. The options page
 * plays through the same path so that both surfaces behave identically.
 */
export function useSpeechPlayback(): SpeechPlayback {
  const [state, setState] = useState<SpeechPlaybackState>("idle")
  const [speakingText, setSpeakingText] = useState<string | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  /**
   * Bumped by every stop, by a new request and on unmount. A request that
   * finishes after its token went stale — the user clicked stop, picked a new
   * selection, or the toolbar went away — drops its result on the floor.
   */
  const requestRef = useRef(0)
  /**
   * The phase as the event handlers see it. React state is only updated after
   * a render, so two clicks in the same tick would both read "idle" and the
   * second one would start a second utterance on top of the first.
   */
  const phaseRef = useRef<SpeechPlaybackState>("idle")
  /**
   * The utterance the current phase belongs to, so that a second button knows
   * whether the voice is already saying what it was asked to say.
   */
  const currentTextRef = useRef<string | null>(null)

  const applyPhase = useCallback((next: SpeechPlaybackState) => {
    phaseRef.current = next
    setState(next)
  }, [])

  const stop = useCallback(() => {
    requestRef.current += 1
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      source.onended = null
      // A source that already fired `ended` throws on stop(); harmless here.
      try {
        source.stop()
      }
      catch {
        // Already finished
      }
    }
    currentTextRef.current = null
    setSpeakingText(null)
    applyPhase("idle")
  }, [applyPhase])

  // The context is created on first use and lives as long as the component, so
  // repeated utterances do not each open an audio graph.
  useEffect(() => () => {
    stop()
    void contextRef.current?.close()
    contextRef.current = null
  }, [stop])

  const speak = useCallback(async (text: string, options?: SpeakOptions) => {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    const phase = phaseRef.current
    if (currentTextRef.current === trimmed && (phase === "playing" || phase === "loading")) {
      if (phase === "playing") {
        // Saying the same thing again means "stop".
        stop()
      }
      // A request that is still on its way is left alone: the user clicked
      // twice, not twice on two different buttons.
      return
    }

    // A different utterance takes the speaker away from the previous one.
    stop()

    const request = requestRef.current + 1
    requestRef.current = request
    currentTextRef.current = trimmed
    setSpeakingText(trimmed)
    applyPhase("loading")

    try {
      // Create or wake the context before the first await: Chrome will not let
      // audio start without the user gesture that got us here.
      const context = contextRef.current ?? new AudioContext()
      contextRef.current = context
      if (context.state === "suspended") {
        void context.resume()
      }

      const audio = await withMessageRetry(() =>
        sendMessage("synthesizeSpeechAudio", {
          text: trimmed,
          sourceLanguage: options?.sourceLanguage || guessSpeechLang(trimmed),
        }),
      )
      // The message channel serialises as JSON, so what arrives is base64 text
      // rather than a buffer — decode it here, into bytes `decodeAudioData`
      // accepts.
      const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
      const buffer = await context.decodeAudioData(bytes.buffer)
      if (requestRef.current !== request) {
        return
      }

      const source = context.createBufferSource()
      source.buffer = buffer
      source.onended = () => {
        if (sourceRef.current === source) {
          sourceRef.current = null
          currentTextRef.current = null
          setSpeakingText(null)
          applyPhase("idle")
        }
      }
      // Without this the source plays into nothing: no error, no sound, and
      // `ended` still fires — a silent button that looks like it worked.
      source.connect(context.destination)
      sourceRef.current = source
      source.start()
      applyPhase("playing")
    }
    catch (error) {
      if (requestRef.current !== request) {
        return
      }
      logger.error("[Speech] Playback failed:", error)
      sourceRef.current = null
      currentTextRef.current = null
      setSpeakingText(null)
      applyPhase("idle")
      toast.error(`朗读失败：${errorMessage(error)}`)
    }
  }, [applyPhase, stop])

  return { state, speakingText, speak, stop }
}
