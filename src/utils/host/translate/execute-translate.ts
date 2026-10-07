import type { PromptResolver, TranslateStreamDeltaHandler } from "./api/ai"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { LANG_CODE_TO_EN_NAME } from "@/definitions"
import { isLLMProviderConfig } from "@/types/config/provider"
import { aiTranslate, aiTranslateStream } from "./api/ai"
import { prepareTranslationText } from "./text-preparation"

export async function executeTranslate<TContext>(
  text: string,
  langConfig: Config["language"],
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: {
    forceBackgroundFetch?: boolean
    isBatch?: boolean
    context?: TContext
  },
) {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const { provider } = providerConfig
  let translatedText = ""

  if (isLLMProviderConfig(providerConfig)) {
    const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
    translatedText = await aiTranslate(preparedText, targetLangName, providerConfig, promptResolver, options)
  }
  else {
    throw new Error(`Unknown provider: ${provider}`)
  }

  return translatedText.trim()
}

/**
 * Streaming twin of {@link executeTranslate}: same preparation, same provider
 * routing, same prompt resolution — but `onDelta` sees every slice of the
 * answer as it is generated and the return value is the whole text once the
 * provider is done. Callers that cannot show partial output should keep using
 * `executeTranslate`; this one exists for the selection toolbar, where a
 * several-second wait behind a spinner is the whole complaint.
 */
export async function executeTranslateStream<TContext>(
  text: string,
  langConfig: Config["language"],
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  onDelta: TranslateStreamDeltaHandler,
  options?: {
    forceBackgroundFetch?: boolean
    isBatch?: boolean
    context?: TContext
  },
) {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const { provider } = providerConfig
  if (!isLLMProviderConfig(providerConfig)) {
    throw new Error(`Unknown provider: ${provider}`)
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
  const translatedText = await aiTranslateStream(
    preparedText,
    targetLangName,
    providerConfig,
    promptResolver,
    onDelta,
    options,
  )

  return translatedText.trim()
}
