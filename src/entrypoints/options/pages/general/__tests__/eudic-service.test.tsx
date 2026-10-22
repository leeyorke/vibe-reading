// @vitest-environment jsdom
import type { EudicConfig } from "@/types/eudic"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EudicService } from "../eudic-service"

const { sendMessageMock, toastMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("@/utils/i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("sonner", () => ({
  toast: toastMock,
}))

vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}))

function config(overrides: Partial<EudicConfig> = {}): EudicConfig {
  return {
    enabled: true,
    tokenSource: "env",
    hasFallbackToken: false,
    categoryId: "0",
    categoryName: "默认生词本",
    syncNewWords: false,
    lastSyncedAt: 0,
    language: "en",
    ...overrides,
  }
}

/** Route the mocked message channel by message type. */
function route(overrides: Record<string, unknown> = {}) {
  sendMessageMock.mockImplementation((type: string) => {
    switch (type) {
      case "getEudicConfig":
        return Promise.resolve(config(overrides.config as Partial<EudicConfig>))
      case "getEudicCategories":
        return Promise.resolve({
          categories: [{ id: "0", name: "默认生词本", language: "en" }],
          tokenSource: "env",
        })
      case "updateEudicConfig":
        return Promise.resolve(config())
      case "verifyEudicToken":
        return Promise.resolve({
          ok: true,
          tokenSource: "env",
          categories: [{ id: "0", name: "默认生词本", language: "en" }],
        })
      case "syncEudicVocabulary":
        return Promise.resolve({
          skipped: "",
          imported: 3,
          updated: 1,
          skippedCount: 0,
          total: 4,
        })
      default:
        return Promise.resolve(null)
    }
  })
}

describe("eudic service settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route()
  })

  it("shows where the token comes from", async () => {
    render(<EudicService />)

    await waitFor(() => {
      expect(screen.getByText("options.general.eudic.token.env")).toBeInTheDocument()
    })
  })

  it("says so when no token is configured", async () => {
    route({ config: { tokenSource: "none" } })
    render(<EudicService />)

    await waitFor(() => {
      expect(screen.getByText("options.general.eudic.token.none")).toBeInTheDocument()
    })
  })

  it("saves a fallback token through the background", async () => {
    render(<EudicService />)

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("getEudicConfig"))

    fireEvent.change(screen.getByPlaceholderText("options.general.eudic.token.placeholder"), {
      target: { value: "NIS fallback-token" },
    })
    fireEvent.click(screen.getByText("options.general.eudic.token.save"))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("updateEudicConfig", {
        fallbackToken: "NIS fallback-token",
      })
    })
  })

  it("reports a rejected token instead of failing silently", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "getEudicConfig")
        return Promise.resolve(config())
      if (type === "getEudicCategories")
        return Promise.reject(new Error("欧路连接验证失败: token 无效或已过期"))
      return Promise.resolve(null)
    })

    render(<EudicService />)

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringContaining("token 无效或已过期"),
      )
    })
  })

  it("runs a sync and reports the counts", async () => {
    render(<EudicService />)

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("getEudicConfig"))

    fireEvent.click(screen.getByText("options.general.eudic.sync"))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("syncEudicVocabulary")
    })
    expect(toastMock.success).toHaveBeenCalledWith("options.general.eudic.synced")
  })

  it("picks the only book on the account when none was chosen yet", async () => {
    route({ config: { categoryId: "", categoryName: "" } })
    render(<EudicService />)

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("getEudicConfig"))

    fireEvent.click(screen.getByText("options.general.eudic.verify"))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("updateEudicConfig", {
        categoryId: "0",
        categoryName: "默认生词本",
      })
    })
  })
})
