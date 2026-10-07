import type { LLMProviderConfig } from "@/types/config/provider"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"
import { aiTranslate, aiTranslateStream } from "../ai"

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  getModelById: vi.fn(),
  resolveModelId: vi.fn(),
  getProviderOptionsWithOverride: vi.fn(),
}))

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
}))

vi.mock("@/utils/providers/model", () => ({
  getModelById: mocks.getModelById,
}))

vi.mock("@/utils/providers/model-id", () => ({
  resolveModelId: mocks.resolveModelId,
}))

vi.mock("@/utils/providers/options", () => ({
  getProviderOptionsWithOverride: mocks.getProviderOptionsWithOverride,
}))

const providerConfig: LLMProviderConfig = {
  id: "openai-default",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  apiKey: "sk-test",
  model: { model: "gpt-5-mini", isCustomModel: false, customModel: null },
}

const promptResolver = vi.fn().mockResolvedValue({
  systemPrompt: "system",
  prompt: "prompt",
})

describe("aiTranslate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModelById.mockResolvedValue("model")
    mocks.resolveModelId.mockReturnValue("gpt-5-mini")
    mocks.getProviderOptionsWithOverride.mockReturnValue({})
  })

  it("preserves AI SDK error metadata for retry policy decisions", async () => {
    const rateLimitedError = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      isRetryable: true,
      responseHeaders: {
        "retry-after": "2",
      },
    })
    mocks.generateText.mockRejectedValue(rateLimitedError)

    const error = await aiTranslate("hello", "Chinese", providerConfig, promptResolver).catch(error => error)

    expect(error).toBe(rateLimitedError)
    expect(getRequestErrorMeta(error)).toEqual(expect.objectContaining({
      statusCode: 429,
      isRetryable: true,
      retryAfterMs: 2000,
      kind: "rate-limit",
    }))
  })

  it("preserves response body as the display message when the AI SDK message is generic", async () => {
    const responseBody = "{\"code\":404,\"message\":\"模型 Kimi-K2-Instruct-09051 无效\",\"data\":{}}"
    const invalidModelError = Object.assign(new Error("Something went wrong"), {
      statusCode: 404,
      isRetryable: false,
      responseBody,
    })
    mocks.generateText.mockRejectedValue(invalidModelError)

    const error = await aiTranslate("hello", "Chinese", providerConfig, promptResolver).catch(error => error)

    expect(error).toBe(invalidModelError)
    expect(error.message).toBe(responseBody)
    expect(getRequestErrorMeta(error)).toEqual(expect.objectContaining({
      statusCode: 404,
      isRetryable: false,
      kind: "bad-request",
    }))
  })
})

// Built from the tag name so this file never contains the raw control
// sequence, which the source pipeline mangles when written literally.
const CLOSE_TAG = `</${"think"}>`

/** Stand-in for the AI SDK's `textStream`: a one-shot async iterable. */
function textStreamOf(deltas: string[], failure?: unknown) {
  return {
    async* [Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield delta
      }
      if (failure !== undefined) {
        throw failure
      }
    },
  }
}

/** Stand-in for the AI SDK's `streamText` result: one `textStream` iterable. */
function streamTextResultOf(deltas: string[], failure?: unknown) {
  return { textStream: textStreamOf(deltas, failure) }
}

describe("aiTranslateStream", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModelById.mockResolvedValue("model")
    mocks.resolveModelId.mockReturnValue("gpt-5-mini")
    mocks.getProviderOptionsWithOverride.mockReturnValue({})
  })

  it("hands every slice to the caller and returns the whole answer", async () => {
    mocks.streamText.mockReturnValue(streamTextResultOf(["## declare", "\n\nverb", "， 动词"]))
    const deltas: string[] = []

    const translated = await aiTranslateStream(
      "declare",
      "Chinese",
      providerConfig,
      promptResolver,
      (delta) => {
        deltas.push(delta)
      },
    )

    expect(deltas).toEqual(["## declare", "\n\nverb", "， 动词"])
    expect(translated).toBe("## declare\n\nverb， 动词")
  })

  it("withholds a reasoning block and streams only the answer behind it", async () => {
    mocks.streamText.mockReturnValue(streamTextResultOf([
      "<thin",
      "k>let me think about declare",
      CLOSE_TAG,
      "## declare",
      "\n\nverb",
    ]))
    const deltas: string[] = []

    const translated = await aiTranslateStream(
      "declare",
      "Chinese",
      providerConfig,
      promptResolver,
      (delta) => {
        deltas.push(delta)
      },
    )

    expect(deltas).toEqual(["## declare", "\n\nverb"])
    expect(translated).toBe("## declare\n\nverb")
  })

  it("preserves AI SDK error metadata for retry policy decisions", async () => {
    const rateLimitedError = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      isRetryable: true,
      responseHeaders: { "retry-after": "2" },
    })
    mocks.streamText.mockReturnValue(streamTextResultOf(["半句"], rateLimitedError))
    const deltas: string[] = []

    const error = await aiTranslateStream(
      "hello",
      "Chinese",
      providerConfig,
      promptResolver,
      (delta) => {
        deltas.push(delta)
      },
    ).catch(caught => caught)

    expect(error).toBe(rateLimitedError)
    expect(getRequestErrorMeta(error)).toEqual(expect.objectContaining({
      statusCode: 429,
      isRetryable: true,
      retryAfterMs: 2000,
      kind: "rate-limit",
    }))
    // What already streamed in is not thrown away by the caller.
    expect(deltas).toEqual(["半句"])
  })
})
