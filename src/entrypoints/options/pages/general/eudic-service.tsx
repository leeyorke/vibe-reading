import type { EudicCategory, EudicConfig } from "@/types/eudic"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Input } from "@/components/ui/base-ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { Switch } from "@/components/ui/base-ui/switch"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { errorMessage } from "@/utils/message-retry"
import { ConfigCard } from "../../components/config-card"

/** How the token currently reaches the backend */
function tokenSourceLabel(source: EudicConfig["tokenSource"]): string {
  if (source === "env")
    return i18n.t("options.general.eudic.token.env")
  if (source === "settings")
    return i18n.t("options.general.eudic.token.settings")
  return i18n.t("options.general.eudic.token.none")
}

function formatTime(timestamp: number): string {
  if (!timestamp)
    return i18n.t("options.general.eudic.never")
  return new Date(timestamp).toLocaleString()
}

/**
 * Settings for the Eudic (欧路) vocabulary book.
 *
 * The NIS token lives in the companion backend, not in the browser: the
 * backend reads it from the `EUDIT_API_KEY` environment variable and calls
 * `api.frdic.com` itself. The field here is only a fallback for when that
 * environment variable does not reach the backend process.
 */
export function EudicService() {
  const [config, setConfig] = useState<EudicConfig | null>(null)
  const [categories, setCategories] = useState<EudicCategory[]>([])
  const [tokenDraft, setTokenDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const loadConfig = useCallback(async () => {
    try {
      const result = await sendMessage("getEudicConfig")
      setConfig(result)
    }
    catch (error) {
      toast.error(`${i18n.t("options.general.eudic.configFailed")}: ${errorMessage(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const result = await sendMessage("getEudicCategories")
      setCategories(result.categories)
      return result.categories
    }
    catch (error) {
      toast.error(`${i18n.t("options.general.eudic.categoriesFailed")}: ${errorMessage(error)}`)
      return []
    }
  }, [])

  useEffect(() => {
    void loadConfig().then(() => loadCategories())
  }, [loadCategories, loadConfig])

  const update = useCallback(async (patch: Parameters<typeof sendMessage<"updateEudicConfig">>[1]) => {
    try {
      const result = await sendMessage("updateEudicConfig", patch)
      setConfig(result)
      return result
    }
    catch (error) {
      toast.error(`${i18n.t("options.general.eudic.saveFailed")}: ${errorMessage(error)}`)
      return null
    }
  }, [])

  async function handleVerify() {
    setVerifying(true)
    try {
      const result = await sendMessage("verifyEudicToken")
      setCategories(result.categories)
      toast.success(i18n.t("options.general.eudic.verified"))

      // The account has a single book: pick it so the user does not have to.
      const first = result.categories[0]
      if (first && (!config?.categoryId || config.categoryId !== first.id)) {
        await update({ categoryId: first.id, categoryName: first.name })
      }
    }
    catch (error) {
      toast.error(`${i18n.t("options.general.eudic.verifyFailed")}: ${errorMessage(error)}`)
    }
    finally {
      setVerifying(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await sendMessage("syncEudicVocabulary")
      if (result.skipped) {
        toast.warning(result.skipped)
        return
      }
      toast.success(
        i18n.t("options.general.eudic.synced", [
          String(result.imported),
          String(result.updated),
          String(result.total),
        ]),
      )
      await loadConfig()
    }
    catch (error) {
      toast.error(`${i18n.t("options.general.eudic.syncFailed")}: ${errorMessage(error)}`)
    }
    finally {
      setSyncing(false)
    }
  }

  async function handleSaveToken() {
    const token = tokenDraft.trim()
    if (!token)
      return
    await update({ fallbackToken: token })
    setTokenDraft("")
    toast.success(i18n.t("options.general.eudic.tokenSaved"))
  }

  return (
    <ConfigCard
      id="eudic-service"
      title={i18n.t("options.general.eudic.title")}
      description={i18n.t("options.general.eudic.description")}
    >
      {loading
        ? (
            <p className="text-sm text-muted-foreground">
              {i18n.t("options.general.eudic.loading")}
            </p>
          )
        : (
            <>
              <Field orientation="horizontal">
                <FieldContent className="self-center">
                  <FieldLabel htmlFor="eudic-enabled">
                    {i18n.t("options.general.eudic.enable.title")}
                  </FieldLabel>
                </FieldContent>
                <Switch
                  id="eudic-enabled"
                  checked={config?.enabled ?? false}
                  onCheckedChange={checked => void update({ enabled: checked })}
                />
              </Field>

              <Field className="mt-6 gap-2">
                <FieldLabel>{i18n.t("options.general.eudic.token.title")}</FieldLabel>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="lg">
                    {tokenSourceLabel(config?.tokenSource ?? "none")}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {i18n.t("options.general.eudic.token.hint")}
                  </span>
                </div>

                <div className="mt-2 flex w-full max-w-96 gap-2">
                  <Input
                    id="eudic-token"
                    className="flex-1"
                    type="password"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={i18n.t("options.general.eudic.token.placeholder")}
                    value={tokenDraft}
                    onChange={e => setTokenDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleSaveToken()
                      }
                    }}
                  />
                  <Button variant="outline" disabled={!tokenDraft.trim()} onClick={() => void handleSaveToken()}>
                    {i18n.t("options.general.eudic.token.save")}
                  </Button>
                </div>
              </Field>

              <Field className="mt-6 gap-2">
                <FieldLabel htmlFor="eudic-category">
                  {i18n.t("options.general.eudic.category.title")}
                </FieldLabel>
                <Select
                  value={config?.categoryId || undefined}
                  onValueChange={async (value) => {
                    if (!value)
                      return
                    const picked = categories.find(item => item.id === value)
                    await update({ categoryId: value, categoryName: picked?.name ?? "" })
                  }}
                >
                  <SelectTrigger id="eudic-category" className="w-full max-w-96">
                    <SelectValue>
                      {config?.categoryName
                        || (categories.length > 0 ? categories[0].name : i18n.t("options.general.eudic.category.empty"))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  {i18n.t("options.general.eudic.language.readonly", [config?.language ?? "en"])}
                </p>
              </Field>

              <Field orientation="horizontal" className="mt-6">
                <FieldContent className="self-center">
                  <FieldLabel htmlFor="eudic-sync-new">
                    {i18n.t("options.general.eudic.syncNewWords.title")}
                  </FieldLabel>
                  <p className="text-sm text-muted-foreground">
                    {i18n.t("options.general.eudic.syncNewWords.description")}
                  </p>
                </FieldContent>
                <Switch
                  id="eudic-sync-new"
                  checked={config?.syncNewWords ?? false}
                  onCheckedChange={checked => void update({ syncNewWords: checked })}
                />
              </Field>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={verifying} onClick={() => void handleVerify()}>
                  <Icon icon="tabler:link" />
                  {i18n.t("options.general.eudic.verify")}
                </Button>
                <Button
                  variant="brand"
                  disabled={syncing || !config?.enabled}
                  onClick={() => void handleSync()}
                >
                  <Icon icon={syncing ? "tabler:loader-2" : "tabler:refresh"} className={syncing ? "animate-spin" : ""} />
                  {syncing ? i18n.t("options.general.eudic.syncing") : i18n.t("options.general.eudic.sync")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {i18n.t("options.general.eudic.lastSync", [formatTime(config?.lastSyncedAt ?? 0)])}
                </span>
              </div>
            </>
          )}
    </ConfigCard>
  )
}
