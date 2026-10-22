import type { Config } from "@/types/config/config"
import { defineContentScript } from "#imports"
import { configSchema } from "@/types/config/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { getLocalConfig } from "@/utils/config/storage"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { loadUiLocaleMessages } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { shouldShowSelectionToolbar } from "@/utils/selection-rules"

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

      // The rules decide whether the toolbar may appear on this site at all.
      // The host is read once: a document cannot change its own host without a
      // reload, and a reload runs this script again.
      const hostname = window.location.hostname
      let unmount: (() => void) | null = null

      const applySelectionRules = (config: Config) => {
        if (shouldShowSelectionToolbar(config.selection, hostname)) {
          unmount ??= mountSelectionToolbar()
          return
        }

        unmount?.()
        unmount = null
      }

      applySelectionRules(initialConfig ?? DEFAULT_CONFIG)

      // Rules changed in the options page while this tab stayed open: the
      // toolbar has to disappear (or come back) without a page reload.
      const unwatch = storageAdapter.watch<Config>(CONFIG_STORAGE_KEY, (value) => {
        const parsed = configSchema.safeParse(value)
        if (!parsed.success) {
          return
        }

        try {
          applySelectionRules(parsed.data)
        }
        catch (error) {
          logger.error("[SelectionToolbar] Failed to apply the selection rules:", error)
        }
      })

      ctx.onInvalidated(() => {
        unwatch()
        unmount?.()
        unmount = null
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
