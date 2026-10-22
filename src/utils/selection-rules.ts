import type { SelectionConfig } from "@/types/config/selection"

/**
 * Rules that decide where the selection (划线) toolbar is allowed to appear.
 *
 * A rule is a domain pattern typed by the user — `example.com`,
 * `*.example.com`, `https://example.com/some/path`. A rule covers the
 * domain itself *and* every subdomain of it, the same way the iframe
 * auto-injection patterns work (see `matchDomainPattern` in `utils/url.ts`):
 * `example.com` therefore also covers `www.example.com`.
 */

/** `https://`, `file://`, … — the scheme of a pasted URL. */
const PROTOCOL_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Turns whatever the user typed into a bare domain.
 *
 * Accepts full URLs, hostnames with a port, and the `*.` / `.` wildcard
 * prefixes. Returns an empty string for input that carries no domain at all.
 */
export function normalizeDomainRule(raw: string): string {
  let value = raw.trim().toLowerCase()
  if (!value) {
    return ""
  }

  // "https://example.com/path?x=1" → "example.com"
  value = value.replace(PROTOCOL_PREFIX_RE, "")
  value = value.split(/[/?#]/)[0] ?? ""

  // "user@example.com" → "example.com"
  const atIndex = value.lastIndexOf("@")
  if (atIndex !== -1) {
    value = value.slice(atIndex + 1)
  }

  // Drop the port, but keep IPv6 literals ("[::1]") intact.
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]")
    if (closingBracket !== -1) {
      value = value.slice(0, closingBracket + 1)
    }
  }
  else {
    const colonIndex = value.indexOf(":")
    if (colonIndex !== -1) {
      value = value.slice(0, colonIndex)
    }
  }

  // "*.example.com" / ".example.com" → "example.com"
  value = value.replace(/^\*+\./, "").replace(/^\./, "")

  // A lone "*" is not a domain — it would match nothing at all.
  if (/^\*+$/.test(value)) {
    return ""
  }

  return value
}

/**
 * Whether a hostname is covered by a single rule.
 *
 * The rule matches the domain itself and its subdomains; `notexample.com`
 * is *not* covered by the rule `example.com`.
 */
export function matchesDomainRule(hostname: string, rule: string): boolean {
  const host = hostname.trim().toLowerCase()
  const normalizedRule = normalizeDomainRule(rule)

  if (!host || !normalizedRule) {
    return false
  }

  return host === normalizedRule || host.endsWith(`.${normalizedRule}`)
}

/** Whether any rule in the list covers the hostname. */
export function isHostnameExcluded(hostname: string, rules: readonly string[]): boolean {
  return rules.some(rule => matchesDomainRule(hostname, rule))
}

/**
 * The single decision the selection toolbar asks before it mounts itself:
 * is it allowed to appear on this hostname?
 */
export function shouldShowSelectionToolbar(config: SelectionConfig, hostname: string): boolean {
  if (!config.enabled) {
    return false
  }

  return !isHostnameExcluded(hostname, config.excludedDomains)
}
