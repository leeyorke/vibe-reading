import type { LangCodeISO6393 } from "@/definitions"
import type {
  BackgroundGenerateTextPayload,
  BackgroundGenerateTextResponse,
} from "@/types/background-generate-text"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import type { ProxyRequest, ProxyResponse } from "@/types/proxy-fetch"
import type { ReviewCardData, ReviewRatingKind, ReviewStatus, ReviewTickOutcome } from "@/types/review"
import type {
  AddVocabularyWordPayload,
  UpdateVocabularyWordPayload,
  VocabularyQuery,
  VocabularyWord,
  WordDefinition,
} from "@/types/vocabulary"
import { defineExtensionMessaging } from "@webext-core/messaging"

interface ProtocolMap {
  // navigation
  openOptionsPage: (data?: { route?: `/${string}` }) => void
  // translation state
  getEnablePageTranslationByTabId: (data: { tabId: number }) => boolean | undefined
  getEnablePageTranslationFromContentScript: () => Promise<boolean>
  tryToSetEnablePageTranslationByTabId: (data: { tabId: number, enabled: boolean }) => void
  setAndNotifyPageTranslationStateChangedByManager: (data: { enabled: boolean, url?: string }) => void
  notifyTranslationStateChanged: (data: { enabled: boolean }) => void
  injectCurrentIframesAfterTopFrameNodeTranslation: () => void
  reportDetectedPageLanguage: (data: { detectedCodeOrUnd: LangCodeISO6393 | "und", url: string }) => void
  refreshDetectedPageLanguage: () => void
  getDetectedCode: () => LangCodeISO6393
  detectedPageLanguageChanged: (data: { detectedCode: LangCodeISO6393 }) => void
  // ask host to start page translation
  askManagerToTogglePageTranslation: (data: { enabled: boolean }) => void
  // request
  enqueueTranslateRequest: (data: { text: string, langConfig: Config["language"], providerConfig: ProviderConfig, scheduleAt: number, hash: string, webTitle?: string | null, webDescription?: string | null, webContent?: string | null, webSummary?: string | null }) => Promise<string>
  getOrGenerateWebPageSummary: (data: { webTitle: string, webContent: string, providerConfig: ProviderConfig }) => Promise<string | null>
  backgroundGenerateText: (data: BackgroundGenerateTextPayload) => Promise<BackgroundGenerateTextResponse>
  setTranslateRequestQueueConfig: (data: Partial<RequestQueueConfig>) => void
  setTranslateBatchQueueConfig: (data: Partial<BatchQueueConfig>) => void
  // network proxy
  backgroundFetch: (data: ProxyRequest) => Promise<ProxyResponse>
  // cache management
  clearAllTranslationRelatedCache: () => Promise<void>

  // --- selection translation ---
  translateSelectedText: (data: {
    text: string
    sourceLanguageCode?: string
    targetLanguageCode?: string
  }) => Promise<string | null>
  translateSelectedTextStructured: (data: {
    text: string
  }) => Promise<WordDefinition | null>

  // --- vocabulary ---
  addVocabularyWord: (data: AddVocabularyWordPayload) => Promise<string>
  getVocabularyWords: (data: VocabularyQuery) => Promise<{ words: VocabularyWord[], total: number }>
  updateVocabularyWord: (data: UpdateVocabularyWordPayload) => Promise<void>
  deleteVocabularyWord: (data: { id: string }) => Promise<void>

  // --- flashcards ---
  getFlashcardSession: (data: { count?: number }) => Promise<VocabularyWord[]>
  markWordReviewed: (data: { wordId: string, star: 1 | 2 | 3 | 4 | 5 }) => Promise<void>

  // --- review (Ebbinghaus push) ---
  getReviewStatus: () => Promise<ReviewStatus>
  syncReviewQueue: () => Promise<ReviewStatus>
  clearReviewQueue: () => Promise<ReviewStatus>
  /** One review card; omit `wordId` to continue the session with the next word. */
  getReviewCard: (data: { wordId?: string }) => Promise<ReviewCardData | null>
  /** Record a verdict and return the next card, or `null` when the queue is drained. */
  rateReviewWord: (data: { wordId: string, kind: ReviewRatingKind }) => Promise<ReviewCardData | null>
  /** Fetch pronunciation audio for the card; resolves to a playable `data:` URL. */
  synthesizeSpeech: (data: { text: string, sourceLanguage?: string }) => Promise<string>
  /**
   * Fetch pronunciation audio as base64 for Web Audio playback.
   * `runtime.sendMessage` serialises messages as JSON, so this cannot be an
   * ArrayBuffer — see `synthesizeSpeechAudio` in `utils/review/speech.ts`.
   * Used by the selection toolbar: a content script cannot play a `data:`/
   * `blob:` URL without the page's CSP getting a say in it.
   */
  synthesizeSpeechAudio: (data: { text: string, sourceLanguage?: string }) => Promise<string>
  /** Run the scheduler pass immediately instead of waiting for its alarm. */
  runReviewNow: () => Promise<ReviewTickOutcome>
}

export const { sendMessage, onMessage }
  = defineExtensionMessaging<ProtocolMap>()
