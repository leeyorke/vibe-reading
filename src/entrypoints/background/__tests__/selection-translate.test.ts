import { beforeEach, describe, expect, it, vi } from "vitest"

const onMessageMock = vi.fn()
const queryWordDefinitionStructuredMock = vi.fn()
const getLocalConfigMock = vi.fn()
const resolveProviderConfigOrNullMock = vi.fn()
const executeTranslateMock = vi.fn()
const getSelectionTranslatePromptMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
}))

vi.mock("@/utils/dict/dict-api", () => ({
  queryWordDefinitionStructured: (...args: unknown[]) => queryWordDefinitionStructuredMock(...args),
}))

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: (...args: unknown[]) => getLocalConfigMock(...args),
}))

vi.mock("@/utils/constants/feature-providers", () => ({
  resolveProviderConfigOrNull: (...args: unknown[]) => resolveProviderConfigOrNullMock(...args),
}))

vi.mock("@/utils/host/translate/execute-translate", () => ({
  executeTranslate: (...args: unknown[]) => executeTranslateMock(...args),
}))

vi.mock("@/utils/prompts/translate", () => ({
  getSelectionTranslatePrompt: (...args: unknown[]) => getSelectionTranslatePromptMock(...args),
}))

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { setupSelectionTranslateHandler } = await import("../selection-translate")

type Handler = (message: { data: Record<string, unknown> }) => Promise<unknown>

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  onMessageMock.mockImplementation((name: string, handler: Handler) => {
    handlers.set(name, handler)
  })
  setupSelectionTranslateHandler()
  return handlers
}

const DEFINITION = {
  headword: "serendipity",
  phoneticUK: "/ˌserənˈdɪpəti/",
  phoneticUS: "/ˌserənˈdɪpəti/",
  pos: "n.",
  senses: [{ number: "1", chineseDefinition: "机缘巧合" }],
}

describe("selection translate handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("answers the structured lookup with the dictionary definition", async () => {
    queryWordDefinitionStructuredMock.mockResolvedValue(DEFINITION)
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedTextStructured")!({ data: { text: "serendipity" } })).resolves.toEqual(DEFINITION)
    expect(queryWordDefinitionStructuredMock).toHaveBeenCalledWith("serendipity")
  })

  // A dictionary payload that the mapping cannot read used to throw
  // "Cannot read properties of undefined (reading 'length')" straight into the
  // toolbar, which then reported it as a dead extension context. An unusable
  // entry is a miss, and a miss is what the toolbar already knows how to route
  // around: it falls back to the AI translation.
  it("answers a miss when the dictionary lookup explodes", async () => {
    queryWordDefinitionStructuredMock.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'length')"),
    )
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedTextStructured")!({ data: { text: "serendipity" } })).resolves.toBeNull()
  })

  it("falls back to the AI translation when the dictionary has no entry", async () => {
    queryWordDefinitionStructuredMock.mockResolvedValue(null)
    getLocalConfigMock.mockResolvedValue({ language: { sourceCode: "eng", targetCode: "cmn", level: "intermediate" } })
    resolveProviderConfigOrNullMock.mockReturnValue({ id: "provider-id", provider: "openai-compatible" })
    getSelectionTranslatePromptMock.mockReturnValue("prompt")
    executeTranslateMock.mockResolvedValue("n. 机缘巧合")
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedText")!({ data: { text: "serendipity" } })).resolves.toBe("n. 机缘巧合")
    expect(executeTranslateMock).toHaveBeenCalledTimes(1)
  })

  it("answers null rather than throwing when no provider is configured", async () => {
    queryWordDefinitionStructuredMock.mockResolvedValue(null)
    getLocalConfigMock.mockResolvedValue({ language: { sourceCode: "eng", targetCode: "cmn", level: "intermediate" } })
    resolveProviderConfigOrNullMock.mockReturnValue(null)
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedText")!({ data: { text: "serendipity" } })).resolves.toBeNull()
    expect(executeTranslateMock).not.toHaveBeenCalled()
  })

  it("answers null when the provider call fails", async () => {
    queryWordDefinitionStructuredMock.mockResolvedValue(null)
    getLocalConfigMock.mockResolvedValue({ language: { sourceCode: "eng", targetCode: "cmn", level: "intermediate" } })
    resolveProviderConfigOrNullMock.mockReturnValue({ id: "provider-id", provider: "openai-compatible" })
    executeTranslateMock.mockRejectedValue(new Error("401 Unauthorized"))
    const handlers = captureHandlers()

    await expect(handlers.get("translateSelectedText")!({ data: { text: "serendipity" } })).resolves.toBeNull()
  })
})
