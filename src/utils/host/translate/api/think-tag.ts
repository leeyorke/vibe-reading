const THINK_TAG_NAME = "think"
const THINK_OPEN_TAG = `<${THINK_TAG_NAME}>`
const THINK_CLOSE_TAG = `</${THINK_TAG_NAME}>`

export interface ThinkTagFilter {
  /**
   * Feed one provider delta and get back the slice the user may see.
   * Returns "" while the reasoning block is still being withheld.
   */
  push: (delta: string) => string
  /** End of stream: release whatever is still buffered. */
  finish: () => string
}

function looksLikeThinkStart(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith(THINK_OPEN_TAG)
    || THINK_OPEN_TAG.startsWith(trimmed.slice(0, THINK_OPEN_TAG.length))
}

/**
 * Streaming counterpart of the `THINK_TAG_RE` post-processing in `aiTranslate`.
 *
 * A reasoning model that emits its chain of thought *inside* the text stream
 * wraps it in an opening and a closing `think` tag, and everything up to the
 * closing tag is reasoning the user must never see. The non-streaming path
 * knows that only once the whole answer has arrived; here the decision has to
 * be made on partial data, so it is made on the first characters instead:
 *
 * - output that begins with an opening `think` tag (leading whitespace allowed)
 *   enters reasoning mode, and nothing is released until the closing tag shows
 *   up;
 * - output that does not is the real answer and is flushed as it arrives, which
 *   is what keeps streaming useful for models that put their reasoning in a
 *   separate field rather than in the text. A closing tag that turns up inside
 *   the very first deltas is honoured either way, so a stream that starts
 *   mid-block still loses its reasoning.
 *
 * An unterminated reasoning block (stream cut off mid-thought) is flushed by
 * `finish` rather than dropped, mirroring the no-match branch of
 * `THINK_TAG_RE`, which returns the text unchanged.
 */
export function createThinkTagFilter(): ThinkTagFilter {
  let resolved = false
  let reasoning = false
  let pending = ""

  return {
    push(delta) {
      if (delta === "" || resolved) {
        return resolved ? delta : ""
      }

      pending += delta

      // A closing tag already on screen settles it: everything in front of it
      // was reasoning, whoever emitted it.
      const close = pending.indexOf(THINK_CLOSE_TAG)
      if (close !== -1) {
        resolved = true
        const visible = pending.slice(close + THINK_CLOSE_TAG.length)
        pending = ""
        return visible
      }

      if (reasoning) {
        return ""
      }

      // Too short to tell an opening tag from ordinary text yet?
      if (pending.trimStart().length < THINK_OPEN_TAG.length && looksLikeThinkStart(pending)) {
        return ""
      }

      if (looksLikeThinkStart(pending)) {
        reasoning = true
        return ""
      }

      resolved = true
      const visible = pending
      pending = ""
      return visible
    },

    finish() {
      const visible = pending
      pending = ""
      resolved = true
      return visible
    },
  }
}
