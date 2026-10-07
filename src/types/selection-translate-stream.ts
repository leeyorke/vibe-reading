/**
 * Wire protocol for the streamed selection translation.
 *
 * `runtime.sendMessage` is one request → one response, which is exactly wrong
 * for a translation that arrives in a hundred pieces: by the time the handler
 * returns, the user has stared at a spinner for the whole generation. So the
 * toolbar opens a dedicated `runtime.connect` port instead, and both ends speak
 * this small tagged envelope over it.
 *
 * A port also keeps the MV3 service worker awake for as long as the stream
 * lasts, which a sequence of one-shot messages does not.
 */

/** Port name the content script connects with and the background filters on. */
export const SELECTION_TRANSLATE_STREAM_PORT = "selection-translate-stream"

/** What the toolbar asks for. One port carries exactly one request. */
export interface SelectionTranslateStreamRequest {
  text: string
  sourceLanguageCode?: string
  targetLanguageCode?: string
}

/**
 * What comes back. `done` carries the authoritative full text: the deltas are
 * for the eyes while waiting, the `done` text is what gets saved to the
 * vocabulary book and shown once the stream settles.
 */
export type SelectionTranslateStreamMessage
  = | { type: "delta", text: string }
    | { type: "done", text: string }
    | { type: "error", message: string }
