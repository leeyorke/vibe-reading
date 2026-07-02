import type { VocabularyWord } from "@/types/vocabulary"
import { db } from "@/utils/db/dexie/db"
import { logger } from "@/utils/logger"

/**
 * Export all vocabulary words from IndexedDB as a JSON string.
 * Intended for one-time migration to the backend SQLite database.
 */
export async function exportVocabularyToJSON(): Promise<string> {
  const words = await db.vocabularyWords.toArray()
  logger.info(`[Vocabulary] Exported ${words.length} words from IndexedDB`)
  return JSON.stringify(words, null, 2)
}

/**
 * Parse a vocabulary JSON export and return the words.
 * Useful for validating export files before import.
 */
export function parseVocabularyJSON(jsonString: string): VocabularyWord[] {
  return JSON.parse(jsonString) as VocabularyWord[]
}

/**
 * Import vocabulary words from a JSON string into the backend API.
 * Used after exporting from IndexedDB to seed the SQLite database.
 */
export async function importVocabularyFromJSON(
  jsonString: string,
  addWordFn: (data: { word: string, translation: string, contextUrl?: string, contextText?: string, sourceLanguage?: string, targetLanguage?: string }) => Promise<string>,
): Promise<{ imported: number, skipped: number, errors: string[] }> {
  const words = parseVocabularyJSON(jsonString)
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const word of words) {
    try {
      await addWordFn({
        word: word.word,
        translation: word.translation,
        contextUrl: word.contextUrl,
        contextText: word.contextText,
        sourceLanguage: word.sourceLanguage,
        targetLanguage: word.targetLanguage,
      })
      imported++
    }
    catch (error) {
      skipped++
      errors.push(`"${word.word}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  logger.info(`[Vocabulary] Import complete: ${imported} imported, ${skipped} skipped`)
  return { imported, skipped, errors }
}
