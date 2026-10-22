import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { configSchema } from "../config"

describe("selection config", () => {
  it("defaults to an enabled toolbar without excluded domains", () => {
    const result = configSchema.safeParse(DEFAULT_CONFIG)

    expect(result.success).toBe(true)
    expect(result.data?.selection).toEqual({ enabled: true, excludedDomains: [] })
  })

  it("keeps a config written before the section existed parseable", () => {
    // A config stored before the selection section existed must not fail
    // validation: the whole stored config would be thrown away and replaced
    // with the defaults, silently resetting every other setting.
    const { selection: _selection, ...legacyConfig } = DEFAULT_CONFIG

    const result = configSchema.safeParse(legacyConfig)

    expect(result.success).toBe(true)
    expect(result.data?.selection).toEqual({ enabled: true, excludedDomains: [] })
  })

  it("fills in the missing parts of a partially written section", () => {
    const result = configSchema.safeParse({
      ...DEFAULT_CONFIG,
      selection: { enabled: false },
    })

    expect(result.success).toBe(true)
    expect(result.data?.selection).toEqual({ enabled: false, excludedDomains: [] })
  })

  it("keeps the excluded domains the user configured", () => {
    const result = configSchema.safeParse({
      ...DEFAULT_CONFIG,
      selection: { enabled: true, excludedDomains: ["example.com"] },
    })

    expect(result.success).toBe(true)
    expect(result.data?.selection.excludedDomains).toEqual(["example.com"])
  })
})
