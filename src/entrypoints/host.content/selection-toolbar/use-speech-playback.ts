import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { guessSpeechLang } from "./guess-speech-lang"
import { errorMessage, withMessageRetry } from "./message-retry"

export type SpeechPlaybackState = "idle" | "loading" | "playing"

export interface SpeechPlayback {
  state: SpeechPlaybackState
  /** Speak the text, or stop when it is already playing. */
  speak: (text: string) => Promise<void>
  stop: () => void
}

/**
 * Pronunciation for the selection toolbar.
 *
 * The audio arrives from the background as raw bytes over extension messaging
 * and is played through Web Audio, not an `<audio>` element: a content script
 * shares the page's document, so any URL handed to a media element — `data:`,
 * `blob:` or remote — is a subresource load the page's CSP can refuse, while
 * `decodeAudioData` has no CSP directive to answer to. The isolated world also
 * keeps page JavaScript from tampering with the playback.
 */
export function useSpeechPlayback(): SpeechPlayback {
  const [state, setState] = useState<SpeechPlaybackState>("idle")
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  /**
   * Bumped by every stop, by a new request and on unmount. A request that
   * finishes after its token went stale — the user clicked stop, picked a new
   * selection, or the toolbar went away — drops its result on the floor.
   */
  const requestRef = useRef(0)

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
    setState("idle")
  }, [])

  // The context is created on first use and lives as long as the toolbar, so
  // repeated utterances do not each open an audio graph.
  useEffect(() => () => {
    stop()
    void contextRef.current?.close()
    contextRef.current = null
  }, [stop])

  const speak = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    if (state === "playing") {
      stop()
      return
    }
    if (state === "loading") {
      return
    }

    const request = requestRef.current + 1
    requestRef.current = request
    setState("loading")

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
          sourceLanguage: guessSpeechLang(trimmed),
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
          setState("idle")
        }
      }
      // Without this the source plays into nothing: no error, no sound, and
      // `ended` still fires — a silent button that looks like it worked.
      source.connect(context.destination)
      sourceRef.current = source
      source.start()
      setState("playing")
    }
    catch (error) {
      if (requestRef.current !== request) {
        return
      }
      logger.error("[SelectionToolbar] Playback failed:", error)
      sourceRef.current = null
      setState("idle")
      toast.error(`朗读失败：${errorMessage(error)}`)
    }
  }, [state, stop])

  return { state, speak, stop }
}
