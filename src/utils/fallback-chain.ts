import { isRateLimitRequestError } from "@/utils/request/retry-policy"

/**
 * Runs a list of interchangeable providers until one of them answers.
 *
 * The free endpoints the toolbar rides on (Google's `client=gtx` family, the
 * pronunciation button's TTS endpoint) rate-limit per IP and occasionally
 * answer 4xx/5xx for reasons that have nothing to do with the request. A
 * button that shows 「翻译失败」 because one upstream had a bad minute is a
 * broken button, so every such call site declares its providers as an ordered
 * list and lets this module do the failing-over.
 *
 * Two rules keep the failure honest rather than magic:
 *
 * 1. **Every failure is surfaced.** Nothing is swallowed: when the last
 *    provider fails too, the thrown error names each provider and what it
 *    answered, because the caller shows it verbatim in the popover and
 *    "something went wrong" helps nobody. With a single provider the original
 *    error is rethrown untouched — wrapping one failure in a list of one only
 *    adds noise.
 * 2. **A rate limit demotes, it does not veto.** A provider that just
 *    answered 429 is moved to the back of the list for a short while instead
 *    of being skipped outright: every later request then pays the healthy
 *    provider's latency instead of a guaranteed-failing round trip, and the
 *    cooled provider is still tried (last) when everything else fails, so a
 *    chain can never end up refusing to try at all. The cooldown lives in the
 *    service worker and dies with it, like the caches.
 */

/** How long a provider that just rate-limited us is kept at the back of the list. */
const RATE_LIMIT_COOLDOWN_MS = 30_000

export interface FallbackAttempt<T> {
  /** Provider name as the user should read it in an aggregated failure. */
  name: string
  /**
   * Cooldown bookkeeping key. Omit for a provider that cannot rate-limit —
   * with a single provider there is nothing to demote, and a key would only
   * record a cooldown nobody ever reads.
   */
  cooldownKey?: string
  run: () => Promise<T>
}

/** Provider key → timestamp until which it stays at the back of the list. */
const coolingUntil = new Map<string, number>()

/** Test seam: the cooldown map is an implementation detail with no other consumer. */
export function clearProviderCooldowns(): void {
  coolingUntil.clear()
}

function isCooling(key: string, now: number): boolean {
  const until = coolingUntil.get(key)
  return until !== undefined && until > now
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fresh providers first, rate-limited ones at the back.
 *
 * When everything is cooling the original order stands — the cooldown is a
 * hint about which provider is likely to answer, not a licence to fail
 * without trying.
 */
function orderAttempts<T>(attempts: readonly FallbackAttempt<T>[], now: number): FallbackAttempt<T>[] {
  const fresh: FallbackAttempt<T>[] = []
  const cooling: FallbackAttempt<T>[] = []

  for (const attempt of attempts) {
    if (attempt.cooldownKey !== undefined && isCooling(attempt.cooldownKey, now)) {
      cooling.push(attempt)
    }
    else {
      fresh.push(attempt)
    }
  }

  return cooling.length > 0 && fresh.length > 0 ? [...fresh, ...cooling] : [...attempts]
}

export async function runWithFallback<T>(attempts: readonly FallbackAttempt<T>[]): Promise<T> {
  if (attempts.length === 0) {
    throw new Error("没有可用的服务")
  }

  // One failure, one provider: the original error is already the whole story.
  const failures: string[] = []
  let singleFailure: { error: unknown } | undefined

  for (const attempt of orderAttempts(attempts, Date.now())) {
    try {
      return await attempt.run()
    }
    catch (error) {
      failures.push(`${attempt.name}：${errorMessage(error)}`)
      singleFailure = { error }
      if (attempt.cooldownKey !== undefined && isRateLimitRequestError(error)) {
        coolingUntil.set(attempt.cooldownKey, Date.now() + RATE_LIMIT_COOLDOWN_MS)
      }
    }
  }

  if (attempts.length === 1) {
    throw singleFailure!.error
  }

  throw new Error(failures.join("；"))
}
