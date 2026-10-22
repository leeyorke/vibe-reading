import { describe, expect, it } from "vitest"
import { isHostnameExcluded, matchesDomainRule, normalizeDomainRule, shouldShowSelectionToolbar } from "../selection-rules"

describe("normalizeDomainRule", () => {
  it("keeps a plain hostname as it is", () => {
    expect(normalizeDomainRule("example.com")).toBe("example.com")
  })

  it("strips the protocol, the path, the query and the hash", () => {
    expect(normalizeDomainRule("https://example.com")).toBe("example.com")
    expect(normalizeDomainRule("http://example.com/some/path")).toBe("example.com")
    expect(normalizeDomainRule("https://example.com/path?a=1#top")).toBe("example.com")
  })

  it("strips the port but keeps IPv6 literals intact", () => {
    expect(normalizeDomainRule("http://localhost:3000")).toBe("localhost")
    expect(normalizeDomainRule("http://[::1]:8080")).toBe("[::1]")
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

  it("never matches without a hostname or a rule", () => {
    expect(matchesDomainRule("", "example.com")).toBe(false)
    expect(matchesDomainRule("example.com", "")).toBe(false)
  })
})

describe("isHostnameExcluded", () => {
  it("is false without rules", () => {
    expect(isHostnameExcluded("example.com", [])).toBe(false)
  })

  it("is true when any rule covers the hostname", () => {
    expect(isHostnameExcluded("www.example.com", ["other.org", "example.com"])).toBe(true)
  })

  it("is false when no rule covers the hostname", () => {
    expect(isHostnameExcluded("example.com", ["other.org", "another.org"])).toBe(false)
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
})
