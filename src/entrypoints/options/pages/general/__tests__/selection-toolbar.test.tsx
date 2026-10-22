// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { getDefaultStore } from "jotai"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SelectionToolbarSettings } from "../selection-toolbar"

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("@/utils/atoms/config", async () => {
  const { atom } = await import("jotai")
  return {
    configFieldsAtomMap: {
      selection: atom({ enabled: true, excludedDomains: [] as string[] }),
    },
  }
})

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

vi.mock("@/components/help-tooltip", () => ({
  HelpTooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

function selectionConfig() {
  return getDefaultStore().get(configFieldsAtomMap.selection)
}

describe("selection toolbar settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void getDefaultStore().set(configFieldsAtomMap.selection, { enabled: true, excludedDomains: [] })
  })

  it("normalizes the domain the user typed before storing it", () => {
    render(<SelectionToolbarSettings />)

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "https://WWW.Example.com/some/path" },
    })
    fireEvent.click(screen.getByText("options.general.selection.rules.add"))

    expect(selectionConfig().excludedDomains).toEqual(["www.example.com"])
  })

  it("rejects a rule without a domain", () => {
    render(<SelectionToolbarSettings />)

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "*" },
    })
    fireEvent.click(screen.getByText("options.general.selection.rules.add"))

    expect(selectionConfig().excludedDomains).toEqual([])
    expect(toastMock.error).toHaveBeenCalled()
  })

  it("rejects a duplicate rule", () => {
    render(<SelectionToolbarSettings />)

    const input = screen.getByPlaceholderText("example.com")
    fireEvent.change(input, { target: { value: "example.com" } })
    fireEvent.click(screen.getByText("options.general.selection.rules.add"))
    fireEvent.change(input, { target: { value: "*.example.com" } })
    fireEvent.click(screen.getByText("options.general.selection.rules.add"))

    expect(selectionConfig().excludedDomains).toEqual(["example.com"])
    expect(toastMock.error).toHaveBeenCalled()
  })

  it("removes a rule", () => {
    render(<SelectionToolbarSettings />)

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "example.com" },
    })
    fireEvent.click(screen.getByText("options.general.selection.rules.add"))

    expect(selectionConfig().excludedDomains).toEqual(["example.com"])

    fireEvent.click(screen.getByTitle("options.general.selection.rules.remove"))

    expect(selectionConfig().excludedDomains).toEqual([])
  })
})
