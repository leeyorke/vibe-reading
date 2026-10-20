import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { synthesizeSpeechAudio } from "@/utils/speech"

/**
 * Pronunciation message handlers.
 *
 * The toolbar runs in a content script under the page's CSP, so the audio has
 * to arrive as raw bytes it can hand to Web Audio — see
 * `synthesizeSpeechAudio` in `utils/speech.ts`.
 */
export function setupSpeechMessageHandlers(): void {
  onMessage("synthesizeSpeechAudio", async ({ data }) => {
    try {
      return await synthesizeSpeechAudio(data)
    }
    catch (error) {
      logger.error("[Speech] synthesizeSpeechAudio failed:", error)
      throw new Error(`发音生成失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
