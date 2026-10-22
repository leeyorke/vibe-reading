import { Icon } from "@iconify/react"
import { useAtom } from "jotai"
import { useState } from "react"
import { toast } from "sonner"
import { HelpTooltip } from "@/components/help-tooltip"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Input } from "@/components/ui/base-ui/input"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { normalizeDomainRule } from "@/utils/selection-rules"
import { ConfigCard } from "../../components/config-card"

export function SelectionToolbarSettings() {
  const [selectionConfig, setSelectionConfig] = useAtom(configFieldsAtomMap.selection)
  const [draft, setDraft] = useState("")

  const rules = selectionConfig.excludedDomains

  function updateConfig(patch: Partial<typeof selectionConfig>) {
    void setSelectionConfig({ ...selectionConfig, ...patch })
  }

  function addRule() {
    // Normalize first: what the user typed may be a full URL, may carry a
    // wildcard prefix, and the stored rule has to be comparable with the
    // hostname the content script sees.
    const normalized = normalizeDomainRule(draft)
    if (!normalized) {
      toast.error(i18n.t("options.general.selection.rules.invalid"))
      return
    }

    if (rules.includes(normalized)) {
      toast.error(i18n.t("options.general.selection.rules.duplicate"))
      return
    }

    updateConfig({ excludedDomains: [...rules, normalized] })
    setDraft("")
    toast.success(i18n.t("options.general.selection.rules.added"))
  }

  function removeRule(rule: string) {
    updateConfig({ excludedDomains: rules.filter(item => item !== rule) })
  }

  return (
    <ConfigCard
      id="selection-toolbar"
      title={i18n.t("options.general.selection.title")}
      description={i18n.t("options.general.selection.description")}
    >
      <Field orientation="horizontal">
        <FieldContent className="self-center">
          <FieldLabel htmlFor="selection-toolbar-toggle">
            {i18n.t("options.general.selection.enable.title")}
            <HelpTooltip>{i18n.t("options.general.selection.enable.description")}</HelpTooltip>
          </FieldLabel>
        </FieldContent>
        <Switch
          id="selection-toolbar-toggle"
          checked={selectionConfig.enabled}
          onCheckedChange={checked => updateConfig({ enabled: checked })}
        />
      </Field>

      <Field className="mt-6 gap-3">
        <FieldLabel>
          {i18n.t("options.general.selection.rules.title")}
          <HelpTooltip>{i18n.t("options.general.selection.rules.description")}</HelpTooltip>
        </FieldLabel>

        <div className="flex w-full max-w-96 gap-2">
          <Input
            id="selection-toolbar-domain"
            className="flex-1"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="example.com"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addRule()
              }
            }}
          />
          <Button
            variant="outline"
            disabled={!draft.trim()}
            onClick={addRule}
          >
            <Icon icon="tabler:plus" />
            {i18n.t("options.general.selection.rules.add")}
          </Button>
        </div>

        {rules.length === 0
          ? (
              <p className="text-sm text-muted-foreground">
                {i18n.t("options.general.selection.rules.empty")}
              </p>
            )
          : (
              <ul className="flex flex-wrap gap-2">
                {rules.map(rule => (
                  <li key={rule}>
                    <Badge variant="outline" size="lg" className="h-7 gap-1 pr-1.5 pl-2.5">
                      {rule}
                      <button
                        type="button"
                        className="hover:bg-muted rounded-full p-0.5 text-muted-foreground transition-colors"
                        title={i18n.t("options.general.selection.rules.remove")}
                        aria-label={i18n.t("options.general.selection.rules.remove")}
                        onClick={() => removeRule(rule)}
                      >
                        <Icon icon="tabler:x" className="size-3.5" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
      </Field>
    </ConfigCard>
  )
}
