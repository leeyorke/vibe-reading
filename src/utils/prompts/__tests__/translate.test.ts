import { describe, expect, it } from "vitest"
import { getSelectionTranslatePrompt } from "../translate"

describe("getSelectionTranslatePrompt", () => {
  it("uses the built-in selection analysis system prompt", () => {
    const { systemPrompt } = getSelectionTranslatePrompt("declare")

    expect(systemPrompt).toContain("# Role")
    expect(systemPrompt).toContain("语法结构")
    // The built-in system prompt carries no replaceable tokens
    expect(systemPrompt).not.toContain("{{input}}")
  })

  it("injects the selected text into the user prompt", () => {
    const { prompt } = getSelectionTranslatePrompt("Hello world")

    expect(prompt).toBe("# 用户输入\n\nHello world")
  })

  it("keeps multi-line selections verbatim", () => {
    const input = "Line one.\nLine two?"
    const { prompt } = getSelectionTranslatePrompt(input)

    expect(prompt).toBe(`# 用户输入\n\n${input}`)
  })
})
