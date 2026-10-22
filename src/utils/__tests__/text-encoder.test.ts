import { describe, expect, it } from "vitest"

/**
 * The test environment replaces the global `TextEncoder` (see
 * `vitest.setup.ts`) to keep the returned `Uint8Array` in the same realm as
 * the global one. That replacement used to keep only the low byte of every
 * character, which mangled every non-ASCII string.
 *
 * It stayed hidden until a test put a Chinese string into a `Response` body:
 * undici captures the global `TextEncoder` when it loads, so depending on the
 * import order the body was encoded with the broken one and the JSON came
 * back as mojibake — on CI only.
 */
describe("test environment TextEncoder", () => {
  it("encodes non-ASCII characters as proper UTF-8", () => {
    const bytes = new TextEncoder().encode("短暂")

    // U+77ED U+6682 → E7 9F AD E6 9A 82
    expect([...bytes]).toEqual([0xE7, 0x9F, 0xAD, 0xE6, 0x9A, 0x82])
  })

  it("keeps the IPA characters of a phonetic transcription intact", () => {
    const bytes = new TextEncoder().encode("/ɪˈfemərəl/")

    expect(new TextDecoder().decode(bytes)).toBe("/ɪˈfemərəl/")
  })

  it("round-trips a Chinese string through a response body", async () => {
    const res = new Response(JSON.stringify({ text: "token 无效" }))

    await expect(res.json()).resolves.toEqual({ text: "token 无效" })
  })
})
