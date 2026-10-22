import type {
  EudicCategory,
  EudicConfig,
  EudicSyncResult,
  EudicTokenSource,
  EudicVerifyResult,
  UpdateEudicConfigPayload,
} from "@/types/eudic"
import { getBackendBaseUrl } from "@/utils/config/backend"
import { logger } from "@/utils/logger"

/**
 * The Eudic side of the vocabulary book lives behind the companion backend.
 *
 * The backend holds the NIS token (read from the `EUDIT_API_KEY`
 * environment variable) and talks to `api.frdic.com`; the extension never
 * sees the token at all. Everything here is a thin pass-through.
 */

/** Backend snake_case shape of the public config */
interface EudicConfigResponse {
  enabled: boolean
  token_source: "env" | "settings" | "none"
  has_fallback_token: boolean
  category_id: string
  category_name: string
  sync_new_words: boolean
  last_synced_at: number
  language: string
}

function toEudicConfig(raw: EudicConfigResponse): EudicConfig {
  return {
    enabled: raw.enabled,
    tokenSource: raw.token_source,
    hasFallbackToken: raw.has_fallback_token,
    categoryId: raw.category_id,
    categoryName: raw.category_name,
    syncNewWords: raw.sync_new_words,
    lastSyncedAt: raw.last_synced_at,
    language: raw.language,
  }
}

/**
 * Turn a backend error body into a readable message.
 *
 * The backend answers with `{"detail": "..."}`, but a crash inside the
 * backend comes back as a bare `text/plain` "Internal Server Error" — that
 * body is useless, so it is replaced by the status code instead of being
 * shown verbatim.
 */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { detail?: string, message?: string }
    const detail = body?.detail ?? body?.message
    if (detail)
      return detail
  }
  catch {
    // Not a JSON error body — fall through to the generic message.
  }
  return `${fallback}（HTTP ${res.status}）`
}

/** Read the current Eudic configuration */
export async function apiGetEudicConfig(): Promise<EudicConfig> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/eudic/config`)

  if (!res.ok) {
    throw new Error(await readError(res, "读取欧路配置失败"))
  }

  return toEudicConfig(await res.json())
}

/** Update the Eudic configuration (only the given fields are changed) */
export async function apiUpdateEudicConfig(
  data: UpdateEudicConfigPayload,
): Promise<EudicConfig> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/eudic/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(data.enabled != null && { enabled: data.enabled }),
      ...(data.fallbackToken != null && { fallback_token: data.fallbackToken }),
      ...(data.categoryId != null && { category_id: data.categoryId }),
      ...(data.categoryName != null && { category_name: data.categoryName }),
      ...(data.syncNewWords != null && { sync_new_words: data.syncNewWords }),
    }),
  })

  if (!res.ok) {
    throw new Error(await readError(res, "保存欧路配置失败"))
  }

  return toEudicConfig(await res.json())
}

/** List the vocabulary books on the Eudic account */
export async function apiGetEudicCategories(): Promise<{
  categories: EudicCategory[]
  tokenSource: string
}> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/eudic/categories`)

  if (!res.ok) {
    throw new Error(await readError(res, "获取欧路生词本失败"))
  }

  const raw = await res.json() as {
    categories: EudicCategory[]
    token_source: EudicTokenSource
  }

  return {
    categories: raw.categories ?? [],
    tokenSource: raw.token_source ?? "none",
  }
}

/** Check that the Eudic side is reachable with the configured token */
export async function apiVerifyEudicToken(): Promise<EudicVerifyResult> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/eudic/verify`, { method: "POST" })

  if (!res.ok) {
    throw new Error(await readError(res, "欧路连接验证失败"))
  }

  const raw = await res.json() as {
    ok: boolean
    token_source: EudicTokenSource
    categories: EudicCategory[]
  }

  return {
    ok: raw.ok,
    tokenSource: raw.token_source,
    categories: raw.categories ?? [],
  }
}

/** Pull the Eudic vocabulary book into the local vocabulary table */
export async function apiSyncEudicVocabulary(): Promise<EudicSyncResult> {
  const baseUrl = await getBackendBaseUrl()
  const res = await fetch(`${baseUrl}/api/eudic/sync`, { method: "POST" })

  if (!res.ok) {
    throw new Error(await readError(res, "同步欧路生词本失败"))
  }

  const raw = await res.json() as {
    skipped: string
    imported: number
    updated: number
    skipped_count: number
    total: number
    category_id?: string
    category_name?: string
    synced_at?: number
  }

  logger.info("[Eudic] Synced vocabulary:", raw)

  return {
    skipped: raw.skipped ?? "",
    imported: raw.imported ?? 0,
    updated: raw.updated ?? 0,
    skippedCount: raw.skipped_count ?? 0,
    total: raw.total ?? 0,
    ...(raw.category_id != null && { categoryId: raw.category_id }),
    ...(raw.category_name != null && { categoryName: raw.category_name }),
    ...(raw.synced_at != null && { syncedAt: raw.synced_at }),
  }
}
