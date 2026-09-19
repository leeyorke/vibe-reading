import type { Config } from "@/types/config/config"
import type { WordDefinition } from "@/types/vocabulary"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { getLocalConfig } from "@/utils/config/storage"
import { resolveProviderConfigOrNull } from "@/utils/constants/feature-providers"
import { queryWordDefinitionStructured } from "@/utils/dict/dict-api"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getSelectionTranslatePrompt } from "@/utils/prompts/translate"

/**
 * Translates a single selected text string.
 * - Single word → looks up via the configured dictionary REST API (`{baseUrl}/api/word/{word}`).
 * - Multiple words → uses the configured LLM/translate provider (existing AI translation).
 * Falls back to AI translation if the dictionary API returns no result.
 */
async function translateSelectedText(data: { text: string, sourceLanguageCode?: string, targetLanguageCode?: string }): Promise<string | null> {
  const wordCount = data.text.trim().split(/\s+/).length

  // Single word: try dictionary REST API first, fall back to AI on failure
  if (wordCount === 1) {
    const dictResult = await queryWordDefinitionStructured(data.text)
    if (dictResult !== null) {
      return formatDictAsText(dictResult)
    }
    // If dictionary API fails, fall through to AI translation
    logger.info("[SelectionTranslate] Dictionary API returned no result, falling back to AI")
  }

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
    // Selection translate uses its own built-in analysis prompt (English ->
    // Chinese), independent from the page-translation custom prompts config.
    const translatedText = await executeTranslate(
      data.text,
      langConfig,
      providerConfig,
      async (_targetLang: string, input: string) => {
        return getSelectionTranslatePrompt(input)
      },
    )
    return translatedText
  }
  catch (error) {
    logger.error("[SelectionTranslate] Translation failed:", error)
    return null
  }
}

/**
 * Looks up a single word via the dictionary REST API and returns structured data.
 * Does NOT fall back to AI translation.
 */
async function translateSelectedTextStructured(data: { text: string }): Promise<WordDefinition | null> {
  return await queryWordDefinitionStructured(data.text)
}

/**
 * Formats a structured WordDefinition into the plain text string used by the legacy UI.
 */
function formatDictAsText(data: WordDefinition): string {
  const lines: string[] = []
  lines.push(data.headword)
  const ukPhonetic = data.phoneticUK ?? ""
  const usPhonetic = data.phoneticUS ?? ""
  if (ukPhonetic || usPhonetic) {
    const parts: string[] = []
    if (ukPhonetic)
      parts.push(`英 ${ukPhonetic}`)
    if (usPhonetic)
      parts.push(`美 ${usPhonetic}`)
    lines.push(parts.join(" "))
  }
  for (const sense of data.senses) {
    const posLabel = data.pos ? `${data.pos}. ` : ""
    lines.push(`${sense.number}. ${posLabel}${sense.chineseDefinition}`)
  }
  return lines.join("\n")
}

export function setupSelectionTranslateHandler() {
  onMessage("translateSelectedText", async (message) => {
    return await translateSelectedText(message.data)
  })
  onMessage("translateSelectedTextStructured", async (message) => {
    return await translateSelectedTextStructured(message.data)
  })
}
