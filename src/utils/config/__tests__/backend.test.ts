import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getBackendBaseUrl } from "../backend"

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: vi.fn(),
}))

const mockGetLocalConfig = vi.mocked(getLocalConfig)

describe("getBackendBaseUrl", () => {
  beforeEach(() => {
    mockGetLocalConfig.mockReset()
  })

  it("returns the configured base URL", async () => {
    mockGetLocalConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      backend: { baseUrl: "http://example.com:9000" },
    } as Config)

    expect(await getBackendBaseUrl()).toBe("http://example.com:9000")
  })

  it("strips trailing slashes", async () => {
    mockGetLocalConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      backend: { baseUrl: "http://example.com:9000///" },
    } as Config)

    expect(await getBackendBaseUrl()).toBe("http://example.com:9000")
  })

  it("falls back to the default when config is missing", async () => {
    mockGetLocalConfig.mockResolvedValueOnce(null)

    expect(await getBackendBaseUrl()).toBe(DEFAULT_CONFIG.backend.baseUrl)
  })

  it("falls back to the default when the configured URL is empty", async () => {
    mockGetLocalConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      backend: { baseUrl: "   " },
    } as Config)

    expect(await getBackendBaseUrl()).toBe(DEFAULT_CONFIG.backend.baseUrl)
  })
})
