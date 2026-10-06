import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { loadUiLocaleMessages } from "@/utils/i18n"
import { logger } from "@/utils/logger"

declare global {
  interface Window {
    __READ_FROG_HOST_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "manual",
  async main(ctx) {
    // Prevent double injection (manifest-based + programmatic injection)
    if (window.__READ_FROG_HOST_INJECTED__)
      return
    window.__READ_FROG_HOST_INJECTED__ = true

    try {
      const initialConfig = await getLocalConfig()
      await loadUiLocaleMessages(initialConfig?.uiLocale ?? DEFAULT_CONFIG.uiLocale, { applyDocumentLang: false })

      const { bootstrapHostContent } = await import("./runtime")
      await bootstrapHostContent(ctx, initialConfig)
    }
    catch (error) {
      // The extension can be reloaded or updated while this script is still
      // starting up, after which every API call it makes throws. Caught on
      // purpose — an uncaught rejection here only shows up as a scary entry
      // on chrome://extensions with no connection to the reload that caused it.
      logger.error("[HostContent] Content script start aborted:", error)
    }
  },
})
