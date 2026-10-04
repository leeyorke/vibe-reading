import type { ReviewScheduleEntry } from "@/types/review"
import { browser } from "#imports"
import { getLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { getLocalConfig } from "@/utils/config/storage"
import {
  CONTEXT_MESSAGE_MAX_LENGTH,
  NOTIFICATION_ID_PREFIX,
  REVIEW_NOTIFICATION_ICON_PATH,
} from "@/utils/constants/review"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import {
  loadNotificationRegistry,
  pruneNotificationRegistry,
  saveNotificationRegistry,
} from "@/utils/review/store"

/**
 * Notification ids are generated here rather than read back from
 * `notifications.create`, which only returns one from Chrome 116 on. Owning
 * the id keeps the payload registry correct on every supported browser.
 */
export function buildNotificationId(entry: ReviewScheduleEntry, now: number): string {
  return `${NOTIFICATION_ID_PREFIX}-${entry.wordId}-${now}`
}

/** First dictionary line, trimmed to what fits in a notification subtitle. */
export function buildContextMessage(entry: ReviewScheduleEntry): string {
  const line = entry.translation.split("\n")[0]?.trim() ?? ""
  if (line.length <= CONTEXT_MESSAGE_MAX_LENGTH) {
    return line
  }
  return `${line.slice(0, CONTEXT_MESSAGE_MAX_LENGTH - 1)}…`
}

export interface CreateReviewNotificationInput {
  entry: ReviewScheduleEntry
  /** Notification body: a freshly generated sentence, or empty. */
  sentence: string
  now: number
}

/**
 * Show one review reminder.
 *
 * The notification is deliberately a doorbell and nothing more: the headword
 * alone is the "wait, that's the…?" trigger, and Windows' collapsed toast
 * shows exactly one line, so anything more elaborate would be invisible to the
 * learner anyway. It carries no buttons — clicking opens the review card, where
 * the sentence, translation and collocations live with room to breathe.
 *
 * The body still holds the sentence and the subtitle still holds the
 * translation, because macOS, ChromeOS and the expanded Windows toast all show
 * them, and leaving them out would cost those platforms for no gain.
 */
export async function createReviewNotification(
  { entry, sentence, now }: CreateReviewNotificationInput,
): Promise<string> {
  const notificationId = buildNotificationId(entry, now)

  const registry = await loadNotificationRegistry()
  registry[notificationId] = { wordId: entry.wordId, issuedAt: now }
  await saveNotificationRegistry(pruneNotificationRegistry(registry, now))

  await browser.notifications.create(notificationId, {
    type: "basic",
    iconUrl: browser.runtime.getURL(REVIEW_NOTIFICATION_ICON_PATH),
    title: entry.word,
    message: sentence || i18n.t("options.review.notify.quickReview"),
    contextMessage: buildContextMessage(entry),
  }).catch(async (error) => {
    // Nothing will ever act on a payload whose notification was never shown.
    await forgetNotification(notificationId)
    throw error
  })

  logger.info(`[Review] Pushed "${entry.word}" (stage ${entry.stage})`)

  return notificationId
}

export async function clearReviewNotification(notificationId: string): Promise<void> {
  try {
    await browser.notifications.clear(notificationId)
  }
  catch (error) {
    // The notification may already be gone; nothing to recover from.
    logger.warn(`[Review] Failed to clear notification ${notificationId}:`, error)
  }
}

export async function getNotificationWordId(
  notificationId: string,
): Promise<string | undefined> {
  const registry = await loadNotificationRegistry()
  return registry[notificationId]?.wordId
}

/** Forget a payload once its notification is closed or acted on. */
export async function forgetNotification(notificationId: string): Promise<void> {
  const registry = await loadNotificationRegistry()
  if (!(notificationId in registry)) {
    return
  }
  delete registry[notificationId]
  await saveNotificationRegistry(registry)
}

/**
 * Whether notifications are currently allowed. Firefox can deny them
 * extension-wide, and the options page surfaces that state.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const level = await browser.notifications.getPermissionLevel()
    return level === "granted"
  }
  catch (error) {
    logger.warn("[Review] Failed to read notification permission level:", error)
    return false
  }
}

/** Whether a usable LLM provider is configured for example generation. */
export async function hasExampleProvider(): Promise<boolean> {
  try {
    const config = await getLocalConfig()
    if (!config) {
      return false
    }
    return getProviderConfigById(getLLMProvidersConfig(config.providersConfig), config.translate.providerId) != null
  }
  catch {
    return false
  }
}
