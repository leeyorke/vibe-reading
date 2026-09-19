import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Input } from "@/components/ui/base-ui/input"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { DEFAULT_BACKEND_BASE_URL } from "@/utils/constants/backend"
import { i18n } from "@/utils/i18n"
import { ConfigCard } from "../../components/config-card"

export function BackendService() {
  const [backendConfig, setBackendConfig] = useAtom(configFieldsAtomMap.backend)
  const [inputValue, setInputValue] = useState(backendConfig.baseUrl)

  // Keep the input in sync when the config changes from elsewhere
  // (e.g. imported config, or updated in another context).
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setInputValue(backendConfig.baseUrl)
  }, [backendConfig.baseUrl])

  function commit(value: string) {
    const trimmed = value.trim()

    if (trimmed === backendConfig.baseUrl) {
      return
    }

    // Empty input falls back to the default address.
    if (!trimmed) {
      void setBackendConfig({ baseUrl: DEFAULT_BACKEND_BASE_URL })
      toast.success(i18n.t("options.general.backend.reset"))
      return
    }

    try {
      // eslint-disable-next-line no-new
      new URL(trimmed)
    }
    catch {
      setInputValue(backendConfig.baseUrl)
      toast.error(i18n.t("options.general.backend.error"))
      return
    }

    void setBackendConfig({ baseUrl: trimmed })
    toast.success(i18n.t("options.general.backend.saved"))
  }

  return (
    <ConfigCard
      id="backend-service"
      title={i18n.t("options.general.backend.title")}
      description={i18n.t("options.general.backend.description")}
    >
      <Field orientation="responsive">
        <FieldContent>
          <FieldLabel htmlFor="backend-base-url">
            {i18n.t("options.general.backend.baseUrl.title")}
          </FieldLabel>
        </FieldContent>
        <Input
          id="backend-base-url"
          className="w-full max-w-96 shrink-0"
          type="url"
          spellCheck={false}
          autoComplete="off"
          placeholder={DEFAULT_BACKEND_BASE_URL}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur()
            }
          }}
        />
      </Field>
    </ConfigCard>
  )
}
