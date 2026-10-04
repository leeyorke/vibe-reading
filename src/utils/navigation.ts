import { browser } from "#imports"
import { REVIEW_CARD_PATH, REVIEW_CARD_WORD_PARAM } from "@/utils/constants/review"
import { logger } from "@/utils/logger"

export interface OpenOptionsPageOptions {
  route?: `/${string}`
}

export async function openOptionsPage(options?: OpenOptionsPageOptions) {
  const route = options?.route ?? ""

  await browser.tabs.create({
    active: true,
    url: browser.runtime.getURL(`/options.html${route ? `#${route}` : ""}`),
  })
}

function buildReviewCardUrl(wordId?: string): string {
  const base = browser.runtime.getURL(REVIEW_CARD_PATH)
  return wordId
    ? `${base}?${REVIEW_CARD_WORD_PARAM}=${encodeURIComponent(wordId)}`
    : base
}

/**
 * Show the review card for `wordId`, reusing the card tab if one is open.
 *
 * A day can hold a dozen pushes; opening a fresh tab for each would bury the
 * browser. Instead the existing card tab is navigated to the new word and its
 * window focused — one card per tab, so the last notification the user clicked
 * wins. Navigating rather than messaging keeps the tab the single source of
 * truth for which word it is showing, with no listener to leak.
 *
 * `wordId` is optional. With none, the card picks the oldest word still waiting
 * for a rating and falls back to its own "nothing to review" state — which is
 * exactly what someone opening it by hand wants to see, and what a guard on the
 * caller's side would instead hide.
 */
export async function openReviewCard(wordId?: string): Promise<void> {
  const url = buildReviewCardUrl(wordId)

  try {
    const [existing] = await browser.tabs.query({
      url: `${browser.runtime.getURL(REVIEW_CARD_PATH)}*`,
    })

    if (existing?.id != null) {
      await browser.tabs.update(existing.id, { active: true, url })
      if (existing.windowId != null) {
        await browser.windows.update(existing.windowId, { focused: true })
      }
      logger.info(`[ReviewCard] Focused the existing card tab for "${wordId ?? "next pending"}"`)
      return
    }

    await browser.tabs.create({ active: true, url })
    logger.info(`[ReviewCard] Opened a new card tab for "${wordId ?? "next pending"}"`)
  }
  catch (error) {
    logger.error(`[ReviewCard] Failed to open the card for "${wordId ?? "next pending"}":`, error)
  }
}
