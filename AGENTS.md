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
- **`src/entrypoints/host.content/selection-toolbar/`** — 划线浮动工具栏: 选区监听 Hook (`use-text-selection.ts`)、工具栏组件（翻译 + 朗读 + 收藏）、朗读播放 hook (`use-speech-playback.ts`)、选中文字的语言猜测 (`guess-speech-lang.ts`)、Shadow DOM 挂载
- **`src/entrypoints/background/selection-translate.ts`** — 选中文本翻译处理器（单条翻译，不走批处理队列）
- **`src/entrypoints/background/vocabulary-handlers.ts`** — 生词本 CRUD + 闪卡会话消息处理器
- **`src/entrypoints/background/review-scheduler.ts`** — 艾宾浩斯主动推送:自重排单次 `browser.alarms` (当 `periodInMinutes` 被浏览器强制 ≥1 分钟时,用 `when` 精确唤醒) → `runReviewTick()` → 系统通知;注册 `notifications.onClicked / onClosed`
- **`src/entrypoints/review-card/`** — 独立复习卡片页 (`review-card.html`): 从通知点击打开，展示单词/音标/例句/中文/固定搭配 + 「记住了/没记住」
- **`src/utils/review/`** — SRS 纯逻辑 (`schedule.ts`: 阶段推进/静默期/配额)、本地状态 (`store.ts`)、队列同步 (`queue-sync.ts`)、卡片组装 (`review-card.ts`)、例句生成 (`example-generator.ts`)、通知构造 (`notify.ts`)、朗读 (`speech.ts`)、词典文本解析 (`definition-lines.ts`)
- **`src/entrypoints/background/review-handlers.ts`** — `/review` 选项页与复习卡片页的消息处理器 (状态/立即同步/清空队列/取卡片/评分)
- **`src/entrypoints/background/speech-handlers.ts`** — 发音消息处理器：`synthesizeSpeech`（复习卡片页要的 `data:` URL）和 `synthesizeSpeechAudio`（悬浮工具栏要的 base64 文本）。两个出口是因为两种调用方活在不同的世界：扩展页可以直接 `new Audio(dataUrl)`，content script 不行，见下面 Notes 的说明
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

