import { ISO6393_TO_6391 } from "@/definitions"

/**
 * Maps a stored ISO 639-3 code onto the two-letter tag the free machine
 * translation endpoints speak.
 *
 * Google's `client=gtx` endpoint and Microsoft's unauthenticated edge endpoint
 * share the same code space (`en`, `zh`, `zh-TW`, …), so the quick-translate
 * chain resolves the language pair once instead of once per provider. A
 * provider with a different code space would need its own mapping inside its
 * adapter — that is the seam to extend, not this function.
 *
 * An unmappable source language falls back to `auto` — the endpoint detects
 * it, which for a single selection is almost always the same answer. An
 * unmappable target falls back to the product's default target (Chinese).
 */
export function resolveIso6391(code: string | undefined, fallback: string): string {
  if (!code) {
    return fallback
  }

  const trimmed = code.trim()
  if (!trimmed) {
    return fallback
  }

  // Exact match first: the table carries mixed-case keys (`cmn-Hant`) that a
  // lowercased lookup would miss, and those are exactly the variants worth
  // keeping apart.
  const exact = ISO6393_TO_6391[trimmed]
  if (exact) {
    return exact
  }

  const normalized = trimmed.toLowerCase().replace(/_/g, "-")
  return ISO6393_TO_6391[normalized] ?? fallback
}
