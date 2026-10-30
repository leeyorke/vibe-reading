import { z } from "zod"

/**
 * Configuration of the selection (划线) toolbar.
 *
 * `excludedDomains` holds user-authored domain rules. A rule covers the
 * domain itself and every subdomain of it, the same way the iframe
 * auto-injection patterns work (see `matchDomainPattern` in `utils/url.ts`).
 * A rule may carry a port (`localhost:4080`): with one it matches that exact
 * port only, without one it covers every port on the domain.
 */
export const selectionConfigSchema = z.object({
  /** Master switch: when off, the selection toolbar never appears. */
  enabled: z.boolean().default(true),
  /** Domain rules for the sites the toolbar must not appear on. */
  excludedDomains: z.array(z.string()).default([]),
})

export type SelectionConfig = z.infer<typeof selectionConfigSchema>
