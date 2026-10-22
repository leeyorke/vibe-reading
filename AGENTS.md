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
- **`src/entrypoints/host.content/selection-toolbar/`** — 划线浮动工具栏: 选区监听 Hook (`use-text-selection.ts`)、工具栏组件（翻译 + 朗读 + 收藏）、Shadow DOM 挂载
- **`src/entrypoints/selection.content/`** — 划线工具栏的 content script：按 `config.selection` 的规则决定要不要挂载工具栏（见下面 Notes）
- **`src/utils/selection-rules.ts`** — 划线工具栏的站点规则：域名归一化 + 匹配（`normalizeDomainRule` / `matchesDomainRule` / `shouldShowSelectionToolbar`）
- **`src/hooks/use-speech-playback.ts`** — 朗读播放 hook（Web Audio 播放 background 返回的 base64 音频），划线工具栏和闪卡页共用
- **`src/utils/message-retry.ts`** — 扩展消息重试：MV3 端口竞态重试一次 + 失效上下文探测（`isExtensionContextInvalidated`），划线工具栏和闪卡页共用
- **`src/utils/guess-speech-lang.ts`** — 选中文字的语言猜测（划线用；闪卡页有卡片自带的语言时不需要猜）
- **`src/entrypoints/background/selection-translate.ts`** — 选中文本翻译处理器（单条翻译，不走批处理队列）
- **`src/entrypoints/background/vocabulary-handlers.ts`** — 生词本 CRUD + 闪卡会话消息处理器
- **`src/entrypoints/background/speech-handlers.ts`** — 发音消息处理器：`synthesizeSpeechAudio`（悬浮工具栏要的 base64 文本）。见下面 Notes 的说明
- **`src/utils/speech.ts`** — 朗读核心：Google Translate TTS 端点的 URL 构造、语言映射、音频缓存、base64 编码
- **`src/utils/vocabulary/definition-lines.ts`** — 词典文本解析：把多行释义拆成「音标行 + 释义行」，闪卡页用
- **`src/entrypoints/options/pages/vocabulary/`** — 生词本管理页: 搜索、排序、分页、星级修改、删除；本地词与欧路词合并展示，可按来源筛选
- **`src/entrypoints/options/pages/flashcards/`** — 闪卡复习页: 正面单词 → 翻转显示译文 → 1-5星评分 → 完成统计；卡片上有「朗读单词」按钮（正面、背面都有）
- **`src/utils/vocabulary/eudic-api.ts`** — 欧路生词本的后端转发客户端（token 留在后端，扩展不持有）
- **`src/entrypoints/background/eudic-handlers.ts`** — 欧路配置/生词本列表/验证/同步的消息处理器
- **`src/entrypoints/options/pages/general/eudic-service.tsx`** — 欧路接入设置卡片（启用、token 来源、生词本选择、立即同步）

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
- **划线翻译（流式）**: 选区监听 (`useTextSelection` Hook) → 单词先 `sendMessage("translateSelectedTextStructured")` 查本地词典，miss 或多词才走 LLM：`requestSelectionTranslateStream()`（`selection-toolbar/selection-translate-stream.ts`）开一个 `runtime.connect` 端口 → background `setupSelectionTranslateStreamHandler()` 用 `streamText` 边生成边 `port.postMessage({type:"delta"})`，收尾发 `{type:"done", text}` 并 `disconnect()`（端口不关会一直吊着 service worker）。**不走 `sendMessage`**：一请求一响应的通道逼着整段生成完才能显示，而那正是用户抱怨的转圈等待；端口还顺便在流式期间保持 SW 不睡。`done` 里的 text 才是权威全文（已 trim，也就是进生词本的那份），delta 只负责让用户先看着。思维链内联在正文里的模型由 `createThinkTagFilter`（`utils/host/translate/api/think-tag.ts`）按开头几个字符判定、拦在闭合的 think 标签之前，语义跟非流式那条 `THINK_TAG_RE` 保持一致
- **划线翻译（已删掉的缓冲通道）**: 曾经还有一条 `sendMessage("translateSelectedText")` → `aiTranslate()` 的一次性通道，流式上线后它没有任何调用方，连消息协议条目一起删了。别再加回来——同一个功能留两条看得见的路，下一个人只会猜哪条是活的
- **划线翻译的两个位置分工**: 结果卡片默认 `position: fixed` 钉在视口右侧居中（`right:16px; top:50%`），拖动手柄可改，一次新的翻译会重置回默认位；悬浮胶囊（翻译/朗读/收藏）继续贴住划线，滚动页面时跟着文字走。**胶囊和卡片都在 `toolbarRef` 这同一个 wrapper 里**——选区钩子把 wrapper 当成「内部」，卡片一旦被搬出去，滚动结果卡片就会被判成「点了外部」，`hideToolbar()` 清掉 `lastRangeRef`，胶囊从此不再跟随
- **生词本收藏**: `sendMessage("addVocabularyWord")` → background 调后端 `POST /api/vocabulary` 写进**后端**的 `vocabulary_words` 表（扩展里那个 Dexie `vocabularyWords` 表在迁移到后端时已清空，是遗留物）
- **生词本与欧路（Eudic）合并**: 生词本的真实存储在**后端** `D:\myworkspace\mdx`（`user.db` 的 `vocabulary_words` 表），扩展只通过 `/api/vocabulary` 读写；欧路那侧由**后端**代理 `api.frdic.com`（`mdx/app/eudic.py`），扩展不持有 NIS token。token 从后端进程的环境变量 `EUDIT_API_KEY` 读（设置页的备用 token 排第二）。欧路词以 `source='eudic'` 落进同一张表，所以翻页/搜索/排序天然统一，艾宾浩斯队列也自动覆盖。**别把欧路调用搬进扩展**：那会让分页/排序要在前端做双源归并，还会让复习队列漏掉欧路词
- **闪卡复习**: `sendMessage("getFlashcardSession")` → weighted random 抽取 10 个单词（低星高权重），`markWordReviewed` 更新星级和复习次数
- **闪卡页的「朗读单词」按钮**: 卡片正面、背面各一个，朗读的是**单词本身**（不是释义）。走 `useSpeechPlayback()`（`src/hooks/use-speech-playback.ts`）→ background `synthesizeSpeechAudio` → Web Audio 播放。语言优先用卡片自带的 `sourceLanguage`（ISO 639-3），没有才按脚本猜（`guess-speech-lang.ts`）。按钮在卡片内部，所以 `onClick` 必须 `stopPropagation()`——否则点朗读会顺手把卡片翻面。翻卡/换卡/结束本轮时要把上一个词的声音停掉
- **主动推送复习 (Ebbinghaus) 已迁到后端**: 复习提醒整套逻辑（艾宾浩斯阶梯、免打扰时段、每日配额、Windows 通知、复习卡片）现在在 `D:\myworkspace\mdx`（FastAPI 后端，入口 `app/review/`），扩展侧只保留生词本与闪卡。闪卡评分会调后端 `POST /api/vocabulary/{id}/review` 累加 `review_count`、写 `last_reviewed_at`——后端正是靠这个字段挑出「复习过一次」的词进入艾宾浩斯队列。**别把提醒逻辑搬回扩展**：`notifications` 权限已经移除，`browser.alarms` 只剩下 db-cleanup 在用
- **WXT storage key 必须带区域前缀** (`local:` / `session:`)，裸 key 会被 `resolveKey` 当成非法 area 抛错
- **发音走 Google Translate 的 TTS 端点** (`translate.google.com/translate_tts`, `client=gtx`)，请求放在 background 里做并缓存成 base64 返回。不要退回 `speechSynthesis`——它静默依赖系统已安装的英语语音包，纯净的 Windows 上没有，按钮点了等于没点。**微软那条走不通**：Edge readaloud 端点会拒绝所有缺少 `Sec-MS-GEC` 令牌的请求，而该令牌由 Windows machine id 推导，属于反自动化控制而非接口怪癖，别去绕
- **React**: 函数组件 + hooks, JSX 使用 `react-jsx` transform, `useCallback`/`useMemo` 适度使用
- **错误边界**: `react-error-boundary` + 自定义 `RecoveryBoundary` 组件

