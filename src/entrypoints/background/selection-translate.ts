import type { Browser } from "#imports"
import type { Config } from "@/types/config/config"
import type {
  SelectionTranslateStreamMessage,
  SelectionTranslateStreamRequest,
} from "@/types/selection-translate-stream"
import type { WordDefinition } from "@/types/vocabulary"
import { browser } from "#imports"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { SELECTION_TRANSLATE_STREAM_PORT } from "@/types/selection-translate-stream"
import { getLocalConfig } from "@/utils/config/storage"
import { resolveProviderConfigOrNull } from "@/utils/constants/feature-providers"
import { queryWordDefinitionStructured } from "@/utils/dict/dict-api"
import { executeTranslateStream } from "@/utils/host/translate/execute-translate"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getSelectionTranslatePrompt } from "@/utils/prompts/translate"

/**
 * Looks up a single word via the dictionary REST API and returns structured data.
 * Does NOT fall back to AI translation.
 *
 * An entry the dictionary cannot answer with is a miss (`null`), which is what
 * the toolbar interprets as "try the AI translation instead". That includes a
 * lookup that fails outright: the payload comes from a separate local service
 * with a shape that is not uniform, and a TypeError here would otherwise reach
 * the toolbar as a raw crash.
 */
async function translateSelectedTextStructured(data: { text: string }): Promise<WordDefinition | null> {
  try {
    return await queryWordDefinitionStructured(data.text)
  }
  catch (error) {
    logger.error("[SelectionTranslate] Dictionary lookup failed:", error)
    return null
  }
}

/**
 * Translates one selection and streams the answer back through `onDelta`.
 *
 * Deliberately throws instead of answering a quiet `null`: over a port there is
 * no return value to leave empty, and "no provider configured" is a
 * configuration mistake the user can act on rather than a blank popover they
 * have to guess about.
 */
async function translateSelectedTextStream(
  data: SelectionTranslateStreamRequest,
  onDelta: (delta: string) => void,
): Promise<string> {
  const config = await getLocalConfig()
  if (!config) {
    throw new Error("尚未读取到配置，请先在选项页保存一次设置")
  }

  const providerConfig = resolveProviderConfigOrNull(config, "translate")
  if (!providerConfig) {
    throw new Error("尚未配置翻译服务商")
  }

  if (!isTranslateProviderConfig(providerConfig) && !isLLMProviderConfig(providerConfig)) {
    throw new Error("当前翻译服务商不是可用的 LLM/翻译服务商")
  }

  const langConfig: Config["language"] = {
    sourceCode: (data.sourceLanguageCode ?? config.language.sourceCode) as Config["language"]["sourceCode"],
    targetCode: (data.targetLanguageCode ?? config.language.targetCode) as Config["language"]["targetCode"],
    level: config.language.level,
  }

  // Selection translate uses its own built-in analysis prompt (English ->
  // Chinese), independent from the page-translation custom prompts config.
  return await executeTranslateStream(
    data.text,
    langConfig,
    providerConfig,
    async (_targetLang: string, input: string) => {
      return getSelectionTranslatePrompt(input)
    },
    onDelta,
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Only the two methods this relay actually calls on the port it was handed. */
type SelectionTranslatePort = Pick<Browser.runtime.Port, "postMessage" | "disconnect">

/**
 * Streams one selection translation to the tab that asked for it.
 *
 * The port is the whole channel: the toolbar posts its request, we push deltas
 * back as the provider produces them, then close with `done` or `error` and
 * hang up. Hanging up matters — a port left open keeps the service worker
 * alive for a request that is long finished.
 */
async function relayStream(data: SelectionTranslateStreamRequest, port: SelectionTranslatePort) {
  const post = (message: SelectionTranslateStreamMessage) => {
    try {
      port.postMessage(message)
    }
    catch (error) {
      // The tab went away mid-stream (navigation, closed frame). Nothing left
      // to tell, and throwing here would only surface as an unhandled rejection.
      logger.warn("[SelectionTranslate] Stream port closed while posting", error)
    }
  }

  try {
    const translatedText = await translateSelectedTextStream(data, delta => post({ type: "delta", text: delta }))
    post({ type: "done", text: translatedText })
  }
  catch (error) {
    logger.error("[SelectionTranslate] Streaming translation failed:", error)
    post({ type: "error", message: errorMessage(error) })
  }
  finally {
    port.disconnect()
  }
}

/**
 * Opens the streaming selection-translate channel.
 *
 * One port, one request: the request rides the first `port.onMessage`, so a tab
 * that clicks 翻译 twice simply gets two ports, and a port carrying no readable
 * request is dropped without ever touching the provider.
 */
export function setupSelectionTranslateStreamHandler() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== SELECTION_TRANSLATE_STREAM_PORT) {
      return
    }

    port.onMessage.addListener((message: SelectionTranslateStreamRequest) => {
      if (typeof message?.text !== "string" || message.text.trim() === "") {
        port.disconnect()
        return
      }

      void relayStream(message, port)
    })
  })
}

export function setupSelectionTranslateHandler() {
  onMessage("translateSelectedTextStructured", async (message) => {
    return await translateSelectedTextStructured(message.data)
  })
}
