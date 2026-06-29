import { Entity } from "dexie"

export default class VocabularyWordEntity extends Entity {
  id!: string
  word!: string
  translation!: string
  contextUrl?: string
  contextText?: string
  sourceLanguage?: string
  targetLanguage?: string
  star!: 1 | 2 | 3 | 4 | 5
  createdAt!: number
  lastReviewedAt?: number
  reviewCount!: number
  note?: string
}