## 发版流程

**每次发版 = 一个新提交 + 一个打在这个提交上的 tag。** 规则是死的，CI 会校验：

1. **发版提交**：单独起一个提交，提交信息**正好**是 `chore: release v.X.Y.Z`（不能带别的字）
2. **版本号**：这个提交把 `package.json` 的 `version` 改成 `X.Y.Z`（`v1.39.1` → 版本 `1.39.1`）
3. **tag**：`v.X.Y.Z` 打在**上面那个提交**上（不是打在别的提交上）
4. **不重打已发布的 tag**：要改已发布的内容就发新的版本号。想重打就得改写历史，会把
   已经发出去的 Release 指向一个不存在的提交

一条命令走完（`scripts/release.mjs`，会检查工作区干净、在 main 上、tag 不存在）：

```bash
pnpm release patch          # 1.39.0 -> 1.39.1
pnpm release minor          # 1.39.0 -> 1.40.0
pnpm release major          # 1.39.0 -> 2.0.0
pnpm release 1.40.0        # 指定版本
pnpm release patch --push  # 顺便把 main 和 tag 都推上去
```

推 tag 之后 GitHub Actions 会自动打包并发布 Release（`.github/workflows/build.yml` 的
`Publish GitHub Release` job）。

**CI 的两道校验**（`build.yml` 的 `Resolve release tag` 步骤，不满足就**不发版**）：

