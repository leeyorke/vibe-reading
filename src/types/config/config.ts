import { z } from "zod"

import { langCodeISO6393Schema, langLevel } from "@/definitions"
import { DEFAULT_BACKEND_BASE_URL } from "@/utils/constants/backend"
import { FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { backendConfigSchema } from "./backend"
import { providersConfigSchema } from "./provider"
import { translateConfigSchema } from "./translate"

export const uiLocaleSchema = z.enum(["en", "zh-CN"])
export type UILocale = z.infer<typeof uiLocaleSchema>

// Language schema
const languageSchema = z.object({
  sourceCode: langCodeISO6393Schema.or(z.literal("auto")),
  targetCode: langCodeISO6393Schema,
  level: langLevel,
})

// Complete config schema
export const configSchema = z.object({
  uiLocale: uiLocaleSchema.default("en"),
  language: languageSchema,
  providersConfig: providersConfigSchema,
  translate: translateConfigSchema,
  backend: backendConfigSchema.default({ baseUrl: DEFAULT_BACKEND_BASE_URL }),
}).superRefine((data, ctx) => {
  const providerIdsSet = new Set(data.providersConfig.map(p => p.id))

  for (const def of Object.values(FEATURE_PROVIDER_DEFS)) {
    const providerId = def.getProviderId(data)

    const validIds = new Set(providerIdsSet)
    if (!validIds.has(providerId)) {
      ctx.addIssue({
        code: "invalid_value",
        values: [...validIds],
        message: `Invalid provider id "${providerId}".`,
        path: [...def.configPath],
      })
      continue
    }

    const provider = data.providersConfig.find(p => p.id === providerId)
    if (provider && !def.isProvider(provider.provider)) {
      ctx.addIssue({
        code: "invalid_value",
        values: [...validIds],
        message: `Provider "${providerId}" is not a valid provider for this feature.`,
        path: [...def.configPath],
      })
    }

    if (provider && !provider.enabled) {
      ctx.addIssue({
        code: "custom",
        message: `Provider "${providerId}" must be enabled for this feature.`,
        path: [...def.configPath],
      })
    }
  }
})

export type Config = z.infer<typeof configSchema>
