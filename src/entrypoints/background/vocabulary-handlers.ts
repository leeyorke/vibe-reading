import type {
  AddVocabularyWordPayload,
  UpdateVocabularyWordPayload,
  VocabularyQuery,
  VocabularyWord,
} from "@/types/vocabulary"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import {
  apiAddWord,
  apiDeleteWord,
  apiGetFlashcardSession,
  apiGetWords,
  apiMarkWordReviewed,
  apiUpdateWord,
} from "@/utils/vocabulary/vocabulary-api"

export function setupVocabularyMessageHandlers() {
  onMessage("addVocabularyWord", async (message) => {
    try {
      const id = await apiAddWord(message.data as AddVocabularyWordPayload)
      return id
    }
    catch (error) {
      logger.error("[Vocabulary] addVocabularyWord failed:", error)
      throw new Error(`添加生词失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("getVocabularyWords", async (message) => {
    try {
      return await apiGetWords(message.data as VocabularyQuery)
    }
    catch (error) {
      logger.error("[Vocabulary] getVocabularyWords failed:", error)
      throw new Error(`查询生词本失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("updateVocabularyWord", async (message) => {
    try {
      await apiUpdateWord(message.data as UpdateVocabularyWordPayload)
    }
    catch (error) {
      logger.error("[Vocabulary] updateVocabularyWord failed:", error)
      throw new Error(`更新生词失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("deleteVocabularyWord", async (message) => {
    try {
      await apiDeleteWord((message.data as { id: string }).id)
    }
    catch (error) {
      logger.error("[Vocabulary] deleteVocabularyWord failed:", error)
      throw new Error(`删除生词失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("getFlashcardSession", async (message) => {
    try {
      const count = (message.data as { count?: number }).count ?? 10
      return await apiGetFlashcardSession(count) as VocabularyWord[]
    }
    catch (error) {
      logger.error("[Vocabulary] getFlashcardSession failed:", error)
      throw new Error(`获取闪卡失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  onMessage("markWordReviewed", async (message) => {
    try {
      const { wordId, star } = message.data as { wordId: string, star: 1 | 2 | 3 | 4 | 5 }
      await apiMarkWordReviewed(wordId, star)
    }
    catch (error) {
      logger.error("[Vocabulary] markWordReviewed failed:", error)
      throw new Error(`标记复习失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
