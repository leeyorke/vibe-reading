import type { Config } from "@/types/config/config"
import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { reviewConfigSchema } from "@/types/config/review"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

describe("reviewConfigSchema", () => {
  it("fills in every default from an empty object", () => {
    expect(reviewConfigSchema.parse({})).toEqual({
      enabled: false,
      generateExample: true,
      maxPerDay: 8,
      maxPerWordPerDay: 3,
      graduatedAction: "stop",
      quietHours: { enabled: true, start: "23:00", end: "08:00" },
    })
  })

  it("rejects quiet-hours bounds that are not 24-hour times", () => {
    expect(reviewConfigSchema.safeParse({ quietHours: { start: "9:00" } }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ quietHours: { end: "24:00" } }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ quietHours: { start: "23:60" } }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ quietHours: { start: "09:05" } }).success).toBe(true)
  })

  it("keeps the daily caps inside a sane range", () => {
    expect(reviewConfigSchema.safeParse({ maxPerDay: 0 }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ maxPerDay: 51 }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ maxPerDay: 4.5 }).success).toBe(false)
    expect(reviewConfigSchema.safeParse({ maxPerDay: 50 }).success).toBe(true)
  })
})

describe("configSchema backward compatibility", () => {
  it("accepts a config written before the review feature existed", () => {
    // A config persisted by a build that predates `review`, so the key is absent
    // entirely rather than partially filled.
    const { review: _review, ...legacyConfig } = structuredClone(DEFAULT_CONFIG) as Config
    delete (legacyConfig as Partial<Config>).review

    const parsed = configSchema.safeParse(legacyConfig)

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.review).toEqual(DEFAULT_CONFIG.review)
  })

  it("keeps every other field intact while adding review defaults", () => {
    const parsed = configSchema.parse(structuredClone(DEFAULT_CONFIG))

    expect(parsed.review).toEqual(DEFAULT_CONFIG.review)
    expect(parsed.translate).toEqual(DEFAULT_CONFIG.translate)
    expect(parsed.backend).toEqual(DEFAULT_CONFIG.backend)
  })

  it("preserves explicitly configured review values", () => {
    const parsed = configSchema.parse({
      ...structuredClone(DEFAULT_CONFIG),
      review: { enabled: true, maxPerDay: 2, quietHours: { enabled: false, start: "01:00", end: "02:00" } },
    })

    expect(parsed.review.enabled).toBe(true)
    expect(parsed.review.maxPerDay).toBe(2)
    expect(parsed.review.quietHours).toEqual({ enabled: false, start: "01:00", end: "02:00" })
    // Untouched nested fields keep their defaults.
    expect(parsed.review.maxPerWordPerDay).toBe(3)
  })
})
