import { z } from "zod"
import { DEFAULT_BACKEND_BASE_URL } from "@/utils/constants/backend"

export const backendConfigSchema = z.object({
  baseUrl: z.string().url().default(DEFAULT_BACKEND_BASE_URL),
})

export type BackendConfig = z.infer<typeof backendConfigSchema>
