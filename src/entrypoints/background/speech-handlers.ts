import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { synthesizeSpeech, synthesizeSpeechAudio } from "@/utils/review/speech"

/**
 * Pronunciation message handlers.
 *
 * These moved out of `review-handlers.ts` the moment the selection toolbar
 * started asking for speech too — pronunciation is no longer a review-card
 * concern. The two exits exist because the two callers live in different
 * worlds: the review card is an extension page and plays a `data:` URL through
 * an `Audio` element, while the toolbar runs in a content script under the
 * page's CSP and plays raw bytes through Web Audio.
 */
export function setupSpeechMessageHandlers(): void {
  onMessage("synthesizeSpeech", async ({ data }) => {
    try {
      return await synthesizeSpeech(data)
    }
    catch (error) {
      logger.error("[Speech] synthesizeSpeech failed:", error)
      throw new Error(`发音生成失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

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
