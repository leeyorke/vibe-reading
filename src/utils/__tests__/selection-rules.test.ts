import { describe, expect, it } from "vitest"
import { isHostExcluded, matchesDomainRule, normalizeDomainRule, shouldShowSelectionToolbar } from "../selection-rules"

describe("normalizeDomainRule", () => {
  it("keeps a plain hostname as it is", () => {
    expect(normalizeDomainRule("example.com")).toBe("example.com")
  })

  it("strips the protocol, the path, the query and the hash", () => {
    expect(normalizeDomainRule("https://example.com")).toBe("example.com")
    expect(normalizeDomainRule("http://example.com/some/path")).toBe("example.com")
    expect(normalizeDomainRule("https://example.com/path?a=1#top")).toBe("example.com")
  })

  it("keeps the port so a rule can pin one service", () => {
    expect(normalizeDomainRule("http://localhost:3000")).toBe("localhost:3000")
    expect(normalizeDomainRule("127.0.0.1:4080")).toBe("127.0.0.1:4080")
    expect(normalizeDomainRule("https://example.com:8080/path?a=1#top")).toBe("example.com:8080")
    expect(normalizeDomainRule("*.example.com:8080")).toBe("example.com:8080")
    expect(normalizeDomainRule("https://user:pass@example.com:8080")).toBe("example.com:8080")
  })

  it("keeps IPv6 literals intact, port included", () => {
    expect(normalizeDomainRule("http://[::1]")).toBe("[::1]")
    expect(normalizeDomainRule("http://[::1]:8080")).toBe("[::1]:8080")
  })

  it("strips the user info", () => {
    expect(normalizeDomainRule("https://user:pass@example.com")).toBe("example.com")
  })

  it("strips the wildcard prefixes", () => {
    expect(normalizeDomainRule("*.example.com")).toBe("example.com")
    expect(normalizeDomainRule(".example.com")).toBe("example.com")
  })

  it("lowercases and trims", () => {
    expect(normalizeDomainRule("  Example.COM  ")).toBe("example.com")
  })

  it("returns an empty string for input without a domain", () => {
    expect(normalizeDomainRule("")).toBe("")
    expect(normalizeDomainRule("   ")).toBe("")
    expect(normalizeDomainRule("*")).toBe("")
    expect(normalizeDomainRule("*:8080")).toBe("")
  })
})

describe("matchesDomainRule", () => {
  it("matches the domain itself", () => {
    expect(matchesDomainRule("example.com", "example.com")).toBe(true)
  })

  it("matches subdomains of the domain", () => {
    expect(matchesDomainRule("www.example.com", "example.com")).toBe(true)
    expect(matchesDomainRule("api.dev.example.com", "example.com")).toBe(true)
  })

  it("does not match a domain that merely ends with the same characters", () => {
    expect(matchesDomainRule("notexample.com", "example.com")).toBe(false)
    expect(matchesDomainRule("example.com.evil.org", "example.com")).toBe(false)
  })

  it("is case insensitive", () => {
    expect(matchesDomainRule("WWW.Example.com", "example.com")).toBe(true)
  })

  it("matches any port when the rule has none", () => {
    expect(matchesDomainRule("localhost:4080", "localhost")).toBe(true)
    expect(matchesDomainRule("localhost", "localhost")).toBe(true)
  })

  it("matches only the pinned port when the rule has one", () => {
    expect(matchesDomainRule("127.0.0.1:4080", "127.0.0.1:4080")).toBe(true)
    expect(matchesDomainRule("127.0.0.1:3000", "127.0.0.1:4080")).toBe(false)
    expect(matchesDomainRule("127.0.0.1", "127.0.0.1:4080")).toBe(false)
  })

  it("keeps covering subdomains of a port-pinned rule", () => {
    expect(matchesDomainRule("www.example.com:8080", "example.com:8080")).toBe(true)
    expect(matchesDomainRule("www.example.com:9090", "example.com:8080")).toBe(false)
  })

  it("never matches without a hostname or a rule", () => {
    expect(matchesDomainRule("", "example.com")).toBe(false)
    expect(matchesDomainRule("example.com", "")).toBe(false)
  })
})

describe("isHostExcluded", () => {
  it("is false without rules", () => {
    expect(isHostExcluded("example.com", [])).toBe(false)
  })

  it("is true when any rule covers the host", () => {
    expect(isHostExcluded("www.example.com", ["other.org", "example.com"])).toBe(true)
    expect(isHostExcluded("localhost:4080", ["other.org", "localhost:4080"])).toBe(true)
  })

  it("is false when no rule covers the host", () => {
    expect(isHostExcluded("example.com", ["other.org", "another.org"])).toBe(false)
    expect(isHostExcluded("localhost:3000", ["localhost:4080"])).toBe(false)
  })
})

describe("shouldShowSelectionToolbar", () => {
  it("shows the toolbar when it is enabled and nothing is excluded", () => {
    expect(shouldShowSelectionToolbar({ enabled: true, excludedDomains: [] }, "example.com")).toBe(true)
  })

  it("hides the toolbar when it is disabled", () => {
    expect(shouldShowSelectionToolbar({ enabled: false, excludedDomains: [] }, "example.com")).toBe(false)
  })

  it("hides the toolbar on an excluded site", () => {
    expect(shouldShowSelectionToolbar({ enabled: true, excludedDomains: ["example.com"] }, "www.example.com")).toBe(false)
  })

  it("shows the toolbar on a site that is not excluded", () => {
    expect(shouldShowSelectionToolbar({ enabled: true, excludedDomains: ["example.com"] }, "other.org")).toBe(true)
  })

  it("hides the toolbar only on the excluded port", () => {
    const config = { enabled: true, excludedDomains: ["localhost:4080"] }

    expect(shouldShowSelectionToolbar(config, "localhost:4080")).toBe(false)
    expect(shouldShowSelectionToolbar(config, "localhost:3000")).toBe(true)
  })
})
