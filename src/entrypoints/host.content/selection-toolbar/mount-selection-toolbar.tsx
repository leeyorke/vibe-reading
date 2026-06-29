import { createReactShadowHost, removeReactShadowHost } from "@/utils/react-shadow-host/create-shadow-host"
import { SelectionToolbar } from "./selection-toolbar"

/**
 * Mounts the selection translation toolbar into a Shadow DOM container.
 * Returns a cleanup function to unmount and remove it.
 * Only called for the top-level window.
 */
export function mountSelectionToolbar(): () => void {
  const shadowHost = createReactShadowHost(<SelectionToolbar />, {
    position: "block",
    inheritStyles: false,
  })

  document.body?.appendChild(shadowHost)

  return () => {
    removeReactShadowHost(shadowHost)
  }
}
