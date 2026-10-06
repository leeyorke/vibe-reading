/**
 * Guess which language a page selection should be pronounced in.
 *
 * The review card knows the source language of every word it speaks, because
 * the vocabulary entry carries one. A page selection knows nothing about the
 * page it came from, so the script the text is written in is the only honest
 * signal — and it is a good one for exactly the cases that matter: an English
 * headword or sentence on a page in any language, and non-Latin selections
 * (Chinese, Japanese, Korean) that an English voice would mangle.
 *
 * The result is fed to `resolveSpeechLang`, so anything this cannot place
 * lands on its English default instead of failing.
 */

/** Kana: present in Japanese only, so it is checked before the Han range. */
const KANA = /[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/
/** Hangul syllables, jamo and compatibility jamo blocks. */
const HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/
/** CJK ideographs: Chinese text, and the kanji inside Japanese words. */
const HAN = /[\u4E00-\u9FFF\u3400-\u4DBF]/
const CYRILLIC = /[\u0400-\u04FF]/
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF]/
const THAI = /[\u0E00-\u0E7F]/

export function guessSpeechLang(text: string): string {
  if (KANA.test(text)) {
    return "ja"
  }
  if (HANGUL.test(text)) {
    return "ko"
  }
  if (HAN.test(text)) {
    return "zh"
  }
  if (CYRILLIC.test(text)) {
    return "ru"
  }
  if (ARABIC.test(text)) {
    return "ar"
  }
  if (THAI.test(text)) {
    return "th"
  }
  return "en"
}
