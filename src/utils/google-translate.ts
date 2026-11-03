import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

/**
 * Google Translate, free and keyless — the first link of the quick
 * translation chain (see `utils/fallback-chain.ts`).
 *
 * This is the endpoint behind Google Translate's own web UI (`client=gtx`) —
 * the same family of undocumented endpoint the pronunciation button uses (see
 * `utils/speech.ts`). It answers over GET, so the text rides in the URL.
 *
 * It is not a documented API and carries no availability guarantee — it
 * rate-limits per IP — so every failure is surfaced with the provider's own
 * name attached and the chain falls over to Microsoft. If it ever changes
 * shape or disappears, this file is the only thing that has to change with it.
 *
 * Runs in the service worker: a content script would have to fight the page's
 * CSP for a cross-origin fetch it cannot win.
 */

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"

/**
 * The endpoint answers over GET, so the text rides in the URL. A runaway
 * selection (a whole article highlighted by accident) is capped rather than
 * rejected: a truncated answer beats a request Google refuses outright.
 */
const GOOGLE_MAX_CHARS = 5000

/** The query string the endpoint expects, exported so tests can inspect it. */
export function buildGoogleTranslateParams(text: string, sourceLang: string, targetLang: string): URLSearchParams {
  return new URLSearchParams({
    client: "gtx",
    sl: sourceLang,
    tl: targetLang,
    dt: "t",
    ie: "UTF-8",
    oe: "UTF-8",
    q: text.slice(0, GOOGLE_MAX_CHARS),
  })
}

/**
 * Pulls the translation out of the endpoint's nested-array response.
 *
 * The shape is `[[[译文, 原文, …], …], …]`: the first element holds one entry
 * per sentence segment. Anything else — an error page that still answered 200,
 * a future reshuffle — is `null`, which the caller turns into a visible failure
 * instead of rendering `[object Object]` into the popover.
 */
export function parseGoogleTranslateResponse(payload: unknown): string | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const segments = payload[0]
  if (!Array.isArray(segments)) {
    return null
  }

  const parts: string[] = []
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      parts.push(segment[0])
    }
  }

  return parts.length > 0 ? parts.join("") : null
}

/**
 * Translates one text over Google's endpoint and resolves with the plain
 * translated text.
 *
 * `sourceLang` is the already-resolved code (`auto` for detection); `targetLang`
 * is a two-letter tag. Rejects with a message that names the actual failure —
 * a non-OK status, a body that is not the expected shape — because the
 * fallback chain shows it verbatim after 「翻译失败：」.
 */
export async function translateWithGoogle(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const params = buildGoogleTranslateParams(text, sourceLang, targetLang)

  let response: Response
  try {
    response = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${params.toString()}`, {
      // The endpoint is anonymous; sending cookies would only leak them.
      credentials: "omit",
      headers: { Accept: "application/json" },
    })
  }
  catch (error) {
    throw new Error(`Google 翻译接口网络错误：${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    // The status rides on the error so the fallback chain can tell a rate
    // limit (worth cooling the provider down for) from a bad request.
    throw attachRequestErrorMeta(new Error(`Google 翻译接口返回 ${response.status}`), {
      statusCode: response.status,
      responseHeaders: response.headers,
    })
  }

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    throw new Error("Google 翻译接口返回了无法解析的内容")
  }

  const translated = parseGoogleTranslateResponse(payload)
  if (translated === null) {
    throw new Error("Google 翻译接口返回了无法解析的内容")
  }

  return translated
}
