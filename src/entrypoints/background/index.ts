import "@/utils/zod-config"
import { browser, defineBackground } from "#imports"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { openOptionsPage } from "@/utils/navigation"
import { ensureInitializedConfig } from "./config"
import { cleanupAllSummaryCache, cleanupAllTranslationCache, setUpDatabaseCleanup } from "./db-cleanup"
import { setupIframeInjection } from "./iframe-injection"
import { setupLLMGenerateTextMessageHandlers } from "./llm-generate-text"
import { proxyFetch } from "./proxy-fetch"
import { setupSelectionTranslateHandler } from "./selection-translate"
import { setUpWebPageTranslationQueue } from "./translation-queues"
import { translationMessage } from "./translation-signal"
import { setupVocabularyMessageHandlers } from "./vocabulary-handlers"

export default defineBackground({
  type: "module",
  main: () => {
    logger.info("Hello background!", { id: browser.runtime.id })

    browser.runtime.onInstalled.addListener(async (details) => {
      await ensureInitializedConfig()

      if (details.reason === "install") {
        logger.info("[Background] Extension installed")
      }
    })

    onMessage("openOptionsPage", async (message) => {
      logger.info("openOptionsPage", message.data)
      await openOptionsPage(message.data)
    })

    onMessage("clearAllTranslationRelatedCache", async () => {
      await cleanupAllTranslationCache()
      await cleanupAllSummaryCache()
    })

    translationMessage()

    void setUpWebPageTranslationQueue()
    void setUpDatabaseCleanup()

    proxyFetch()
    setupLLMGenerateTextMessageHandlers()

    // Setup on-demand iframe injection after page translation is enabled.
    setupIframeInjection()

    // Handle selection translation requests from content script
    setupSelectionTranslateHandler()

    // Handle vocabulary and flashcard message requests
    setupVocabularyMessageHandlers()
  },
})
