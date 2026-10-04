import { z } from "zod"

/** `HH:mm` in 24-hour form, used for the quiet-hours window. */
export const REVIEW_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const REVIEW_TIME_MESSAGE = "Time must use the 24-hour HH:mm format."

export const reviewQuietHoursConfigSchema = z.object({
  enabled: z.boolean().default(true),
  start: z.string().regex(REVIEW_TIME_REGEX, REVIEW_TIME_MESSAGE).default("23:00"),
  end: z.string().regex(REVIEW_TIME_REGEX, REVIEW_TIME_MESSAGE).default("08:00"),
})
export type ReviewQuietHoursConfig = z.infer<typeof reviewQuietHoursConfigSchema>

export const reviewConfigSchema = z.object({
  /**
   * Opt-in: notifications are intrusive, so the feature stays dark until the
   * user turns it on from the options page.
   */
  enabled: z.boolean().default(false),
  /** Generate a fresh example sentence with the LLM instead of reusing the collection context. */
  generateExample: z.boolean().default(true),
  /** Hard ceiling on notifications per calendar day across all words. */
  maxPerDay: z.number().int().min(1).max(50).default(8),
  /** Ceiling on notifications per word per calendar day. */
  maxPerWordPerDay: z.number().int().min(1).max(10).default(3),
  /** What happens after a word walks through every Ebbinghaus interval. */
  graduatedAction: z.enum(["stop", "restart"]).default("stop"),
  /**
   * `prefault` (not `default`) so `{}` is parsed through the object: every
   * field default above still applies, and a config written before this
   * feature existed gains a complete `review` block instead of failing the
   * whole `configSchema` check — which `initializeConfig` answers by resetting
   * the user's entire configuration.
   */
  quietHours: reviewQuietHoursConfigSchema.prefault({}),
})
export type ReviewConfig = z.infer<typeof reviewConfigSchema>
