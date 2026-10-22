import { describe, expect, it } from "vitest"
import { guessSpeechLang } from "../guess-speech-lang"

describe("guessSpeechLang", () => {
  it("treats plain Latin text as English, which is what a selection usually is", () => {
    expect(guessSpeechLang("ephemeral")).toBe("en")
    expect(guessSpeechLang("The quick brown fox jumps over the lazy dog.")).toBe("en")
    expect(guessSpeechLang("H₂O and 42%")).toBe("en")
  })

  it("detects Chinese", () => {
    expect(guessSpeechLang("学习")).toBe("zh")
    expect(guessSpeechLang("这句话是中英混合的 sentence")).toBe("zh")
  })

  it("prefers Japanese over Chinese when kana appear next to kanji", () => {
    expect(guessSpeechLang("日本語の勉強")).toBe("ja")
    expect(guessSpeechLang("カタカナ")).toBe("ja")
  })

  it("detects Korean hangul", () => {
    expect(guessSpeechLang("한국어")).toBe("ko")
    expect(guessSpeechLang("한국어 word")).toBe("ko")
  })

  it("detects other non-Latin scripts", () => {
    expect(guessSpeechLang("Привет")).toBe("ru")
    expect(guessSpeechLang("مرحبا")).toBe("ar")
    expect(guessSpeechLang("สวัสดี")).toBe("th")
  })

  it("falls back to English for an empty selection", () => {
    expect(guessSpeechLang("")).toBe("en")
  })
})
