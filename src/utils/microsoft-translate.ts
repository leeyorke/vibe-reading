import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

/**
 * Microsoft Translator, free and keyless — the second link of the quick
 * translation chain (see `utils/fallback-chain.ts`).
 *
 * The endpoint behind Edge's own translate UI answers
 * `POST https://edge.microsoft.com/translate/translatetext` with a bare JSON
 * string array and no credentials of any kind, which makes it the rare
 * keyless fallback that actually covers the same languages as Google's
 * `client=gtx` endpoint (verified 2026-11: all nine UI languages, auto
 * detection via an empty `from`, ~6k characters per request).
 *
 * Two endpoint quirks shape the adapter, and both were measured rather than
 * guessed:
 *
 * 1. **It always runs Microsoft's HTML tag aligner over the request.** A bare
 *    `<` in ordinary text ("if x < b then stop") fuses into a pseudo-tag and
 *    is eaten, so `&`, `<` and `>` are escaped before sending — escaped
 *    entities round-trip verbatim. (Straight quotes are curled into typographic
 *    ones no matter what we send, exactly like Google's endpoint does, so
 *    escaping them would buy nothing.)
 * 2. **The answer comes back HTML-encoded** (`&lt;` stays `&lt;`), so it is
 *    decoded exactly once here — never twice, or a literal `&amp;` in the
 *    source would surface as `&`.
 *
 * Like every undocumented endpoint in this project it carries no availability
 * guarantee: every failure is surfaced with the provider's own name attached,
 * and this file is the only thing that has to change if it ever moves.
 */

const MICROSOFT_TRANSLATE_ENDPOINT = "https://edge.microsoft.com/translate/translatetext"

/** `auto` in the shared language resolution means "let the endpoint detect it". */
const MICROSOFT_AUTO = "auto"

/**
 * Escapes the three characters the endpoint's tag aligner would otherwise
 * treat as markup. Order matters: `&` first, or the `&` of a freshly written
 * `&lt;` would be escaped a second time.
 */
export function escapeMicrosoftText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

const MICROSOFT_NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": "\u00A0",
}

/**
 * Decodes the entities the endpoint answers with, in a single left-to-right
 * pass so a decoded `&amp;lt;` never gets decoded again into `<`.
 */
export function decodeMicrosoftText(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|[a-z]+);/gi, (match, hex: string | undefined, dec: string | undefined) => {
    if (hex !== undefined) {
      return String.fromCodePoint(Number.parseInt(hex, 16))
    }
    if (dec !== undefined) {
      return String.fromCodePoint(Number.parseInt(dec, 10))
    }
    return MICROSOFT_NAMED_ENTITIES[match.toLowerCase()] ?? match
  })
}

/** The request the endpoint expects, exported so tests can inspect it. */
export function buildMicrosoftTranslateRequest(
  text: string,
  sourceLang: string,
  targetLang: string,
): { url: string, body: string } {
  // An empty `from` is how auto-detection is asked for; the response then
  // carries a `detectedLanguage` object alongside the translations.
  const from = sourceLang === MICROSOFT_AUTO ? "" : sourceLang

  const params = new URLSearchParams({
    from,
    to: targetLang,
    isEnterpriseClient: "false",
  })

  return {
    url: `${MICROSOFT_TRANSLATE_ENDPOINT}?${params.toString()}`,
    body: JSON.stringify([escapeMicrosoftText(text)]),
  }
}

/**
 * Pulls the translation out of the endpoint's response.
 *
 * The shape is `[{ translations: [{ text }] }]` — one entry per request item,
 * and this adapter only ever sends one. Anything else (an error page that
 * still answered 200, a future reshuffle, a length that does not match the
 * request) is `null`, which the caller turns into a visible failure instead
 * of rendering `[object Object]` into the popover.
 */
export function parseMicrosoftTranslateResponse(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length !== 1) {
    return null
  }

  const entry = payload[0]
  if (typeof entry !== "object" || entry === null) {
    return null
  }

  const { translations } = entry as { translations?: unknown }
  if (!Array.isArray(translations) || translations.length !== 1) {
    return null
  }

  const translation = translations[0]
  if (typeof translation !== "object" || translation === null) {
    return null
  }

  const { text } = translation as { text?: unknown }
  return typeof text === "string" ? decodeMicrosoftText(text) : null
}

/**
 * Translates one text over Microsoft's endpoint and resolves with the plain
 * translated text.
 *
 * `sourceLang` is the already-resolved code (`auto` for detection); `targetLang`
 * is a two-letter tag. Rejects with a message that names the actual failure —
 * a non-OK status, a body that is not the expected shape — because the
 * fallback chain shows it verbatim after 「翻译失败：」.
 */
export async function translateWithMicrosoft(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const { url, body } = buildMicrosoftTranslateRequest(text, sourceLang, targetLang)

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      // The endpoint is anonymous; sending cookies would only leak them.
      credentials: "omit",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body,
    })
  }
  catch (error) {
    throw new Error(`Microsoft 翻译接口网络错误：${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    // The status rides on the error so the fallback chain can tell a rate
    // limit (worth cooling the provider down for) from a bad request.
    throw attachRequestErrorMeta(new Error(`Microsoft 翻译接口返回 ${response.status}`), {
      statusCode: response.status,
      responseHeaders: response.headers,
    })
  }

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    throw new Error("Microsoft 翻译接口返回了无法解析的内容")
  }

  const translated = parseMicrosoftTranslateResponse(payload)
  if (translated === null) {
    throw new Error("Microsoft 翻译接口返回了无法解析的内容")
  }

  return translated
}
