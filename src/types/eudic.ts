/** 欧路（Eudic）生词本接入的配置与状态 */
export type EudicTokenSource = "env" | "settings" | "none"

/** 一个欧路生词本 */
export interface EudicCategory {
  /** 生词本 id，例如 "0"（默认生词本） */
  id: string
  /** 生词本名称 */
  name: string
  /** 语言代码 */
  language: string
}

/** 欧路接入的当前状态（token 不回传明文） */
export interface EudicConfig {
  /** 是否启用欧路同步 */
  enabled: boolean
  /** token 的来源：环境变量 / 设置页 / 未配置 */
  tokenSource: EudicTokenSource
  /** 是否已经存了备用 token */
  hasFallbackToken: boolean
  /** 要同步的生词本 id */
  categoryId: string
  /** 生词本名称 */
  categoryName: string
  /** 本地新收藏的词是否同时推给欧路 */
  syncNewWords: boolean
  /** 上次同步时间（毫秒时间戳），0 = 从未同步 */
  lastSyncedAt: number
  /** 欧路接口的语言（en/fr/de/es） */
  language: string
}

/** 同步结果 */
export interface EudicSyncResult {
  /** 没同步时给的原因（已同步时为空串） */
  skipped: string
  /** 新建了多少条 */
  imported: number
  /** 更新了多少条 */
  updated: number
  /** 跳过了多少条（空词之类） */
  skippedCount: number
  /** 这次同步到的词数 */
  total: number
  /** 同步的生词本 id */
  categoryId?: string
  /** 同步的生词本名称 */
  categoryName?: string
  /** 同步完成时间（毫秒时间戳） */
  syncedAt?: number
}

/** 验证连接的结果 */
export interface EudicVerifyResult {
  ok: boolean
  tokenSource: EudicTokenSource
  categories: EudicCategory[]
}

/** 配置更新负载（只传要改的字段） */
export interface UpdateEudicConfigPayload {
  enabled?: boolean
  fallbackToken?: string
  categoryId?: string
  categoryName?: string
  syncNewWords?: boolean
}
