import { describe, expect, it } from "vitest"

import { resolveIso6391 } from "@/utils/iso-639"

describe("resolveIso6391", () => {
  it("maps the three-letter codes the config stores", () => {
    expect(resolveIso6391("eng", "auto")).toBe("en")
    expect(resolveIso6391("cmn", "auto")).toBe("zh")
    expect(resolveIso6391("jpn", "auto")).toBe("ja")
    expect(resolveIso6391("kor", "auto")).toBe("ko")
  })

  it("keeps the Chinese variants apart", () => {
    expect(resolveIso6391("cmn-Hant", "auto")).toBe("zh-TW")
  })

  it("falls back per role: a source it cannot place becomes auto, a target becomes Chinese", () => {
    expect(resolveIso6391("qqq", "auto")).toBe("auto")
    expect(resolveIso6391("qqq", "zh-CN")).toBe("zh-CN")
  })

  it("treats a missing code as the fallback", () => {
    expect(resolveIso6391(undefined, "auto")).toBe("auto")
    expect(resolveIso6391("", "zh-CN")).toBe("zh-CN")
  })
})
