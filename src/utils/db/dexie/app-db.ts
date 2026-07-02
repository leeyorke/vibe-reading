import type { EntityTable } from "dexie"
import { upperCamelCase } from "case-anything"
import Dexie from "dexie"
import { APP_NAME } from "@/utils/constants/app"
import ArticleSummaryCache from "./tables/article-summary-cache"
import TranslationCache from "./tables/translation-cache"
import VocabularyWordEntity from "./tables/vocabulary-word"

export default class AppDB extends Dexie {
  translationCache!: EntityTable<
    TranslationCache,
    "key"
  >

  articleSummaryCache!: EntityTable<
    ArticleSummaryCache,
    "key"
  >

  vocabularyWords!: EntityTable<
    VocabularyWordEntity,
    "id"
  >

  constructor() {
    super(`${upperCamelCase(APP_NAME)}DB`)
    this.version(6).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
      articleSummaryCache: `
        key,
        createdAt`,
      vocabularyWords: `
        id,
        word,
        star,
        createdAt,
        lastReviewedAt,
        reviewCount`,
      batchRequestRecord: null,
      aiSegmentationCache: null,
    })
    this.version(7).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
      articleSummaryCache: `
        key,
        createdAt`,
      vocabularyWords: `
        id,
        word,
        star,
        createdAt,
        lastReviewedAt,
        reviewCount`,
    }).upgrade((tx) => {
      // Clear vocabulary data after migration to backend API
      return tx.table("vocabularyWords").clear()
    })
    this.translationCache.mapToClass(TranslationCache)
    this.articleSummaryCache.mapToClass(ArticleSummaryCache)
    this.vocabularyWords.mapToClass(VocabularyWordEntity)
  }
}
