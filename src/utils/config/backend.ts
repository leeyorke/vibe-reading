import { DEFAULT_BACKEND_BASE_URL } from "@/utils/constants/backend"
import { getLocalConfig } from "./storage"

/**
 * Reads the configured backend base URL from storage.
 *
 * Falls back to {@link DEFAULT_BACKEND_BASE_URL} when the config is missing or
 * the URL is empty. Trailing slashes are stripped so paths can be joined with
 * a single `/` separator.
 */
export async function getBackendBaseUrl(): Promise<string> {
  const config = await getLocalConfig()
  const baseUrl = config?.backend?.baseUrl?.trim()

  if (!baseUrl) {
    return DEFAULT_BACKEND_BASE_URL
  }

  return baseUrl.replace(/\/+$/, "")
}
