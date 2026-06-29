import { defineContentScript } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { loadUiLocaleMessages } from "@/utils/i18n"

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "manual",
  async main(ctx) {
    // Only mount in the top-level window
    if (window !== window.top)
      return

    const initialConfig = await getLocalConfig()
    await loadUiLocaleMessages(initialConfig?.uiLocale ?? DEFAULT_CONFIG.uiLocale, { applyDocumentLang: false })

    const { mountSelectionToolbar } = await import("@/entrypoints/host.content/selection-toolbar/mount-selection-toolbar")
    const unmount = mountSelectionToolbar()

    ctx.onInvalidated(() => {
      unmount()
    })
  },
})
