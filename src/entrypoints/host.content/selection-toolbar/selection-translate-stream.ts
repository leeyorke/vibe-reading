import type { Browser } from "#imports"
import type { SelectionTranslateStreamMessage, SelectionTranslateStreamRequest } from "@/types/selection-translate-stream"
import { browser } from "#imports"
import { SELECTION_TRANSLATE_STREAM_PORT } from "@/types/selection-translate-stream"
import { logger } from "@/utils/logger"
import { EXTENSION_STALE_MESSAGE, isExtensionContextInvalidated } from "./message-retry"

export interface SelectionTranslateStreamHandlers {
  /** Called with every user-visible slice, in order, while the answer streams. */
  onDelta: (delta: string) => void
}

/**
 * Asks the background to translate one selection and streams the answer back.
 *
 * A port rather than `sendMessage` because `sendMessage` is one request → one
 * response: the handler would have to finish the whole generation before the
 * toolbar could show anything, which is the spinner wait this replaces. The
 * port also keeps the MV3 service worker awake for the duration of the stream.
 *
 * Resolves with the authoritative full text from the `done` message — the same
 * string the buffered path used to return — so callers never have to stitch
 * deltas together themselves. Rejects with the provider's error message, or
 * with {@link EXTENSION_STALE_MESSAGE} when the extension was reloaded while
 * this page stayed open.
 */
export async function requestSelectionTranslateStream(
  data: SelectionTranslateStreamRequest,
  handlers: SelectionTranslateStreamHandlers,
): Promise<string> {
  let port: Browser.runtime.Port
  try {
    port = browser.runtime.connect({ name: SELECTION_TRANSLATE_STREAM_PORT })
  }
  catch (error) {
    // A torn-down context refuses to open a port at all. Say the one thing that
    // is true and actionable instead of leaking the polyfill's TypeError.
    if (isExtensionContextInvalidated()) {
      throw new Error(EXTENSION_STALE_MESSAGE)
    }
    throw error
  }

  return await new Promise<string>((resolve, reject) => {
    // Late messages are ignored, not replayed: the port is disconnected the
    // moment the outcome is known, and a closed port stops delivering anyway.
    // (Same token discipline as the playback hook — a stale result must not be
    // able to overwrite a fresh one.)
    let settled = false

    // Listen before posting: the first delta can otherwise land on a listener
    // that is not installed yet.
    port.onMessage.addListener((message: SelectionTranslateStreamMessage) => {
      if (settled || message == null || typeof message !== "object") {
        return
      }

      if (message.type === "delta") {
        handlers.onDelta(message.text)
        return
      }

      if (message.type === "done") {
        settled = true
        // Nothing left to send, so close our end. The background hung up on
        // its side the moment it posted this.
        port.disconnect()
        resolve(message.text)
        return
      }

      if (message.type === "error") {
        settled = true
        port.disconnect()
        reject(new Error(message.message))
      }
    })

    port.onDisconnect.addListener(() => {
      if (settled) {
        return
      }

      // A clean hang-up always arrives as `done` or `error` first, so getting
      // here means the stream was cut off: a worker that went back to sleep, a
      // navigated-away frame, or an extension reloaded behind our back.
      const reason = isExtensionContextInvalidated()
        ? EXTENSION_STALE_MESSAGE
        : "翻译连接中断，请重试"
      logger.warn(`[SelectionToolbar] Translation stream disconnected: ${reason}`)
      settled = true
      reject(new Error(reason))
    })

    port.postMessage(data)
  })
}
