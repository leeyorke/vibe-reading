import type { VocabularyQuery, VocabularyWord } from "@/types/vocabulary"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useState } from "react"
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
import { PageLayout } from "../../components/page-layout"
import { StarRating } from "./star-rating"

export function VocabularyPage() {
  const [words, setWords] = useState<VocabularyWord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"createdAt" | "star" | "word">("createdAt")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchWords = useCallback(async () => {
    setLoading(true)
    try {
      const query: VocabularyQuery = {
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortOrder,
        search: search || undefined,
      }
      const result = await sendMessage("getVocabularyWords", query)
      setWords(result.words)
      setTotal(result.total)
    }
    catch (error) {
      console.error("Failed to fetch vocabulary words:", error)
    }
    finally {
      setLoading(false)
    }
  }, [search, sortBy, sortOrder, page])

  useEffect(() => {
    void fetchWords()
  }, [fetchWords])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await sendMessage("deleteVocabularyWord", { id })
      void fetchWords()
    }
    catch (error) {
      console.error("Failed to delete word:", error)
    }
  }, [fetchWords])

  const handleStarChange = useCallback(async (id: string, star: 1 | 2 | 3 | 4 | 5) => {
    try {
      await sendMessage("updateVocabularyWord", { id, updates: { star } })
      setWords(prev => prev.map(w => (w.id === id ? { ...w, star } : w)))
    }
    catch (error) {
      console.error("Failed to update star:", error)
    }
  }, [])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <PageLayout title="生词本" innerClassName="*:border-b [&>*:last-child]:border-b-0">
      {/* Search and sort controls */}
      <div className="flex items-center gap-3 p-4">
        <div className="relative flex-1">
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

        <Select
          value={sortBy}
          onValueChange={(val) => {
            if (val) {
              setSortBy(val as "createdAt" | "star" | "word")
              setPage(0)
            }
          }}
        >
          <SelectTrigger className="w-32">
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

      {/* Word list */}
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
                <span>还没有生词，划词翻译时收藏即可加入</span>
              </div>
            )
          : (
              <div className="divide-y">
                {words.map(word => (
                  <div key={word.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{word.word}</span>
                        {word.contextUrl && (
                          <a
                            href={word.contextUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground shrink-0 hover:text-foreground"
                            title="查看原文页面"
                          >
                            <Icon icon="tabler:external-link" className="size-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-muted-foreground text-xs truncate mt-0.5">
                        {word.translation}
                      </div>
                      {word.contextText && word.contextText !== word.word && (
                        <div className="text-muted-foreground/60 text-xs truncate mt-0.5 italic">
                          {word.contextText}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <StarRating
                        value={word.star}
                        onChange={star => handleStarChange(word.id, star)}
                        size="sm"
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleDelete(word.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="删除"
                      >
                        <Icon icon="tabler:trash" className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-4">
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
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          共
          {total}
          {" "}
          个单词
        </div>
      )}
    </PageLayout>
  )
}
