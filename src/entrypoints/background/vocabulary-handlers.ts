import type {
  AddVocabularyWordPayload,
  UpdateVocabularyWordPayload,
  VocabularyQuery,
  VocabularyWord,
} from "@/types/vocabulary"
import { db } from "@/utils/db/dexie/db"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"

/**
 * Add a new vocabulary word.
 * Deduplicates by same word + same contextUrl.
 * Returns the word's id.
 */
async function handleAddWord(data: AddVocabularyWordPayload): Promise<string> {
  // Dedup: same word + same URL = update existing entry
  if (data.contextUrl) {
    const existing = await db.vocabularyWords
      .where("word")
      .equals(data.word)
      .toArray()

    const sameUrlWord = existing.find(w => w.contextUrl === data.contextUrl)
    if (sameUrlWord) {
      // Update translation and context
      await db.vocabularyWords.update(sameUrlWord.id, {
        translation: data.translation,
        contextText: data.contextText ?? sameUrlWord.contextText,
        sourceLanguage: data.sourceLanguage ?? sameUrlWord.sourceLanguage,
        targetLanguage: data.targetLanguage ?? sameUrlWord.targetLanguage,
      })
      logger.info("[Vocabulary] Updated existing word:", sameUrlWord.word)
      return sameUrlWord.id
    }
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  const word: VocabularyWord = {
    id,
    word: data.word,
    translation: data.translation,
    contextUrl: data.contextUrl,
    contextText: data.contextText,
    sourceLanguage: data.sourceLanguage,
    targetLanguage: data.targetLanguage,
    star: 1, // default: 1 star
    createdAt: now,
    reviewCount: 0,
  }

  await db.vocabularyWords.add(word as any)
  logger.info("[Vocabulary] Added word:", word.word)
  return id
}

/**
 * List vocabulary words with pagination, sorting, and search.
 */
async function handleGetWords(data: VocabularyQuery): Promise<{ words: VocabularyWord[], total: number }> {
  const {
    limit = 50,
    offset = 0,
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
  } = data

  let collection = db.vocabularyWords.orderBy(sortBy)

  // For descending order, reverse the collection
  if (sortOrder === "desc") {
    collection = (collection as any).reverse()
  }

  let total: number
  let words: VocabularyWord[]

  if (search) {
    // For search, we filter after fetching (Dexie doesn't support full-text search natively)
    const allWords = await collection.toArray()
    const lowerSearch = search.toLowerCase()
    const filtered = allWords.filter(
      w => w.word.toLowerCase().includes(lowerSearch)
        || w.translation.toLowerCase().includes(lowerSearch),
    )
    total = filtered.length
    words = filtered.slice(offset, offset + limit)
  }
  else {
    total = await collection.count()
    words = await (collection as any).offset(offset).limit(limit).toArray()
  }

  return { words, total }
}

/**
 * Update a vocabulary word's star rating, translation, or note.
 */
async function handleUpdateWord(data: UpdateVocabularyWordPayload): Promise<void> {
  const { id, updates } = data
  const count = await db.vocabularyWords.update(id, updates as any)
  if (count === 0) {
    logger.warn("[Vocabulary] Word not found for update:", id)
  }
  else {
    logger.info("[Vocabulary] Updated word:", id)
  }
}

/**
 * Delete a vocabulary word by id.
 */
async function handleDeleteWord(data: { id: string }): Promise<void> {
  await db.vocabularyWords.delete(data.id)
  logger.info("[Vocabulary] Deleted word:", data.id)
}

/**
 * Get a flashcard session: random selection of words,
 * biased toward lower-star-rated (harder) words.
 */
async function handleGetFlashcardSession(data: { count?: number }): Promise<VocabularyWord[]> {
  const count = data.count ?? 10

  const allWords = await db.vocabularyWords.toArray()
  if (allWords.length === 0) {
    return []
  }

  // Weighted selection: lower star = higher priority
  // star=1 weight 5, star=2 weight 4, ..., star=5 weight 1
  const weighted: { word: VocabularyWord, weight: number }[] = allWords.map((w) => {
    const weight = 6 - w.star // 5, 4, 3, 2, 1
    return { word: w, weight: Math.max(1, weight) }
  })

  // Shuffle with weights (Fisher-Yates with weighted bias)
  const pool = [...weighted]
  const selected: VocabularyWord[] = []

  while (selected.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0)
    let random = Math.random() * totalWeight

    for (let i = 0; i < pool.length; i++) {
      random -= pool[i].weight
      if (random <= 0) {
        selected.push(pool[i].word)
        pool.splice(i, 1)
        break
      }
    }
  }

  return selected
}

/**
 * Mark a word as reviewed with a new star rating.
 */
async function handleMarkWordReviewed(data: { wordId: string, star: 1 | 2 | 3 | 4 | 5 }): Promise<void> {
  const { wordId, star } = data
  const now = Date.now()

  const count = await db.vocabularyWords.update(wordId, {
    star,
    lastReviewedAt: now,
    reviewCount: undefined as any, // We'll use a different approach
  } as any)

  if (count > 0) {
    // Increment reviewCount atomically
    const word = await db.vocabularyWords.get(wordId)
    if (word) {
      await db.vocabularyWords.update(wordId, {
        reviewCount: (word.reviewCount ?? 0) + 1,
      } as any)
    }
  }
}

export function setupVocabularyMessageHandlers() {
  onMessage("addVocabularyWord", async (message) => {
    return await handleAddWord(message.data)
  })

  onMessage("getVocabularyWords", async (message) => {
    return await handleGetWords(message.data)
  })

  onMessage("updateVocabularyWord", async (message) => {
    await handleUpdateWord(message.data)
  })

  onMessage("deleteVocabularyWord", async (message) => {
    await handleDeleteWord(message.data)
  })

  onMessage("getFlashcardSession", async (message) => {
    return await handleGetFlashcardSession(message.data)
  })

  onMessage("markWordReviewed", async (message) => {
    await handleMarkWordReviewed(message.data)
  })
}
