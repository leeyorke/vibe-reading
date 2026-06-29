# Vibe Reading

浏览器扩展，用于网页阅读、翻译和语言学习。配置存储在本地，AI/翻译能力由用户自行配置的服务商和 API Key 提供，不依赖项目自建后端。

## Project

- **Stack**: React 19 + TypeScript 6 + WXT 0.20 (browser ext framework) + Vite 8 + Tailwind CSS 4 + Vitest 4
- **包管理**: pnpm (v10, `pnpm-lock.yaml`)
- **入口点** (wxt entrypoints):
  - `src/entrypoints/background/` — Service Worker (后台常驻)
  - `src/entrypoints/popup/` — 弹出面板 UI
  - `src/entrypoints/options/` — 选项页 SPA (带 command palette、多页面路由)
  - `src/entrypoints/host.content/` — Content Script (注入网页)
- **路径别名**: `@/` → `src/`
- **浏览器支持**: Chrome MV3, Edge MV3, Firefox MV3

## Commands

| 命令                        | 说明                               |
| --------------------------- | ---------------------------------- |
| `pnpm dev`                  | 启动开发服务器 (热更新, port 3333) |
| `pnpm build`                | 生产构建 (默认 Chrome)             |
| `pnpm build:firefox`        | Firefox 构建                       |
| `pnpm build:edge`           | Edge 构建                          |
| `pnpm build:analyze`        | 构建并分析 bundle                  |
| `pnpm test`                 | Vitest 运行全部测试                |
| `pnpm test:watch`           | Vitest watch 模式                  |
| `pnpm test:cov`             | 带覆盖率报告                       |
| `pnpm lint`                 | ESLint 检查                        |
| `pnpm lint:fix`             | ESLint 自动修复                    |
| `pnpm type-check`           | `tsc --noEmit` 类型检查            |
| `pnpm zip`                  | 打包为 .zip (Chrome)               |
| `pnpm zip:all`              | 打包所有浏览器                     |
| `pnpm scrape:ai-sdk-models` | 抓取 AI SDK provider 模型列表      |

## Architecture

- **`src/entrypoints/background/`** — Service Worker: 配置初始化、翻译队列调度 (`translation-queues.ts`)、LLM 文本生成 (`llm-generate-text.ts`)、代理 fetch (`proxy-fetch.ts`)、iframe 注入管理、数据库定时清理 (`db-cleanup.ts`)
- **`src/entrypoints/host.content/`** — Content Script: 注入到每个网页的翻译控制 UI、DOM 操作监听、运行时通信 (`runtime.ts`)、快捷键绑定。通过 Shadow DOM 隔离样式
- **`src/entrypoints/popup/`** — 弹出面板: 快速切换翻译、语言选择、模式切换。使用 Jotai 原子从 Storage 读取配置
- **`src/entrypoints/options/`** — 完整选项页 SPA: 配置 API 服务商 (`api-providers/`)、翻译参数 (`translation/`)、通用设置 (`general/`)、命令面板 (`command-palette/`)
- **`src/utils/host/translate/`** — 翻译核心引擎: DOM 遍历/过滤/文本节点翻译、网页上下文提取、摘要生成、双语对照渲染
- **`src/utils/request/`** — 请求管理: 优先级队列、批处理队列、重试策略 (`retry-policy.ts`)、去重
- **`src/utils/config/`** — 配置系统: Zod schema 定义 (`src/types/config/`)、从 `chrome.storage.local` 读写、迁移、初始化
- **`src/utils/providers/`** — AI 服务商集成: OpenAI、DeepSeek、OpenAI-Compatible 等 provider 配置、模型 ID、header 处理
- **`src/components/`** — 共享 UI 组件: shadcn/ui 风格 (`ui/`)、翻译结果展示 (`translation/`)、LLM 服务商表单 (`llm-providers/`)、拖拽排序 (`sortable-list.tsx`)、快捷鍵录制 (`shortcut-key-recorder.tsx`)
- **`src/locales/`** — i18n 翻译文件 (YAML, 9 种语言: en/zh-CN/zh-TW/ja/ko/es/ru/vi/tr)
- **`src/definitions/index.ts`** — 集中的常量/枚举定义 (语言代码、provider 定义等)
- **`src/utils/db/`** — IndexedDB (Dexie) 缓存层: 翻译缓存、摘要缓存、生词本词汇表 (`vocabularyWords`)
- **`src/entrypoints/host.content/selection-toolbar/`** — 划线翻译浮动工具栏: 选区监听 Hook、工具栏组件（翻译 + 收藏）、Shadow DOM 挂载
- **`src/entrypoints/background/selection-translate.ts`** — 选中文本翻译处理器（单条翻译，不走批处理队列）
- **`src/entrypoints/background/vocabulary-handlers.ts`** — 生词本 CRUD + 闪卡会话消息处理器
- **`src/entrypoints/options/pages/vocabulary/`** — 生词本管理页: 搜索、排序、分页、星级修改、删除
- **`src/entrypoints/options/pages/flashcards/`** — 闪卡复习页: 正面单词 → 翻转显示译文 → 1-5星评分 → 完成统计

## Conventions

- **导入顺序**: 按 `setup` → type imports → builtin → external → internal (`@/`) → relative → styles，`perfectionist/sort-imports` 强制
- **样式**: Tailwind CSS 4 (PostCSS), 不使用 CSS Modules，通过 `class-variance-authority` + `tailwind-merge` 组合类名
- **状态管理**: Jotai atoms + TanStack React Query (服务端/异步状态)
- **配置验证**: 用 Zod schema (`z.object`) 定义配置结构，通过 `superRefine` 做跨字段校验
- **消息通信**: `@webext-core/messaging` 类型安全的 `onMessage`/`sendMessage` 模式 (见 `src/utils/message.ts`)
- **国际化**: `@wxt-dev/i18n` + `wxt/utils/i18n`, 翻译文件在 `src/locales/*.yml`，代码中 `i18n.t("key")`
- **测试**: Vitest, 测试文件紧邻源码放在 `__tests__/` 目录下, `*.test.ts` 或 `*.test.tsx`
- **格式化**: ESLint (antfu config) + Prettier (markdown), 双引号, 无分号, `unused-imports/no-unused-imports: error`
- **Git**: commitlint (conventional commits) + husky + lint-staged
- **日志**: `src/utils/logger.ts` — 仅 dev 环境下输出, 生产环境 noop; 使用 `logger.info/warn/error`
- **划线翻译**: 选区监听 (`useTextSelection` Hook) + `sendMessage("translateSelectedText")` → background 直接调用 `aiTranslate()`（不走批处理队列）
- **生词本收藏**: `sendMessage("addVocabularyWord")` → background 写入 Dexie `vocabularyWords` 表（同词+同URL去重），默认 `star=3`
- **闪卡复习**: `sendMessage("getFlashcardSession")` → weighted random 抽取 10 个单词（低星高权重），`markWordReviewed` 更新星级和复习次数
- **React**: 函数组件 + hooks, JSX 使用 `react-jsx` transform, `useCallback`/`useMemo` 适度使用
- **错误边界**: `react-error-boundary` + 自定义 `RecoveryBoundary` 组件

## Notes

<!-- 快速备注区: 在此追加临时发现或小贴士 -->
