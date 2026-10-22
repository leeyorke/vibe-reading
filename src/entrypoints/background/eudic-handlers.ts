import type { UpdateEudicConfigPayload } from "@/types/eudic"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import {
  apiGetEudicCategories,
  apiGetEudicConfig,
  apiSyncEudicVocabulary,
  apiUpdateEudicConfig,
  apiVerifyEudicToken,
} from "@/utils/vocabulary/eudic-api"

/**
 * Message handlers for the Eudic vocabulary book.
 *
 * The extension never talks to `api.frdic.com` itself: the companion
 * backend holds the NIS token and does the actual calls. These handlers
 * just forward, and turn failures into messages the user can act on.
 */
export function setupEudicMessageHandlers(): void {
  onMessage("getEudicConfig", async () => {
    try {
      return await apiGetEudicConfig()
    }
    catch (error) {
      logger.error("[Eudic] getEudicConfig failed:", error)
      throw new Error(`读取欧路配置失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("updateEudicConfig", async (message) => {
    try {
      return await apiUpdateEudicConfig(message.data as UpdateEudicConfigPayload)
    }
    catch (error) {
      logger.error("[Eudic] updateEudicConfig failed:", error)
      throw new Error(`保存欧路配置失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("getEudicCategories", async () => {
    try {
      return await apiGetEudicCategories()
    }
    catch (error) {
      logger.error("[Eudic] getEudicCategories failed:", error)
      throw new Error(`获取欧路生词本失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("verifyEudicToken", async () => {
    try {
      return await apiVerifyEudicToken()
    }
    catch (error) {
      logger.error("[Eudic] verifyEudicToken failed:", error)
      throw new Error(`欧路连接验证失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("syncEudicVocabulary", async () => {
    try {
      return await apiSyncEudicVocabulary()
    }
    catch (error) {
      logger.error("[Eudic] syncEudicVocabulary failed:", error)
      throw new Error(`同步欧路生词本失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
