import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearProviderCooldowns, runWithFallback } from "@/utils/fallback-chain"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

/** An error the chain will read as a rate limit, the way the adapters throw one. */
function rateLimited(message = "接口返回 429") {
  return attachRequestErrorMeta(new Error(message), { statusCode: 429 })
}

describe("runWithFallback", () => {
  beforeEach(() => {
    clearProviderCooldowns()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the first provider that answers", async () => {
    const second = vi.fn(async () => "never")

    await expect(runWithFallback([
      { name: "A", run: async () => "first" },
      { name: "B", run: second },
    ])).resolves.toBe("first")
    expect(second).not.toHaveBeenCalled()
  })

  it("falls through to the next provider when one fails", async () => {
    await expect(runWithFallback([
      { name: "A", run: async () => { throw new Error("A 坏了") } },
      { name: "B", run: async () => "second" },
    ])).resolves.toBe("second")
  })

  // Every failure is surfaced: the popover shows this verbatim, and
  // "something went wrong" helps nobody.
  it("names every provider that failed when the last one fails too", async () => {
    const error = await runWithFallback([
      { name: "Google 翻译", run: async () => { throw new Error("接口返回 429") } },
      { name: "Microsoft 翻译", run: async () => { throw new Error("接口返回 400") } },
    ]).catch((e: unknown) => e)

    expect((error as Error).message).toBe("Google 翻译：接口返回 429；Microsoft 翻译：接口返回 400")
  })

  // One provider, one failure: the raw error is already the whole story —
  // wrapping it in a list of one would only add noise.
  it("rethrows the original error when a single provider fails", async () => {
    const original = new Error("Google TTS responded 429")

    const error = await runWithFallback([
      { name: "Google TTS", run: async () => { throw original } },
    ]).catch((e: unknown) => e)

    expect(error).toBe(original)
  })

  it("refuses to run an empty list rather than answering nothing", async () => {
    await expect(runWithFallback([])).rejects.toThrow("没有可用的服务")
  })

  describe("rate-limit cooldown", () => {
    it("moves a provider that just rate-limited to the back of the list", async () => {
      const attempts = [
        { name: "A", cooldownKey: "a", run: vi.fn(async () => { throw rateLimited() }) },
        { name: "B", cooldownKey: "b", run: vi.fn(async () => "from B") },
      ]

      await runWithFallback(attempts).catch(() => {})
      await expect(runWithFallback(attempts)).resolves.toBe("from B")

      // B answered first this time; the cooled A is still in the list, just last.
      expect(attempts[1].run).toHaveBeenCalledTimes(2)
      expect(attempts[0].run).toHaveBeenCalledTimes(1)
    })

    it("does not cool down on an ordinary failure", async () => {
      const attempts = [
        { name: "A", cooldownKey: "a", run: vi.fn(async () => { throw new Error("接口返回 400") }) },
        { name: "B", cooldownKey: "b", run: vi.fn(async () => "from B") },
      ]

      await runWithFallback(attempts).catch(() => {})
      await runWithFallback(attempts).catch(() => {})

      expect(attempts[0].run).toHaveBeenCalledTimes(2)
    })

    it("restores the original order once the cooldown expires", async () => {
      const attempts = [
        { name: "A", cooldownKey: "a", run: vi.fn(async () => { throw rateLimited() }) },
        { name: "B", cooldownKey: "b", run: vi.fn(async () => "from B") },
      ]

      await runWithFallback(attempts).catch(() => {})
      vi.setSystemTime(new Date(Date.now() + 31_000))
      await runWithFallback(attempts).catch(() => {})

      // A is back at the front: it was asked before B in the second round.
      const [firstA, secondA] = attempts[0].run.mock.invocationCallOrder
      const [, secondB] = attempts[1].run.mock.invocationCallOrder
      expect(secondA).toBeLessThan(secondB)
      expect(firstA).toBeLessThan(secondA)
    })

    // The cooldown is a hint about who is likely to answer, not a licence to
    // fail without trying: when everything is cooling the order stands.
    it("keeps the original order when every provider is cooling", async () => {
      const attempts = [
        { name: "A", cooldownKey: "a", run: vi.fn(async () => { throw rateLimited() }) },
        { name: "B", cooldownKey: "b", run: vi.fn(async () => { throw rateLimited() }) },
      ]

      await runWithFallback(attempts).catch(() => {})
      await runWithFallback(attempts).catch(() => {})

      expect(attempts[0].run).toHaveBeenCalledTimes(2)
      expect(attempts[1].run).toHaveBeenCalledTimes(2)
    })

    it("ignores providers without a cooldown key", async () => {
      const attempts = [
        { name: "A", run: vi.fn(async () => { throw rateLimited() }) },
        { name: "B", run: vi.fn(async () => "from B") },
      ]

      await runWithFallback(attempts).catch(() => {})
      await runWithFallback(attempts).catch(() => {})

      // No key, no demotion: A is still asked first every time.
      expect(attempts[0].run).toHaveBeenCalledTimes(2)
    })
  })
})
