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
- **`src/entrypoints/background/review-scheduler.ts`** — 艾宾浩斯主动推送:自重排单次 `browser.alarms` (当 `periodInMinutes` 被浏览器强制 ≥1 分钟时,用 `when` 精确唤醒) → `runReviewTick()` → 系统通知;注册 `notifications.onClicked / onClosed`
- **`src/entrypoints/review-card/`** — 独立复习卡片页 (`review-card.html`): 从通知点击打开，展示单词/音标/例句/中文/固定搭配 + 「记住了/没记住」
- **`src/utils/review/`** — SRS 纯逻辑 (`schedule.ts`: 阶段推进/静默期/配额)、本地状态 (`store.ts`)、队列同步 (`queue-sync.ts`)、卡片组装 (`review-card.ts`)、例句生成 (`example-generator.ts`)、通知构造 (`notify.ts`)、朗读 (`speech.ts`)、词典文本解析 (`definition-lines.ts`)
- **`src/entrypoints/background/review-handlers.ts`** — `/review` 选项页与复习卡片页的消息处理器 (状态/立即同步/清空队列/取卡片/评分)
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
- **主动推送复习 (Ebbinghaus)**: SRS 状态**只存本地** `chrome.storage.local` (`local:review:*`)，因为后端 `/api/vocabulary` 没有「上次推送时间」字段；推送走词条快照，不依赖后端在线。间隔阶梯 `SRS_INTERVALS_MINUTES` = 5m/30m/12h/1d/2d/4d/7d/15d，到点自动推进 (`advanceStage`)，在卡片页点「记住了/没记住」只做 ±2/−1 修正。例句复用 `config.translate.providerId`（**不新增 `FEATURE_KEY`**，否则 `configSchema.superRefine` 会让老配置解析失败、`initializeConfig` 直接重置整个配置）；新配置块用 `.prefault({})` 而非 `.default({})`，同样是为了老配置兼容
- **通知只是门铃，不带按钮**: Windows 通知中心折叠态只渲染一行标题，任何按钮都点不到。所以通知只做「提醒 + 点击开卡片页」这一个动作，评分按钮放在卡片页底部。卡片页通过 `openReviewCard` 复用同一个标签页（`tabs.query` + `tabs.update` + `windows.update`），一天推十几条也不会堆成一堆标签
- **复习会话走 `pendingReview` 而非「已到期」**: 词条在到期那一刻才被推送，所以卡片推进到下一个词时，其他词**一个都没到期**——按 `nextDueAt <= now` 找下一个词会让会话立刻死胡同。推送时置 `entry.pendingReview = true`，评分时置 `false`，卡片按 `lastNotifiedAt` 升序取下一个待评价词
- **例句 / 固定搭配 / 例句翻译在推送时一次 LLM 调用产出**: 卡片页因此不需要任何网络等待或加载态。prompt 要求严格 JSON，用 `parseExamplePayload` 容错解析（剥 ```json 围栏、取首尾花括号、逐字段校验），任一步失败整包丢弃并降级到收藏时的原句
- **WXT storage key 必须带区域前缀** (`local:` / `session:`)，裸 key 会被 `resolveKey` 当成非法 area 抛错
- **卡片页发音走 Google Translate 的 TTS 端点** (`translate.google.com/translate_tts`, `client=gtx`)，请求放在 background 里做并缓存成 `data:` URL 返回。不要退回 `speechSynthesis`——它静默依赖系统已安装的英语语音包，纯净的 Windows 上没有，按钮点了等于没点。**微软那条走不通**：Edge readaloud 端点会拒绝所有缺少 `Sec-MS-GEC` 令牌的请求，而该令牌由 Windows machine id 推导，属于反自动化控制而非接口怪癖，别去绕
- **`/review` 设置页有「立即推送一条」和「打开复习卡片」两个调试入口**，别删：否则卡片页只能等推送才能看。`runReviewNow` 直接调 alarm 调的同一个 `runReviewTick()`，**没有**绕过静默期/每日上限的强制推送路径——测试不该偷偷破坏 SRS 阶梯
- **React**: 函数组件 + hooks, JSX 使用 `react-jsx` transform, `useCallback`/`useMemo` 适度使用
- **错误边界**: `react-error-boundary` + 自定义 `RecoveryBoundary` 组件

## Notes

<!-- 快速备注区: 在此追加临时发现或小贴士 -->