- tag 名必须等于 `v${package.json 的 version}`
- tag 指向的提交的标题必须等于 `chore: release ${tag}`

**main 推送只构建、不发版**（release job 的 `if` 只认 `refs/tags/v`）。以前 main 推送
也会尝试自己打 tag，于是「tag 已存在」每次都把 CI 弄红——现在这个 job 根本不跑。

## Notes

<!-- 快速备注区: 在此追加临时发现或小贴士 -->

- **悬浮工具栏的「朗读」按钮不能在 content script 里 `new Audio(dataUrl)`**: 媒体元素挂在页面的 document 上，即使创建它的是隔离世界里的 content script，`data:`/`blob:` 加载也会被页面 CSP 的 `media-src`（或最常见的 `default-src 'self'`）拒绝——`default-src 'self'` 的站点一片一片的，按钮会等于没点。正确姿势是 background 返回音频内容、content script 里用 **Web Audio**（`AudioContext.decodeAudioData` + `AudioBufferSourceNode`）播放：没有任何 CSP 指令能拦 Web Audio，顺带隔离了页面 JS 对播放的干扰。`AudioContext` 必须在点击的同一个 task 里创建/`resume()`（在第一个 `await` 之前），否则 Chrome 的自动播放策略不给声音。请求进行中用户点了停止/换了选区/工具栏卸载时，用自增 token 让迟到的结果作废，别播放一段没人要的音频
- **`runtime.sendMessage` 走 JSON 序列化，二进制必须自己编码**: Chrome 的扩展消息管道对 `sendMessage`/`onMessage` 做的是 JSON 序列化（structured clone 只属于 `runtime.connect` 端口和 `postMessage`）。所以 `Promise<ArrayBuffer>` 这种返回类型到了 content script 就是 `{}`——症状是「HAR 里 200 audio/mpeg、日志全绿、按钮从朗读中变成朗读、就是没声音」，因为 `decodeAudioData({})` 抛 "parameter 1 is not of type 'ArrayBuffer'"，而 `{}` 的 `byteLength` 是 `undefined`，日志里只会看到莫名的 `in:undefined`。踩过一遍：`synthesizeSpeechAudio` 现在返回 **base64 字符串**，工具栏 `Uint8Array.from(atob(s), c => c.charCodeAt(0))` 还原成字节再喂 `decodeAudioData`。**给消息协议加返回类型时，先问一句「这个值 JSON 之后还在吗」**；测试里直接断言 `JSON.parse(JSON.stringify(payload))` 仍可用（`speech.test.ts` 的「returns a payload that survives the message channel」）。另外别指望 `chrome.permissions.contains` 在 headless 里说真话——无头 profile 里 host_permissions 可能显示未授予，于是 SW 的跨域 fetch 会被 CORS 拦成 "Failed to fetch"，跟真机表现不一致
- **`AudioBufferSourceNode` 忘记 `connect(context.destination)` 是静默故障**: `start()` 照常成功、`onended` 照常触发、没有任何报错，但一个音符都听不到——表现就是「请求成功了、按钮状态也变了、就是没声音」。测试里务必断言 `source.connect` 被调用过，光断言 `start()` 拦不住这个 bug
- **MV3 消息端口会在 handler 跑完之后才丢响应**: 用户看到的症状是「按钮显示翻译失败，但 HAR 里请求和响应全正常」——handler 完整执行了（fetch、解析、映射都成功），但 `sendMessage` 的 promise 以 "The message port closed before a response was received"/"No response" reject。这是 Chrome 给沉睡的 service worker 投递消息时的经典竞态，与本项目的业务代码无关。工具栏用 `withMessageRetry`（`message-retry.ts`）对这类传输层错误重试一次（worker 已热、且请求都是幂等 GET）；**真实错误不要重试**，直接抛。另外 UI 层 catch 务必带上 `error.message`（`翻译失败：${errorMessage(error)}`），否则端口竞态、handler 报错、provider 失败在界面上长得一模一样，只能靠用户截图猜
- **重新加载扩展后必须刷新页面，否则 content script 是孤魂野鬼**: Chrome 不会给已打开的标签页重新注入 content script——旧脚本继续跑、工具栏继续响应点击，但它所有的 `chrome.*` binding 已被拆除，任何调用都以 "Extension context invalidated"（或参数 shim 读不到 `.length` 抛的 TypeError）失败，而 background 根本没被唤醒（HAR 里什么都看不到）。`chrome://extensions` 的错误页会把这些未捕获的 rejection 列在对应页面 URL 下，是诊断这个问题的第一现场。防线有三层：`message-retry.ts` 靠 `chrome.runtime.id` 探测并把错误换成「扩展已重新加载，请刷新页面后重试」；工具栏每秒轮询同一个探针，一旦中招就把三个按钮换成可点击的「刷新页面」片（`selection-toolbar.tsx`）；两个 content script 的 `main()` 都包了 try/catch，启动期遇失效只打日志、不留未捕获异常。**每次 reload 扩展后都要 F5 页面**；跑 `pnpm dev` 时每次源码改动触发扩展自 reload，更要记得刷新页面
- **「扩展已重新加载，请刷新页面后重试」只有探针说了才算**: `message-retry.ts` 曾经还把 polyfill 那种 `Cannot read properties of undefined (reading 'length')` TypeError 也当失效信号——结果自家代码抛同一个 message 时（词典 payload 少一个 `examples` 字段，`toWordDefinition` 解引用 throws），用户被指去刷新一个根本没失效的页面，且刷新永远治不好。V8 的 TypeError 文案分不清是 binding shim 还是业务代码，所以**消息匹配只保留点名 binding 的那条**（`.sendMessage is not a function`），其余一律以 `isExtensionContextInvalidated()`（`runtime.id`/`sendMessage` 直接探）为准。同理，业务侧不能让畸形 payload 变成 throw：词典 backend 是用户自己跑的本地服务，entry 形状不统一（`phonetics`/`senses`/`examples` 都可能缺），`dict-api.ts` 的 `isUsableWordPayload` 按「至少一个 sense」判读并全链路可选链，`selection-translate.ts` 的 handler 也包 try/catch 返回 null——null 是工具栏唯一认识的「miss」，它自然会回落到 LLM 翻译
- **每次页面加载都会打一次 LLM 语言检测请求**（预存设计，不是划线翻译）: `host.content/runtime.ts` 结尾对 top frame 调 `detectAndReportPageLanguage` → `detectPageLanguageLightweight`（`utils/content/page-language.ts`）→ `detectLanguageWithSource` → `detectLanguageWithLLM`（`utils/content/language.ts`），页面正文 ≥80 字符就走 LLM。所以刷新任意网页都会看到一个 `/chat/completions` 请求——用户在排查工具栏问题时容易把它误当成「翻译按钮走了 LLM」。单次划词翻译的走向是：单词 → `translateSelectedTextStructured` → 本地词典 `{backendBaseUrl}/api/word/{word}`，返回 null 才回落到 LLM
- **划线的发音语言只能按文字脚本猜** (`guess-speech-lang.ts`): 假名→ja（要先于汉字判断，否则日语被当中文）、谚文→ko、汉字→zh、西里尔→ru 等；拉丁文字一律 `en`。页面语言不可靠（法文页面上的英文引语），脚本是唯一诚实信号
- **诊断「按钮报错但 HAR 全正常」时先看 `chrome://extensions` 的错误页**: 那里的 "Uncaught (in promise): Error: Extension context invalidated" + 堆桩指向哪个 content script，直接说明页面里跑的是**已被失效的旧脚本**（扩展被 reload 过而页面没刷新）。堆桩落在 bundle 的模块求值处（如 `selection.js:5:1`）说明是**启动期**就带着失效上下文在跑；此时 background 根本没被唤醒，HAR 自然什么都没有。content script 的 `main()` 全量 try/catch 可以把这种噪声挡在日志里
- **Edge 桌面应用（PWA 独立窗口）和其它标签页对 content script 一视同仁**: 从快捷方式启动的 PWA 窗口是全新页面加载，content script 注入时上下文健康，所以它"看起来正常"；而排查期间被反复 reload 扩展的老标签页脚本全部失效。别被"PWA 能用"误导——那通常只证明它是刚启动的。真正判断标准： reload 扩展后**每一个**开着的页面（含 PWA 窗口，Ctrl+R 或从快捷方式重启）都要刷新
- **胶囊跟着划线走，靠的是「滚动时重新量一次」而不是跟着滚动条平移**: `useTextSelection` 只在**选取那一刻**调一次 `range.getBoundingClientRect()`（viewport 坐标），所以滚动后必须重新量才追得上文字。三个坑：(1) 滚动监听必须 `capture: true`——`overflow:auto` 容器里的滚动事件根本不冒泡到 `window`，而页面里这种东西一片一片的；(2) 每个滚动事件都要付钱，所以用 rAF 合并成一帧一次，且 `lastRangeRef == null`（没选区/已关闭）时直接 return；(3) 点击 Shadow DOM 里的工具栏会清掉文档选区，所以钩子额外存了一份 `lastRangeRef`（cloneRange），滚动时「有活的选区就读活的，没有就读存的那份」——少了这一份，点完「翻译」再滚动，胶囊就钉死在原地不动了
- **wrapper 自身不能带 transform，否则结果卡片会从视口右侧被拽回划线旁边**: `position: fixed` 的子元素只在**祖先没有 transform/filter/will-change** 时才相对视口定位。承载胶囊的那个 wrapper 一旦带上 `translate(-50%,-100%)` 就成了 containing block，卡片那个 `position: fixed; right:16px; top:50%` 立刻变成相对 wrapper 的坐标，被死死按在划线下方。所以居中用的 transform 搬到了胶囊自己身上，wrapper 只留 `position/top/left/zIndex/pointer-events`。测试里直接断言 `wrapper.style.transform === ""`，这个回归没有别的前兆
- **划线工具栏的站点规则（`config.selection`）**: 规则存的是用户输入的域名，一条规则同时覆盖该域名**及其所有子域名**（`example.com` 也覆盖 `www.example.com`，跟 iframe 注入的 `matchDomainPattern` 同一套语义）；`notexample.com` 不被 `example.com` 覆盖。输入先过 `normalizeDomainRule`（去协议/路径/端口/通配前缀）再存，content script 用 `shouldShowSelectionToolbar` 决定挂不挂工具栏，并用 `storage.watch` 响应选项页里改的规则——改完不用刷新页面。**新加的配置段必须带 `.default()`**：`configSchema.safeParse` 失败会让 `getLocalConfig` 整份退回 `DEFAULT_CONFIG`，等于把用户其它设置全清了
- **欧路 OpenAPI 的写入语义是实测出来的，文档没写**: `POST /studylist/word` 对**已收藏**的词也是 upsert（能改星级），所以写回星级只用它一个接口就够了——**别碰 `POST /studylist/words`**，那个会把词**追加**进请求里指定的 `category_id`，是个副作用。另外省略 `context_line` 时原值保留、传空会清掉语境，所以改星级时不要带这个参数；任何写操作都会刷新 `add_time`，所以同步时绝不能覆盖已有行的 `created_at`（否则「按添加时间排序」会被写回打乱）。欧路返回的 `exp` 和 `context_line` 里带 HTML（`<br>` / `<b>`），必须清洗后再存，否则闪卡背面显示原始标签
- **`setx` 写的环境变量只对新进程生效**: 用户用 `setx EUDIT_API_KEY ...` 设了欧路 token，但**已经跑着的后端进程读不到**（进程启动时就把环境块拷走了）。改了环境变量必须重启后端（`script/stop_server.ps1` + `run_server.bat`），否则设置页里显示「未配置」而用户明明设了
- **欧路星级冲突用 `review_count` 裁决，不要盲写**: 欧路 App 里的星级可能比用户打的分旧。同步时的规则是「本地 `review_count = 0`（用户还没评过分）才采用欧路星级，`> 0` 就以本地为准」——用户的评分是主动行为，比远端状态更近。代价是**在欧路 App 里手动改星级不会回流到扩展**（欧路没给 `updated_at`），回流会造成两边乒乓
- **FastAPI 的 `response_model` 会把没声明的字段悄悄丢掉**: 写操作的响应里想带回 `eudic_sync`，光 `return {**record, "eudic_sync": ...}` 是不够的——`response_model` 里没这个字段，pydantic 会在序列化时把它裁掉，前端收到的是 `null`/缺失，还以为「没同步」和「同步成功」长得一样。要新加响应字段，先把它加进对应的 response model
- **同一个网址在浏览器里好使、在 Python 里却抽风——先怀疑 TLS 版本，不是网络**: 欧路接口（`api.frdic.com`）在这条链路上，**OpenSSL 的 TLS 1.3 ClientHello 会被中间设备掐断**，握手直接报 `UNEXPECTED_EOF_WHILE_READING`。实测同一个请求：允许 TLS 1.3 时成功率 30%，把上限压到 **TLS 1.2** 之后 100%。.NET（浏览器、PowerShell、curl）不受影响，因为它们的 ClientHello 长得不一样——所以「浏览器里好好的」完全不能证明网络没问题。`mdx/app/eudic.py` 里 `_ssl_context()` 就是干这个的（`EUDIC_TLS_MAX=1.3` 可以放开）。**排查手法**：同一个 URL 分别用 Python 和 PowerShell 各打 20 次，成功率一对比就知道是 TLS 栈还是网络路由
- **httpx 的 `trust_env=True` 在你这台机器上是坏的**: 它解析 `NO_PROXY` 时碰到 `[::1]` 这种带方括号的 IPv6 会抛 `InvalidURL: Invalid port: ':1]'`。所以 `mdx/app/eudic.py` 自己从环境变量里取代理 URL、直接塞给 httpx 的 `proxy=` 参数，绕开那个坑（`trust_env` 保持 `False`）
- **传输层错误必须归一化成自己的异常类型**: `httpx.ConnectError` 之类直接穿到 FastAPI 就是裸的 `500 Internal Server Error`（`text/plain`，连原因都没有），用户只能看着一个「失败」。`mdx/app/eudic.py` 把它们统一成 `EudicNetworkError`（`EudicError` 的子类），路由层转成 502 + 中文原因；**只重试传输层错误**（连接被掐断、超时），HTTP 层的 4xx/5xx 是欧路明确拒绝，重试只是浪费时间