- **悬浮工具栏的「朗读」按钮不能在 content script 里 `new Audio(dataUrl)`**: 媒体元素挂在页面的 document 上，即使创建它的是隔离世界里的 content script，`data:`/`blob:` 加载也会被页面 CSP 的 `media-src`（或最常见的 `default-src 'self'`）拒绝——`default-src 'self'` 的站点一片一片的，按钮会等于没点。正确姿势是 background 返回音频内容、content script 里用 **Web Audio**（`AudioContext.decodeAudioData` + `AudioBufferSourceNode`）播放：没有任何 CSP 指令能拦 Web Audio，顺带隔离了页面 JS 对播放的干扰。`AudioContext` 必须在点击的同一个 task 里创建/`resume()`（在第一个 `await` 之前），否则 Chrome 的自动播放策略不给声音。请求进行中用户点了停止/换了选区/工具栏卸载时，用自增 token 让迟到的结果作废，别播放一段没人要的音频
- **`runtime.sendMessage` 走 JSON 序列化，二进制必须自己编码**: Chrome 的扩展消息管道对 `sendMessage`/`onMessage` 做的是 JSON 序列化（structured clone 只属于 `runtime.connect` 端口和 `postMessage`）。所以 `Promise<ArrayBuffer>` 这种返回类型到了 content script 就是 `{}`——症状是「HAR 里 200 audio/mpeg、日志全绿、按钮从朗读中变成朗读、就是没声音」，因为 `decodeAudioData({})` 抛 "parameter 1 is not of type 'ArrayBuffer'"，而 `{}` 的 `byteLength` 是 `undefined`，日志里只会看到莫名的 `in:undefined`。踩过一遍：`synthesizeSpeechAudio` 现在返回 **base64 字符串**，工具栏 `Uint8Array.from(atob(s), c => c.charCodeAt(0))` 还原成字节再喂 `decodeAudioData`。**给消息协议加返回类型时，先问一句「这个值 JSON 之后还在吗」**；测试里直接断言 `JSON.parse(JSON.stringify(payload))` 仍可用（`speech.test.ts` 的「returns a payload that survives the message channel」）。另外别指望 `chrome.permissions.contains` 在 headless 里说真话——无头 profile 里 host_permissions 可能显示未授予，于是 SW 的跨域 fetch 会被 CORS 拦成 "Failed to fetch"，跟真机表现不一致
- **`AudioBufferSourceNode` 忘记 `connect(context.destination)` 是静默故障**: `start()` 照常成功、`onended` 照常触发、没有任何报错，但一个音符都听不到——表现就是「请求成功了、按钮状态也变了、就是没声音」。测试里务必断言 `source.connect` 被调用过，光断言 `start()` 拦不住这个 bug
- **MV3 消息端口会在 handler 跑完之后才丢响应**: 用户看到的症状是「按钮显示翻译失败，但 HAR 里请求和响应全正常」——handler 完整执行了（fetch、解析、映射都成功），但 `sendMessage` 的 promise 以 "The message port closed before a response was received"/"No response" reject。这是 Chrome 给沉睡的 service worker 投递消息时的经典竞态，与本项目的业务代码无关。工具栏用 `withMessageRetry`（`message-retry.ts`）对这类传输层错误重试一次（worker 已热、且请求都是幂等 GET）；**真实错误不要重试**，直接抛。另外 UI 层 catch 务必带上 `error.message`（`翻译失败：${errorMessage(error)}`），否则端口竞态、handler 报错、provider 失败在界面上长得一模一样，只能靠用户截图猜
- **重新加载扩展后必须刷新页面，否则 content script 是孤魂野鬼**: Chrome 不会给已打开的标签页重新注入 content script——旧脚本继续跑、工具栏继续响应点击，但它所有的 `chrome.*` binding 已被拆除，任何调用都以 "Extension context invalidated"（或参数 shim 读不到 `.length` 抛的 TypeError）失败，而 background 根本没被唤醒（HAR 里什么都看不到）。`chrome://extensions` 的错误页会把这些未捕获的 rejection 列在对应页面 URL 下，是诊断这个问题的第一现场。防线有三层：`message-retry.ts` 靠 `chrome.runtime.id` 探测并把错误换成「扩展已重新加载，请刷新页面后重试」；工具栏每秒轮询同一个探针，一旦中招就把三个按钮换成可点击的「刷新页面」片（`selection-toolbar.tsx`）；两个 content script 的 `main()` 都包了 try/catch，启动期遇失效只打日志、不留未捕获异常。**每次 reload 扩展后都要 F5 页面**；跑 `pnpm dev` 时每次源码改动触发扩展自 reload，更要记得刷新页面
- **「扩展已重新加载，请刷新页面后重试」只有探针说了才算**: `message-retry.ts` 曾经还把 polyfill 那种 `Cannot read properties of undefined (reading 'length')` TypeError 也当失效信号——结果自家代码抛同一个 message 时（词典 payload 少一个 `examples` 字段，`toWordDefinition` 解引用 throws），用户被指去刷新一个根本没失效的页面，且刷新永远治不好。V8 的 TypeError 文案分不清是 binding shim 还是业务代码，所以**消息匹配只保留点名 binding 的那条**（`.sendMessage is not a function`），其余一律以 `isExtensionContextInvalidated()`（`runtime.id`/`sendMessage` 直接探）为准。同理，业务侧不能让畸形 payload 变成 throw：词典 backend 是用户自己跑的本地服务，entry 形状不统一（`phonetics`/`senses`/`examples` 都可能缺），`dict-api.ts` 的 `isUsableWordPayload` 按「至少一个 sense」判读并全链路可选链，`selection-translate.ts` 的 handler 也包 try/catch 返回 null——null 是工具栏唯一认识的「miss」，它自然会回落到 LLM 翻译
- **每次页面加载都会打一次 LLM 语言检测请求**（预存设计，不是划线翻译）: `host.content/runtime.ts` 结尾对 top frame 调 `detectAndReportPageLanguage` → `detectPageLanguageLightweight`（`utils/content/page-language.ts`）→ `detectLanguageWithSource` → `detectLanguageWithLLM`（`utils/content/language.ts`），页面正文 ≥80 字符就走 LLM。所以刷新任意网页都会看到一个 `/chat/completions` 请求——用户在排查工具栏问题时容易把它误当成「翻译按钮走了 LLM」。单次划词翻译的走向是：单词 → `translateSelectedTextStructured` → 本地词典 `{backendBaseUrl}/api/word/{word}`，返回 null 才回落到 LLM
- **划线的发音语言只能按文字脚本猜** (`guess-speech-lang.ts`): 假名→ja（要先于汉字判断，否则日语被当中文）、谚文→ko、汉字→zh、西里尔→ru 等；拉丁文字一律 `en`。复习卡片那边词条自带 `sourceLanguage`，工具栏这边页面语言不可靠（法文页面上的英文引语），脚本是唯一诚实信号
- **复习调度器的启动同步必须看 `review.enabled` 开关**（a176be5 的修复记录）: `setupReviewScheduler()` 原来在**每次 worker 唤醒**时都调 `syncReviewQueue()`，而 MV3 的 SW 会为每条 content script 消息唤醒一次——等于每次点「翻译」都要先打一遍 `/api/vocabulary`，即使功能从来是关闭的（默认关闭）。现在开关关着只清 alarm、不碰后端。另外一个隐蔽点：`syncReviewQueue` 的限流条件是 `state.lastSyncAt != null`，首次同步前（或后端挂导致同步失败、`lastSyncAt` 一直写不进去时）限流完全旁路，每次唤醒都会重试——后端长时间不可用时这就是个每消息一次的请求风暴，改限流时记得一起考虑失败退避
- **诊断「按钮报错但 HAR 全正常」时先看 `chrome://extensions` 的错误页**: 那里的 "Uncaught (in promise): Error: Extension context invalidated" + 堆桩指向哪个 content script，直接说明页面里跑的是**已被失效的旧脚本**（扩展被 reload 过而页面没刷新）。堆桩落在 bundle 的模块求值处（如 `selection.js:5:1`）说明是**启动期**就带着失效上下文在跑；此时 background 根本没被唤醒，HAR 自然什么都没有。content script 的 `main()` 全量 try/catch 可以把这种噪声挡在日志里
- **Edge 桌面应用（PWA 独立窗口）和其它标签页对 content script 一视同仁**: 从快捷方式启动的 PWA 窗口是全新页面加载，content script 注入时上下文健康，所以它"看起来正常"；而排查期间被反复 reload 扩展的老标签页脚本全部失效。别被"PWA 能用"误导——那通常只证明它是刚启动的。真正判断标准： reload 扩展后**每一个**开着的页面（含 PWA 窗口，Ctrl+R 或从快捷方式重启）都要刷新
