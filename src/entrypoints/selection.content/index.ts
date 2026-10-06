import { defineContentScript } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { loadUiLocaleMessages } from "@/utils/i18n"
import { logger } from "@/utils/logger"

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "manual",
  async main(ctx) {
    // Only mount in the top-level window
    if (window !== window.top)
      return

    try {
      const initialConfig = await getLocalConfig()
      await loadUiLocaleMessages(initialConfig?.uiLocale ?? DEFAULT_CONFIG.uiLocale, { applyDocumentLang: false })

      const { mountSelectionToolbar } = await import("@/entrypoints/host.content/selection-toolbar/mount-selection-toolbar")
      const unmount = mountSelectionToolbar()

      ctx.onInvalidated(() => {
        unmount()
      })
    }
    catch (error) {
      // The extension was reloaded or updated while this script was still
      // starting up: every API call it makes now throws, so there is nothing
      // mounted to clean up either. Caught on purpose — an uncaught rejection
      // here only shows up as a scary entry on chrome://extensions.
      logger.error("[SelectionToolbar] Content script start aborted:", error)
    }
  },
})
