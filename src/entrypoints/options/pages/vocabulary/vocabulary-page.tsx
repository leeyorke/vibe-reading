import type { VocabularyQuery, VocabularySourceCounts, VocabularyWord } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"
import { EntityListRail } from "../../components/entity-list-rail"
import { PageLayout } from "../../components/page-layout"
import { StarRating } from "./star-rating"
import { VocabularyDetail } from "./vocabulary-detail"

/** Which book a word comes from */
type SourceFilter = "all" | "local" | "eudic"

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "全部",
  local: "本地",
  eudic: "欧路",
}

const SOURCE_FILTERS: SourceFilter[] = ["all", "local", "eudic"]

const EMPTY_COUNTS: VocabularySourceCounts = { all: 0, local: 0, eudic: 0 }

export function VocabularyPage() {
  const [words, setWords] = useState<VocabularyWord[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<VocabularySourceCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"createdAt" | "star" | "word">("createdAt")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [source, setSource] = useState<SourceFilter>("all")
  const [page, setPage] = useState(0)
  const pageSize = 20
  /** The word the detail pane is showing, `null` when nothing is selected. */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchWords = useCallback(async () => {
    setLoading(true)
    try {
      const query: VocabularyQuery = {
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortOrder,
        search: search || undefined,
        source,
      }
      const result = await sendMessage("getVocabularyWords", query)
      setWords(result.words)
      setTotal(result.total)
      // The counts cover the whole book, not the current filter — that is
      // what makes the filter itself useful.
      if (result.bySource)
        setCounts(result.bySource)
    }
    catch (error) {
      console.error("Failed to fetch vocabulary words:", error)
    }
    finally {
      setLoading(false)
    }
  }, [search, sortBy, sortOrder, source, page])

  useEffect(() => {
    void fetchWords()
  }, [fetchWords])

  // The selection is derived at render time rather than reset in an effect: if
  // the selected id has dropped out of the list (a new search, filter, sort or
  // page, or the word was deleted) we simply fall back to the first row, so the
  // detail pane is never stale and never needs a synchronous setState in an
  // effect to recover.
  const selectedWord = words.find(w => w.id === selectedId) ?? words[0] ?? null

  const handleDelete = useCallback(async (word: VocabularyWord) => {
    try {
      const result = await sendMessage("deleteVocabularyWord", { id: word.id })
      if (result?.eudicSync && !result.eudicSync.ok) {
        // The word is gone locally, but the Eudic copy is still there.
        toast.warning(`已从本地删除，但同步到欧路失败：${result.eudicSync.error ?? "未知错误"}`)
      }
      void fetchWords()
    }
    catch (error) {
      console.error("Failed to delete word:", error)
    }
  }, [fetchWords])

  const handleStarChange = useCallback(async (id: string, star: 1 | 2 | 3 | 4 | 5) => {
    try {
      const result = await sendMessage("updateVocabularyWord", { id, updates: { star } })
      setWords(prev => prev.map(w => (w.id === id ? { ...w, star } : w)))
      if (result?.eudicSync && !result.eudicSync.ok) {
        toast.warning(`星级已保存，但同步到欧路失败：${result.eudicSync.error ?? "未知错误"}`)
      }
    }
    catch (error) {
      console.error("Failed to update star:", error)
    }
  }, [])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <PageLayout title="生词本" containerClassName="max-w-none lg:px-6">
      {/* The vertical rule between list and detail spans the full row height, so the
          two columns are separated by padding rather than a gap — the line sits
          flush between them as in the reference design. */}
      <div className="grid gap-6 pt-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-0 lg:divide-x">
        {/* List column */}
        <div className="flex min-w-0 flex-col lg:pr-6">
          {/* Search and sort controls */}
          <div className="space-y-3">
            <div className="relative">
              <Icon icon="tabler:search" className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                placeholder="搜索单词或译文..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0)
                }}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-0.5 rounded-lg border p-0.5">
                {SOURCE_FILTERS.map(key => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={source === key ? "secondary" : "ghost"}
                    className="flex-1 text-xs"
                    onClick={() => {
                      setSource(key)
                      setPage(0)
                    }}
                  >
                    {SOURCE_LABELS[key]}
                    <span className="text-muted-foreground tabular-nums">{counts[key]}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={sortBy}
                onValueChange={(val) => {
                  if (val) {
                    setSortBy(val as "createdAt" | "star" | "word")
                    setPage(0)
                  }
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue>
                    {i18n.t(`sortBy.${sortBy}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">{i18n.t("sortBy.createdAt")}</SelectItem>
                  <SelectItem value="star">{i18n.t("sortBy.star")}</SelectItem>
                  <SelectItem value="word">{i18n.t("sortBy.word")}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                title={sortOrder === "asc" ? i18n.t("sortOrder.asc") : i18n.t("sortOrder.desc")}
              >
                <Icon icon={sortOrder === "asc" ? "tabler:sort-ascending" : "tabler:sort-descending"} />
              </Button>
            </div>
          </div>

          {/* Word list */}
          <div className="mt-4 flex-1">
            {loading
              ? (
                  <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                    加载中...
                  </div>
                )
              : words.length === 0
                ? (
                    <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                      <Icon icon="tabler:book-off" className="size-8" />
                      {source === "eudic"
                        ? (
                            <span>欧路生词本里还没有词，去「通用 → 欧路生词本」点「立即同步」</span>
                          )
                        : search
                          ? (
                              <span>没有匹配的生词</span>
                            )
                          : (
                              <span>还没有生词，划词翻译时收藏即可加入</span>
                            )}
                    </div>
                  )
                : (
                    <EntityListRail containerClassName="max-h-[calc(100vh-19rem)]">
                      <div>
                        {words.map(word => (
                          <WordRow
                            key={word.id}
                            word={word}
                            selected={word.id === selectedWord?.id}
                            onSelect={() => setSelectedId(word.id)}
                            onStarChange={star => handleStarChange(word.id, star)}
                          />
                        ))}
                      </div>
                    </EntityListRail>
                  )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page + 1}
                /
                {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}

          {!loading && total > 0 && (
            <div className="pt-3 text-xs text-muted-foreground">
              共
              {total}
              {" "}
              个单词
            </div>
          )}
        </div>

        {/* Detail column */}
        <div className="min-w-0 lg:pl-6 lg:sticky lg:top-14 lg:max-h-[calc(100vh-3.5rem)] lg:self-start lg:overflow-y-auto">
          {selectedWord
            ? (
                <VocabularyDetail
                  word={selectedWord}
                  onDelete={word => void handleDelete(word)}
                />
              )
            : (
                <div className="flex min-h-40 items-center justify-center p-8 text-sm text-muted-foreground">
                  从左侧选择一个单词查看详情
                </div>
              )}
        </div>
      </div>
    </PageLayout>
  )
}

/**
 * One row of the list column.
 *
 * The whole row is clickable and selects the word for the detail pane; the
 * star rating keeps its own quick-edit control. The delete action lives in the
 * detail pane so the row stays a single clean target to click.
 */
function WordRow({
  word,
  selected,
  onSelect,
  onStarChange,
}: {
  word: VocabularyWord
  selected: boolean
  onSelect: () => void
  onStarChange: (star: 1 | 2 | 3 | 4 | 5) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "-mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{word.word}</span>
          {word.source === "eudic" && (
            <Badge
              variant="outline"
              size="sm"
              className="shrink-0 text-[10px]"
              title="来自欧路生词本"
            >
              欧路
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {word.translation}
        </div>
      </div>

      <div className="shrink-0">
        <StarRating
          value={word.star}
          onChange={onStarChange}
          size="sm"
        />
      </div>
    </div>
  )
}
