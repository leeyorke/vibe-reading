import { logger } from "@/utils/logger"

/**
 * Shown when the content script's extension context has been invalidated.
 *
 * Reloading the extension does NOT re-inject content scripts into tabs that
 * are already open: the old script keeps running, its UI keeps answering
 * clicks, but every `chrome.*` binding it calls has been torn down. The
 * failure surfaces as nonsense — "Extension context invalidated" from the API
 * layer, or a polyfill TypeError like "Cannot read properties of undefined
 * (reading 'length')" from the argument shim around the dead binding. Either
 * way the user sees a broken button with a healthy network log, because the
 * background never even ran. Refresh the page and the script is re-injected.
 */
export const EXTENSION_STALE_MESSAGE = "扩展已重新加载，请刷新页面后重试"

const INVALIDATED_CONTEXT = /context invalidated/i

/**
 * Failures of the wrappers around torn-down bindings.
 *
 * Chrome strips the extension APIs off a content script's context, and the
 * polyfill layers around them then report a method that "is not a function".
 * Unlike a generic JavaScript TypeError this names the binding itself, so it can
 * be matched on safely.
 *
 * Deliberately absent: `/cannot read properties of undefined \(reading 'length'\)/`
 * and friends. That shape is what the extension's *own* code produces too —
 * mapping a sparse dictionary payload used to throw exactly that, and it was
 * reported to the user as "the extension was reloaded, refresh the page", which
 * sent them refreshing a page that was never stale. A V8 TypeError message
 * cannot tell the two apart; {@link isExtensionContextInvalidated} can, and it
 * checks the bindings directly.
 */
const DEAD_BINDING = /\.(?:sendMessage|getURL|connect|getManifest) is not a function/i

/**
 * Synchronous probe for a dead extension context.
 *
 * Reloading the extension does NOT re-inject content scripts into tabs that
 * are already open: the old script keeps running, its UI keeps answering
 * clicks, but every `chrome.*` binding it calls has been torn down. The
 * failure surfaces as nonsense — "Extension context invalidated" from the API
 * layer, or a TypeError from the argument shims around the dead bindings —
 * while the background never even wakes, so the network log shows nothing at
 * all.
 *
 * `runtime.id` is the usual first casualty, and a stripped method is the
 * other half of the same tell; either one means the context is gone. This is
 * the only reliable signal: an error *message* can be produced by the
 * extension's own code just as well as by a torn-down binding.
 */
export function isExtensionContextInvalidated(): boolean {
  try {
    const runtime = (globalThis as { chrome?: { runtime?: { id?: string, sendMessage?: unknown } } }).chrome?.runtime
    if (runtime == null) {
      return false
    }
    return runtime.id == null || typeof runtime.sendMessage !== "function"
  }
  catch {
    return true
  }
}

function isStaleContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return INVALIDATED_CONTEXT.test(message) || DEAD_BINDING.test(message) || isExtensionContextInvalidated()
}

/**
 * One retry for the transport failures only MV3 can produce.
 *
 * A message sent to a sleeping service worker sometimes comes back as a closed
 * port — "The message port closed before a response was received" — even
 * though the worker woke up and ran the handler all the way to its last
 * statement. The handler's network request still shows up in the user's HAR
 * while the caller's promise rejects, which from the outside looks exactly
 * like a broken feature: the button says "翻译失败" and the network log says
 * everything was fine.
 *
 * Retrying the identical request a moment later covers the window — the worker
 * is warm by then, and every request this wraps is an idempotent GET. Anything
 * that is not a transport failure (a real handler error, a bad payload, an
 * invalidated context) propagates on the first attempt.
 */
const TRANSPORT_FAILURE = /port closed|no response|receiving end|establish connection/i

export async function withMessageRetry<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  }
  catch (error) {
    if (isStaleContextError(error)) {
      logger.warn("[SelectionToolbar] Extension context invalidated; the page must be reloaded")
      throw Object.assign(new Error(EXTENSION_STALE_MESSAGE), { cause: error })
    }

    const message = error instanceof Error ? error.message : String(error)
    if (!TRANSPORT_FAILURE.test(message)) {
      throw error
    }

    logger.warn(`[SelectionToolbar] Message channel closed, retrying once: ${message}`)
    await new Promise(resolve => setTimeout(resolve, 150))
    return await request()
  }
}

/** The message of a thrown value, for showing a real reason instead of a shrug. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
