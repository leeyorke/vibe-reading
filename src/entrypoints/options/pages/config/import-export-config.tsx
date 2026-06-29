import { IconFileDownload, IconFileUpload } from "@tabler/icons-react"
import { useSetAtom } from "jotai"
import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { writeConfigAtom } from "@/utils/atoms/config"
import { getLocalConfig } from "@/utils/config/storage"
import { ConfigCard } from "../../components/config-card"

export function ImportExportConfig() {
  const setConfig = useSetAtom(writeConfigAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [parsedConfig, setParsedConfig] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleExport = async () => {
    try {
      const config = await getLocalConfig()
      if (!config) {
        toast.error("当前没有配置可导出")
        return
      }

      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vibe-reading-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("配置已导出")
    }
    catch {
      toast.error("导出失败")
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file)
      return

    setParseError(null)
    setParsedConfig(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      try {
        const json = JSON.parse(content)
        // Basic validation: check if it looks like a Vibe Reading config
        if (!json.uiLocale && !json.language && !json.providersConfig && !json.translate) {
          setParseError("文件格式不正确，不是有效的 Vibe Reading 配置文件")
          return
        }
        setParsedConfig(content)
        setImportDialogOpen(true)
      }
      catch {
        setParseError("文件不是有效的 JSON 格式")
      }
    }
    reader.onerror = () => {
      setParseError("读取文件失败")
    }
    reader.readAsText(file)

    // Reset input so the same file can be selected again
    e.target.value = ""
  }

  const handleImport = async () => {
    if (!parsedConfig)
      return

    setImporting(true)
    try {
      const config = JSON.parse(parsedConfig)
      await setConfig(config)
      setImportDialogOpen(false)
      setParsedConfig(null)
      toast.success("配置已导入")
    }
    catch {
      toast.error("导入失败，配置格式有误")
    }
    finally {
      setImporting(false)
    }
  }

  return (
    <ConfigCard id="import-export-config" title="导入/导出配置" description="导出当前配置为 JSON 文件，或从 JSON 文件导入配置">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleExport}>
          <IconFileDownload className="size-4" />
          导出配置
        </Button>

        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <IconFileUpload className="size-4" />
          导入配置
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        {parseError && (
          <p className="w-full text-sm text-destructive mt-2">{parseError}</p>
        )}

        <AlertDialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认导入配置</AlertDialogTitle>
              <AlertDialogDescription>
                导入将覆盖当前所有配置（包括 API 密钥和服务商设置）。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setParsedConfig(null)}>取消</AlertDialogCancel>
              <AlertDialogAction variant="brand" onClick={handleImport} disabled={importing}>
                {importing ? "导入中..." : "确认导入"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ConfigCard>
  )
}
