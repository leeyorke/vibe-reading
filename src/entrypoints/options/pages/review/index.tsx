import type { ReviewStatus } from "@/types/review"
import { Icon } from "@iconify/react"
import { IconTrash } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { HelpTooltip } from "@/components/help-tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/base-ui/field"
import { Input } from "@/components/ui/base-ui/input"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { SRS_INTERVALS_MINUTES } from "@/utils/constants/review"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { openReviewCard } from "@/utils/navigation"
import { ConfigCard } from "../../components/config-card"
import { PageLayout } from "../../components/page-layout"

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return i18n.t("options.review.status.never")
  }
  return new Date(timestamp).toLocaleString()
}

/** Renders one Ebbinghaus rung the way the schedule stores it. */
function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 1440) {
    return `${minutes / 60}h`
  }
  return `${minutes / 1440}d`
}

function CommitInput({ id, type, value, min, max, onCommit, className }: {
  id: string
  type: string
  value: string
  min?: number
  max?: number
  onCommit: (value: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setDraft(value)
  }, [value])

  return (
    <Input
      id={id}
      type={type}
      min={min}
      max={max}
      className={className ?? "w-full max-w-40 shrink-0"}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={(e) => {
        onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function ReviewPage() {
  const [reviewConfig, setReviewConfig] = useAtom(configFieldsAtomMap.review)
  const [providersConfig] = useAtom(configFieldsAtomMap.providersConfig)
  const [translateConfig] = useAtom(configFieldsAtomMap.translate)

  const [status, setStatus] = useState<ReviewStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await sendMessage("getReviewStatus"))
    }
    catch (error) {
      console.error("Failed to load review status:", error)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus, reviewConfig.enabled])

  const hasLLMProvider = getProviderConfigById(
    getLLMProvidersConfig(providersConfig),
    translateConfig.providerId,
  ) != null

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      setStatus(await sendMessage("syncReviewQueue"))
      toast.success(i18n.t("options.review.status.syncDone"))
    }
    catch (error) {
      console.error("Failed to sync review queue:", error)
      toast.error(i18n.t("options.review.status.syncFailed"))
    }
    finally {
      setSyncing(false)
    }
  }, [])

  const handlePushNow = useCallback(async () => {
    setPushing(true)
    try {
      const outcome = await sendMessage("runReviewNow")
      await refreshStatus()

      if (outcome.pushed > 0) {
        toast.success(i18n.t("options.review.status.pushDone", [String(outcome.pushed)]))
        return
      }
      if (outcome.failed > 0) {
        toast.error(i18n.t("options.review.status.pushFailed"))
        return
      }

      // Nothing was pushed and nothing failed, so the tick was held back by a
      // gate. Each gate needs its own message — collapsing them into one
      // "nothing is due" is what turns a disabled toggle into a dead end.
      switch (outcome.stoppedBecause) {
        case "disabled":
          toast.warning(i18n.t("options.review.status.stoppedDisabled"))
          break
        case "quietHours":
          toast.info(i18n.t("options.review.status.stoppedQuietHours"))
          break
        case "dailyCap":
          toast.info(i18n.t("options.review.status.stoppedDailyCap"))
          break
        case "perWordCap":
          toast.info(i18n.t("options.review.status.stoppedPerWordCap"))
          break
        default:
          toast.info(i18n.t("options.review.status.stoppedNothingDue"))
      }
    }
    catch (error) {
      console.error("Failed to run the review tick:", error)
      toast.error(i18n.t("options.review.status.pushFailed"))
    }
    finally {
      setPushing(false)
    }
  }, [refreshStatus])

  const handleOpenCard = useCallback(async () => {
    // Deliberately unguarded: the card page renders its own "nothing to
    // review" state, and refusing to open it here would leave the one screen
    // worth inspecting unreachable exactly when it is needed most.
    await openReviewCard()
  }, [])

  const handleClear = useCallback(async () => {
    try {
      setStatus(await sendMessage("clearReviewQueue"))
      toast.success(i18n.t("options.review.status.clearDone"))
    }
    catch (error) {
      console.error("Failed to clear review queue:", error)
      toast.error(i18n.t("options.review.status.clearFailed"))
    }
    finally {
      setClearOpen(false)
    }
  }, [])

  const commitNumber = (key: "maxPerDay" | "maxPerWordPerDay", min: number, max: number) => (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      return
    }
    const clamped = Math.min(Math.max(parsed, min), max)
    if (clamped === reviewConfig[key]) {
      return
    }
    void setReviewConfig({ [key]: clamped })
  }

  return (
    <PageLayout
      title={i18n.t("options.review.title")}
      innerClassName="*:border-b [&>*:last-child]:border-b-0"
    >
      <ConfigCard
        id="review-enabled"
        title={i18n.t("options.review.enabled.title")}
        description={i18n.t("options.review.enabled.description")}
      >
        <Field orientation="horizontal">
          <FieldContent className="self-center">
            <FieldLabel htmlFor="review-enabled-toggle">
              {i18n.t("options.review.enabled.enable")}
              <HelpTooltip>{i18n.t("options.review.enabled.enableDescription")}</HelpTooltip>
            </FieldLabel>
          </FieldContent>
          <Switch
            id="review-enabled-toggle"
            checked={reviewConfig.enabled}
            onCheckedChange={checked => void setReviewConfig({ enabled: checked })}
          />
        </Field>

        {status && !status.permissionGranted && (
          <p className="flex items-start gap-2 text-sm text-orange-500">
            <Icon icon="tabler:alert-triangle" className="mt-0.5 size-4 shrink-0" />
            {i18n.t("options.review.status.permissionDenied")}
          </p>
        )}
      </ConfigCard>

      <ConfigCard
        id="review-status"
        title={i18n.t("options.review.status.title")}
        description={i18n.t("options.review.status.description")}
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-muted-foreground text-xs">{i18n.t("options.review.status.queueSize")}</dt>
            <dd className="font-medium">{status?.queueSize ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{i18n.t("options.review.status.todayCount")}</dt>
            <dd className="font-medium">{status?.todayCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{i18n.t("options.review.status.pendingCount")}</dt>
            <dd className="font-medium">{status?.pendingCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{i18n.t("options.review.status.graduated")}</dt>
            <dd className="font-medium">{status?.graduatedCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{i18n.t("options.review.status.nextDueAt")}</dt>
            <dd className="font-medium">
              {status?.nextDueAt ? formatTimestamp(status.nextDueAt) : i18n.t("options.review.status.empty")}
            </dd>
          </div>
        </dl>

        <p className="text-muted-foreground mt-3 text-xs">
          {i18n.t("options.review.status.lastSyncAt", [formatTimestamp(status?.lastSyncAt)])}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="brand" onClick={handleSync} disabled={syncing}>
            {syncing ? i18n.t("options.review.status.syncing") : i18n.t("options.review.status.sync")}
          </Button>
          <Button
            variant="outline"
            disabled={pushing || syncing}
            onClick={handlePushNow}
            title={i18n.t("options.review.status.pushNowDescription")}
          >
            <Icon icon="tabler:bell-ringing" data-icon="inline-start" />
            {pushing ? i18n.t("options.review.status.pushing") : i18n.t("options.review.status.pushNow")}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenCard}
            title={i18n.t("options.review.status.openCardDescription")}
          >
            <Icon icon="tabler:external-link" data-icon="inline-start" />
            {i18n.t("options.review.status.openCard")}
          </Button>
          <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
            <AlertDialogTrigger render={<Button variant="outline" disabled={syncing} />}>
              <IconTrash className="size-4" />
              {i18n.t("options.review.status.clear")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{i18n.t("options.review.status.clear")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {i18n.t("options.review.status.clearConfirm")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{i18n.t("options.review.status.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleClear} disabled={syncing}>
                  {i18n.t("options.review.status.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </ConfigCard>

      <ConfigCard
        id="review-cadence"
        title={i18n.t("options.review.cadence.title")}
        description={i18n.t("options.review.cadence.description")}
      >
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {SRS_INTERVALS_MINUTES.map((minutes, index) => (
            <li

              key={minutes}
              className="rounded-md border px-2 py-1 font-medium tabular-nums"
            >
              {formatInterval(minutes)}
              {index < SRS_INTERVALS_MINUTES.length - 1 && (
                <Icon icon="tabler:chevron-right" className="ml-1 inline size-3 text-muted-foreground" />
              )}
            </li>
          ))}
        </ol>
      </ConfigCard>

      <ConfigCard
        id="review-frequency"
        title={i18n.t("options.review.frequency.title")}
        description={i18n.t("options.review.frequency.description")}
      >
        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor="review-max-per-day">
              {i18n.t("options.review.frequency.maxPerDay")}
            </FieldLabel>
          </FieldContent>
          <CommitInput
            id="review-max-per-day"
            type="number"
            min={1}
            max={50}
            value={String(reviewConfig.maxPerDay)}
            onCommit={commitNumber("maxPerDay", 1, 50)}
          />
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor="review-max-per-word">
              {i18n.t("options.review.frequency.maxPerWordPerDay")}
            </FieldLabel>
          </FieldContent>
          <CommitInput
            id="review-max-per-word"
            type="number"
            min={1}
            max={10}
            value={String(reviewConfig.maxPerWordPerDay)}
            onCommit={commitNumber("maxPerWordPerDay", 1, 10)}
          />
        </Field>
      </ConfigCard>

      <ConfigCard
        id="review-quiet-hours"
        title={i18n.t("options.review.quietHours.title")}
        description={i18n.t("options.review.quietHours.description")}
      >
        <Field orientation="horizontal">
          <FieldContent className="self-center">
            <FieldLabel htmlFor="review-quiet-toggle">
              {i18n.t("options.review.quietHours.enable")}
              <HelpTooltip>{i18n.t("options.review.quietHours.enableDescription")}</HelpTooltip>
            </FieldLabel>
          </FieldContent>
          <Switch
            id="review-quiet-toggle"
            checked={reviewConfig.quietHours.enabled}
            onCheckedChange={checked => void setReviewConfig({
              quietHours: { ...reviewConfig.quietHours, enabled: checked },
            })}
          />
        </Field>

        {reviewConfig.quietHours.enabled && (
          <>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="review-quiet-start">
                  {i18n.t("options.review.quietHours.start")}
                </FieldLabel>
              </FieldContent>
              <CommitInput
                id="review-quiet-start"
                type="time"
                value={reviewConfig.quietHours.start}
                onCommit={value => void setReviewConfig({ quietHours: { ...reviewConfig.quietHours, start: value } })}
              />
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="review-quiet-end">
                  {i18n.t("options.review.quietHours.end")}
                </FieldLabel>
              </FieldContent>
              <CommitInput
                id="review-quiet-end"
                type="time"
                value={reviewConfig.quietHours.end}
                onCommit={value => void setReviewConfig({ quietHours: { ...reviewConfig.quietHours, end: value } })}
              />
            </Field>
          </>
        )}
      </ConfigCard>

      <ConfigCard
        id="review-example"
        title={i18n.t("options.review.example.title")}
        description={i18n.t("options.review.example.description")}
      >
        <Field orientation="horizontal">
          <FieldContent className="self-center">
            <FieldLabel htmlFor="review-example-toggle">
              {i18n.t("options.review.example.enable")}
              {!hasLLMProvider && (
                <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-orange-500">
                  <span className="size-2 rounded-full bg-orange-400" />
                  {i18n.t("options.review.example.noProvider")}
                </span>
              )}
            </FieldLabel>
          </FieldContent>
          <Switch
            id="review-example-toggle"
            checked={reviewConfig.generateExample}
            onCheckedChange={checked => void setReviewConfig({ generateExample: checked })}
          />
        </Field>
      </ConfigCard>
    </PageLayout>
  )
}
