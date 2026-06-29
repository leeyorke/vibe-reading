import type { Config } from "@/types/config/config"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { getLocalConfig } from "@/utils/config/storage"
import { resolveProviderConfigOrNull } from "@/utils/constants/feature-providers"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getTranslatePromptFromConfig } from "@/utils/prompts/translate"

/**
 * Translates a single selected text string.
 * Uses the current config's translate provider and language settings.
 * Does NOT go through the batch queue — returns immediately.
 */
async function translateSelectedText(data: { text: string, sourceLanguageCode?: string, targetLanguageCode?: string }): Promise<string | null> {
  const config = await getLocalConfig()
  if (!config) {
    logger.error("[SelectionTranslate] No config found")
    return null
  }

  const providerConfig = resolveProviderConfigOrNull(config, "translate")
  if (!providerConfig) {
    logger.error("[SelectionTranslate] No translate provider configured")
    return null
  }

  if (!isTranslateProviderConfig(providerConfig) && !isLLMProviderConfig(providerConfig)) {
    logger.error("[SelectionTranslate] Provider is not a translate provider")
    return null
  }

  const langConfig: Config["language"] = {
    sourceCode: (data.sourceLanguageCode ?? config.language.sourceCode) as Config["language"]["sourceCode"],
    targetCode: (data.targetLanguageCode ?? config.language.targetCode) as Config["language"]["targetCode"],
    level: config.language.level,
  }

  try {
    const translatedText = await executeTranslate(
      data.text,
      langConfig,
      providerConfig,
      async (targetLang: string, input: string, options?: any) => {
        return getTranslatePromptFromConfig(config.translate, targetLang, input, options)
      },
    )
    return translatedText
  }
  catch (error) {
    logger.error("[SelectionTranslate] Translation failed:", error)
    return null
  }
}

export function setupSelectionTranslateHandler() {
  onMessage("translateSelectedText", async (message) => {
    return await translateSelectedText(message.data)
  })
}
