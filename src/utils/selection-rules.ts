import type { SelectionConfig } from "@/types/config/selection"

/**
 * Rules that decide where the selection (划线) toolbar is allowed to appear.
 *
 * A rule is a domain pattern typed by the user — `example.com`,
 * `*.example.com`, `https://example.com/some/path`, optionally with a port
 * (`localhost:4080`). A rule covers the domain itself *and* every subdomain
 * of it, the same way the iframe auto-injection patterns work (see
 * `matchDomainPattern` in `utils/url.ts`): `example.com` therefore also
 * covers `www.example.com`.
 *
 * The port is optional. A rule without one covers every port on the domain;
 * a rule with one matches that exact `host:port` pair only — which is how
 * you exclude a single local dev server (`127.0.0.1:4080`) while keeping the
 * toolbar on the other ports of the same machine. Callers therefore compare
 * against `location.host` (which carries the port), never
 * `location.hostname` (which never does).
 */

/** `https://`, `file://`, … — the scheme of a pasted URL. */
const PROTOCOL_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/** Splits `host:port`, keeping IPv6 literals (`[::1]:8080`) in one piece. */
function splitHostPort(value: string): { host: string, port: string } {
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]")
    if (closingBracket === -1) {
      return { host: value, port: "" }
    }

    const port = value.slice(closingBracket + 1)
    return { host: value.slice(0, closingBracket + 1), port: port.startsWith(":") ? port.slice(1) : "" }
  }

  const colonIndex = value.indexOf(":")
  if (colonIndex === -1) {
    return { host: value, port: "" }
  }

  return { host: value.slice(0, colonIndex), port: value.slice(colonIndex + 1) }
}

/**
 * Turns whatever the user typed into a bare domain, with an optional port.
 *
 * Accepts full URLs, hostnames with a port, and the `*.` / `.` wildcard
 * prefixes. Returns an empty string for input that carries no domain at all.
 */
export function normalizeDomainRule(raw: string): string {
  let value = raw.trim().toLowerCase()
  if (!value) {
    return ""
  }

  // "https://example.com/path?x=1" → "example.com:8080"
  value = value.replace(PROTOCOL_PREFIX_RE, "")
  value = value.split(/[/?#]/)[0] ?? ""

  // "user@example.com" → "example.com"
  const atIndex = value.lastIndexOf("@")
  if (atIndex !== -1) {
    value = value.slice(atIndex + 1)
  }

  // The port is kept ("localhost:3000"), IPv6 literals stay bracketed.
  const { host, port } = splitHostPort(value)
  if (!host) {
    return ""
  }

  // "*.example.com" / ".example.com" → "example.com"
  const bareHost = host.replace(/^\*+\./, "").replace(/^\./, "")

  // A lone "*" is not a domain — it would match nothing at all.
  if (/^\*+$/.test(bareHost)) {
    return ""
  }

  return port ? `${bareHost}:${port}` : bareHost
}

/**
 * Whether a hostname is covered by a single rule.
 *
 * The rule matches the domain itself and its subdomains; `notexample.com`
 * is *not* covered by the rule `example.com`. A rule carrying a port only
 * matches that exact port; a rule without one covers every port.
 */
export function matchesDomainRule(hostname: string, rule: string): boolean {
  const normalizedRule = normalizeDomainRule(rule)
  const host = splitHostPort(hostname.trim().toLowerCase())

  if (!host.host || !normalizedRule) {
    return false
  }

  const ruleHost = splitHostPort(normalizedRule)
  if (!ruleHost.host) {
    return false
  }

  if (ruleHost.port && ruleHost.port !== host.port) {
    return false
  }

  return host.host === ruleHost.host || host.host.endsWith(`.${ruleHost.host}`)
}

/** Whether any rule in the list covers the host. */
export function isHostExcluded(host: string, rules: readonly string[]): boolean {
  return rules.some(rule => matchesDomainRule(host, rule))
}

/**
 * The single decision the selection toolbar asks before it mounts itself:
 * is it allowed to appear on this host (`location.host`, port included)?
 */
export function shouldShowSelectionToolbar(config: SelectionConfig, host: string): boolean {
  if (!config.enabled) {
    return false
  }

  return !isHostExcluded(host, config.excludedDomains)
}
