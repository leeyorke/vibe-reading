// @vitest-environment jsdom
import type { ContentScriptContext } from "#imports"
import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const { state } = vi.hoisted(() => ({
  state: {
    mountCalls: 0,
    unmountCalls: 0,
    watchCallback: null as ((value: unknown) => void) | null,
    config: null as Config | null,
  },
}))

vi.mock("@/entrypoints/host.content/selection-toolbar/mount-selection-toolbar", () => ({
  mountSelectionToolbar: () => {
    state.mountCalls += 1
    return () => {
      state.unmountCalls += 1
    }
  },
}))

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: async () => state.config,
}))

vi.mock("@/utils/i18n", () => ({
  loadUiLocaleMessages: async () => {},
}))

vi.mock("@/utils/atoms/storage-adapter", () => ({
  storageAdapter: {
    watch: (_key: string, callback: (value: unknown) => void) => {
      state.watchCallback = callback
      return () => {
        state.watchCallback = null
      }
    },
  },
}))

const { default: contentScript } = await import("../index")

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: new URL(`https://${hostname}/some/path`),
    writable: true,
    configurable: true,
  })
}

function createContext() {
  return { onInvalidated: vi.fn() } as unknown as ContentScriptContext
}

function configWithSelection(selection: Config["selection"]): Config {
  return { ...DEFAULT_CONFIG, selection }
}

describe("selection content script rules", () => {
  beforeEach(() => {
    state.mountCalls = 0
    state.unmountCalls = 0
    state.watchCallback = null
    state.config = configWithSelection({ enabled: true, excludedDomains: [] })
  })

  it("mounts the toolbar when no rule excludes the site", async () => {
    setHostname("example.com")

    await contentScript.main(createContext())

    expect(state.mountCalls).toBe(1)
    expect(state.unmountCalls).toBe(0)
  })

  it("does not mount the toolbar on an excluded site", async () => {
    setHostname("www.example.com")
    state.config = configWithSelection({ enabled: true, excludedDomains: ["example.com"] })

    await contentScript.main(createContext())

    expect(state.mountCalls).toBe(0)
    expect(state.unmountCalls).toBe(0)
  })

  it("does not mount the toolbar when the toolbar is disabled", async () => {
    setHostname("example.com")
    state.config = configWithSelection({ enabled: false, excludedDomains: [] })

    await contentScript.main(createContext())

    expect(state.mountCalls).toBe(0)
  })

  it("hides the toolbar when a rule appears while the page is open", async () => {
    setHostname("example.com")

    await contentScript.main(createContext())
    expect(state.mountCalls).toBe(1)

    state.watchCallback?.(configWithSelection({ enabled: true, excludedDomains: ["example.com"] }))

    expect(state.unmountCalls).toBe(1)
  })

  it("brings the toolbar back when the rule is removed while the page is open", async () => {
    setHostname("example.com")
    state.config = configWithSelection({ enabled: true, excludedDomains: ["example.com"] })

    await contentScript.main(createContext())
    expect(state.mountCalls).toBe(0)

    state.watchCallback?.(configWithSelection({ enabled: true, excludedDomains: [] }))

    expect(state.mountCalls).toBe(1)
  })

  it("mounts the toolbar only once while it stays allowed", async () => {
    setHostname("example.com")

    await contentScript.main(createContext())
    state.watchCallback?.(configWithSelection({ enabled: true, excludedDomains: ["other.org"] }))

    expect(state.mountCalls).toBe(1)
    expect(state.unmountCalls).toBe(0)
  })
})
