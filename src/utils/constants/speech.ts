/**
 * Default voice tag when the vocabulary entry carries no source language.
 *
 * The card speaks through Google's Translate endpoint — the one behind Google
 * Translate's own speaker button. It is undocumented and offers no availability
 * guarantee, so every call is cached and every failure is surfaced rather than
 * swallowed. Microsoft's equivalent (the Edge read-aloud endpoint) rejects every
 * request lacking a `Sec-MS-GEC` token derived from a Windows machine id, which
 * is an anti-automation control, not an API quirk to work around.
 */
export const TTS_DEFAULT_LANG = "en-US"
