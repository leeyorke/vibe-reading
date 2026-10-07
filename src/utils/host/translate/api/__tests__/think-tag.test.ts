import { describe, expect, it } from "vitest"
import { createThinkTagFilter } from "../think-tag"

// Build the tag markers from the tag name so this file stays free of the raw
// control sequences, which the toolchain mangles when written literally.
const OPEN_TAG = `<${"think"}>`
const CLOSE_TAG = `</${"think"}>`

function streamThrough(deltas: string[]): string {
  const filter = createThinkTagFilter()
  let visible = ""
  for (const delta of deltas) {
    visible += filter.push(delta)
  }
  visible += filter.finish()
  return visible
}

describe("createThinkTagFilter", () => {
  it("passes plain output straight through", () => {
    expect(streamThrough(["## declare", "\n\nverb， 动词"])).toBe("## declare\n\nverb， 动词")
  })

  it("withholds a leading reasoning block and releases the answer behind it", () => {
    const visible = streamThrough([
      "<thin",
      "k>The user wants a word analysis...",
      "more reasoning",
      CLOSE_TAG,
      "## declare",
      "\n\nverb",
    ])

    expect(visible).toBe("## declare\n\nverb")
  })

  it("releases the answer in one piece when the closing tag shares a delta", () => {
    const filter = createThinkTagFilter()
    expect(filter.push(`${CLOSE_TAG}## declare`)).toBe("## declare")
    expect(filter.push(" verb")).toBe(" verb")
  })

  it("tolerates leading whitespace in front of the reasoning block", () => {
    expect(streamThrough(["\n\n", CLOSE_TAG, "答案"])).toBe("答案")
  })

  it("flushes an unterminated reasoning block instead of swallowing the stream", () => {
    // The non-streaming path returns the whole text when the tag never closes,
    // so the streaming one must not silently drop it.
    expect(streamThrough([`${OPEN_TAG}never closed`])).toBe(`${OPEN_TAG}never closed`)
  })

  it("decides on the first characters, so a plain stream is never held back", () => {
    const filter = createThinkTagFilter()
    expect(filter.push("中")).toBe("中")
    expect(filter.push("文")).toBe("文")
  })

  it("holds a partial opening tag until the next delta settles it", () => {
    const filter = createThinkTagFilter()
    expect(filter.push("<th")).toBe("")
    expect(filter.push(`ink>reasoning${CLOSE_TAG}answer`)).toBe("answer")
  })

  it("ignores empty deltas", () => {
    const filter = createThinkTagFilter()
    expect(filter.push("")).toBe("")
    expect(filter.push("hi")).toBe("hi")
  })
})
