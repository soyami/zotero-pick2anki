# zotero-pick2anki

> **Zotero 划词词典插件**：在内置 PDF / EPub 阅读器里选中英文单词或短语 → 5 个在线词典源聚合释义 → 一键通过 AnkiConnect 写入 Anki 生词卡（原句就是你在文献里选中的那句话）。

---

## 它解决什么问题

读英文文献的痛点是二段式的：**查词**（PDF 阅读器里选一个词，想要即时的多源释义）和**制卡**（把这个词连同它出现的原句一起，变成 Anki 里复习的卡片）。Zotero 生态里这两步目前是断开的：翻译插件帮你读懂句子，但不会替你攒生词卡。

zotero-pick2anki 只做这一条链路：**划词 → 聚合释义 → 写卡**，不做整句翻译、不需要任何 AI / 翻译 API Key。

## 与 zotero-pdf-translate 的关系（互补，可共存）

| | [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) | **zotero-pick2anki（本插件）** |
|---|---|---|
| 面向对象 | 整句 / 整段 | 英文单词、短语 |
| 输出 | 译文（DeepL / 有道 / GPT …） | 多源词典聚合释义 + 音标 + 例句 |
| 落点 | 阅读器内的译文面板 | **Anki 生词卡**（AnkiConnect 直连） |
| 需要 Key | 多数服务需要 | **不需要**（5 个公开词典源） |
| 定位 | 读懂**这一段** | 记住**这个词** |

两者都在 Zotero 划词弹窗里追加自己的面板（同一种官方 API：`Zotero.Reader` 的 `renderTextSelectionPopup` 事件），所以可以同时启用：它显示译文，本插件显示词典释义与 ➕ Anki 按钮，互不干扰。

> 许可证差异（重要）：zotero-pdf-translate 是 **AGPL-3.0-or-later**，不是 MIT。本项目只参考了它公开的架构思路（复用 Zotero 官方划词弹窗、给面板内控件做事件隔离），**没有复制其任何代码**，因此本项目仍可按 MIT 分发。若你打算从它那里抄代码，请先把本项目改成 AGPL-3.0。

## 功能

| 功能 | 说明 |
|---|---|
| **多源词典聚合** | 划选英文单词/短语即弹出聚合释义，内置 5 个源：有道（含柯林斯英汉双解授权数据）、柯林斯英汉双解官网、牛津高阶学习者词典、必应（英汉）、剑桥。源可启停、可拖拽排序；弹窗只完整展开排在最前且可用的 2 个源，避免刷屏 |
| **只查英文单词/短语** | 复用 Pick2anki 的判断：中文、整段文字、超过 5 个词或 60 字符的选区不触发 |
| **Anki 一键写卡** | 通过 AnkiConnect 直连本地 Anki（默认 `127.0.0.1:8765`），无需额外插件。写入指定牌组与笔记类型，弹窗按钮实时反馈：写入中 → ✔ 成功 / ↺ 已存在 |
| **字段映射（9 种固定内容 → 你的模板字段）** | 单词/词组、原句、音标、单一释义、全部释义、例句、额外信息、音频、来源。读取你笔记类型的字段后用下拉逐一映射；留空 = 不写入；同一字段被多个内容指向时自动合并 |
| **发音** | 词典真人发音优先（英/美），失败依次回退 Edge TTS 与有道发音接口；音频经 AnkiConnect 存入 Anki 媒体库（`[sound:…]`），离线可播 |
| **语境与来源** | 原句优先取该词在 PDF 中的**完整句子**（文本层扩写，失败回退为选中文本）；来源字段写入命中的词典链接 + 文献条目的 `zotero://` 链接 + 《标题》· 作者 · 年份 |
| **中文界面 + 与 Obsidian 版同键名** | 设置项键名、默认值与 Obsidian 版完全一致，并支持直接粘贴 Obsidian 版 `data.json` 一键迁移 |
| **轻量** | 无 AI / 长句翻译依赖、无缓存、无外部服务、无 API Key |

## 安装

### 方式一：安装 .xpi

1. 下载 `zotero-pick2anki.xpi`（本项目构建产物在 `.scaffold/build/zotero-pick2anki.xpi`）
2. Zotero → **工具 → 插件**（Zotero 10 里叫「插件」，7–9 里叫「附加组件」）
3. 右上角齿轮 → **Install Plugin From File…**（从文件安装插件），选择该 .xpi
4. 重启 Zotero → 工具 → 插件 里应出现 **Pick2anki**
5. Zotero → 编辑 → 设置 → **Pick2anki**，配置词典源与 Anki 写入

> 未签名的 .xpi 可以直接安装：Zotero 关闭了 `xpinstall.signatures.required`，无需 Mozilla 签名。

### 方式二：从源码构建（开发者）

```bash
npm install                 # 需要 Node ≥ 22.8（zotero-plugin-scaffold 要求）
npm run build               # tsc 类型检查 + zotero-plugin-scaffold 打包
# 产物：.scaffold/build/zotero-pick2anki.xpi（以及未打包的 .scaffold/build/addon/）

npm run icons               # 重新生成插件图标（可选，纯 Node 画图，无图形库依赖）
npm test                    # 集成自测：真实网络查词 + 真实 AnkiConnect 写卡（需 Anki 正在运行）
npm start                   # 开发模式：自动拉起 Zotero 并热重载（需 .env 指定 Zotero 路径）
```

`npm start` 需要 `.env`（参考 zotero-plugin-scaffold 模板）：

```ini
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=C:\Program Files\Zotero\zotero.exe
ZOTERO_PLUGIN_PROFILE_PATH=            # 可选：指定测试用 profile
ZOTERO_PLUGIN_DATA_DIR=                # 可选：指定测试用数据目录
```

### 发布

仓库：<https://github.com/soyami/zotero-pick2anki>

```bash
npm run build                       # 产出 .scaffold/build/zotero-pick2anki.xpi 与 update.json
# 1) 把 .xpi 挂到 GitHub Release（标签如 v1.0.7）
# 2) 把 .scaffold/build/update.json 挂到 release 标签（Zotero 通过 manifest 里的 update_url 读取它）
```

`update.json` 由 zotero-plugin-scaffold 生成，含版本号、下载地址、sha512 与兼容区间。它的用处有两点：一是让已安装的用户收到新版本提示；二是**在不重新发 .xpi 的情况下放宽 `strict_max_version`**，使插件在未来的 Zotero 大版本里继续可用（Zotero 的插件版本区间由这份清单动态决定）。

## 使用

### 1. 划词查词

在内置阅读器（PDF / EPub）里**选中英文单词或短语**，划词弹窗中会出现「📖 在线词典」区块：

- 释义区渲染词性徽章（noun / adj. …）、英中分色释义、紧跟释义的例句列表，命中词加粗
- 超过设置的高度上限（默认 260px）时区块内滚动，不会把弹窗撑长
- 触发模式为「直接选中」时立刻联网查询；为「Ctrl+选中（手动点查词）」时先显示「🔍 查词」按钮，点击后才查询

设置 → Pick2anki → 在线词典查词：可拖拽调整源顺序、行尾开关停用某个源，点「试查 hello」验证网络连通。

> 柯林斯/牛津/剑桥官网存在反爬或改版，失败时插件会自动跳过该源并继续其它源（自测中就有源返回 403）。有道、必应最稳定。

### 2. 写入 Anki

前置：安装 Anki 桌面版并启用 AnkiConnect 插件（Anki → 工具 → 插件 → 获取插件，代码 `2055492159`）。

设置 → Pick2anki → 写入 Anki 单词卡：

1. 打开「启用 Anki 写卡」→ 点「测试连接并读取」获取牌组/笔记类型
2. 选择目标牌组（子牌组用 `::` 分隔）与笔记类型（切换时会自动读取其字段）
3. 在「模板字段映射」里，为每个内容用下拉选择你模板中的字段（留空 = 不写入）
4. 可选：开启「查词后自动写卡」、设置重复卡片处理（跳过 / 仍然添加）、查重范围、卡片标签
5. 点「写入测试卡（hello）」可完整自测一遍：查词 → 写卡（写入上面选定的牌组/模板）

读取器里的划词弹窗右下角会出现 **➕ Anki** 按钮，点击即写卡；按钮会依次变成 ⏳ → ✔（成功）/ ↺（已存在）/ 回到 ➕（失败，右下角同时弹出错误提示）。

**推荐的字段映射**（对应 Pick2anki 官方推荐模板的 9 个字段）：

| 内容源 | 推荐字段 | 说明 |
|---|---|---|
| 单词/词组 | `Word` | 所查的单词/词组 |
| 原句笔记 | `Context` | PDF 中选中该词的句子（原句即选中文本；开启「原句扩写」后尽量取完整句子）+ 文献条目信息 |
| 发音音标 | `Phonetic` | 英/美 IPA 音标（多源去重拼接） |
| 单一释义 | `SingleDef` | 首个简明释义 + 它自己的例句 |
| 全部释义 | `AllDefs` | 所有可用源的完整释义，多源带源名标题 |
| 例句 | `Examples` | 例句已内嵌在释义下方，通常无需单独映射 |
| 额外信息 | `Extra` | 词形变化 / 常用搭配 / 考试范围标签 |
| 音频文件 | `Audio` | 经 AnkiConnect 存入媒体库，卡片里是 `[sound:….mp3]` |
| 来源地址 | `Source` | 词典链接 + 文献条目的 `zotero://` 链接 + 条目信息 |

> 「单一释义」与「全部释义」建议二选一（推荐模板的逻辑是 AllDefs 有内容时优先，为空才回退 SingleDef）。

### 3. 设置项一览（与 Obsidian 版 Pick2anki 键名一致）

| 设置项 | 键名 | 默认值 | 说明 |
|---|---|---|---|
| 触发模式 | `triggerMode` | `direct` | `direct` 直接选中即查词；`ctrl` 弹窗内手动点「查词」 |
| 触发延迟 | `triggerDebounce` | `500` | 保留位（与 Obsidian 版 schema 对齐；Zotero 由事件驱动，无需防抖） |
| 词典源与顺序 | `onlineDictSources` | 有道→必应→剑桥→柯林斯→牛津 | 可停用、可拖拽排序 |
| 启用 Anki 写卡 | `ankiEnabled` | `false` | |
| 本地桥接地址 | `ankiConnectUrl` | `http://127.0.0.1:8765` | AnkiConnect 地址 |
| 目标牌组 / 模板 | `ankiDeck` / `ankiNoteType` | 空 | 从 Anki 读取后下拉选择 |
| 字段映射 | `ankiFieldMap` | `{}` | 内容源 → 模板字段名 |
| 查词后自动写卡 | `ankiAutoAdd` | `false` | |
| 重复卡片处理 | `ankiDup` | `skip` | `skip` 跳过 / `add` 仍然添加 |
| 查重范围 | `ankiDupScope` | `deck` | `deck` 仅当前牌组 / `model` 整个模板 |
| 卡片标签 | `ankiTags` | `pick2anki` | 逗号分隔 |

Zotero 专属项（Obsidian 版没有，均有默认值，不影响原有键）：

| 设置项 | 键名 | 默认值 | 说明 |
|---|---|---|---|
| 弹窗宽度 | `popupWidth` | `400` | 面板固定宽度(px)，限制 240–720 且不超过阅读区宽度；插件会同步把宿主弹窗的 198px 上限抬到「面板宽 + 20px」 |
| 弹窗整体最大高度 | `popupMaxHeight` | `260` | 面板总高度上限(px)；实际还受"阅读区高度 45%"约束，标题/按钮固定可见，只有释义区滚动 |
| 原句扩写 | `sentenceExpand` | `true` | 优先取 PDF 文本层里含该词的完整句子，取不到则回退为选中文本 |
| 附带文献条目信息 | `showCite` | `true` | 原句/来源字段附带《标题》· 作者 · (年份) |
| Edge TTS 发音兜底 | `edgeTtsFallback` | `false` | 发音兜底链的最后一步（见「已知限制」1）；默认关闭以免拖慢写卡 |

设置存在 Zotero 偏好里（`about:config` → `extensions.zotero.zoteropick2anki.*`），数组/对象以 JSON 字符串存放。

### 4. 从 Obsidian 版 Pick2anki 迁移

设置 → Pick2anki → **迁移 / 备份** → 把 `<你的库>/.obsidian/plugins/pick-to-anki/data.json` 的全部内容粘贴进「导入设置」文本框 → 点「导入」。

两版设置键名完全一致，因此词典源顺序、启停、Anki 牌组/模板/字段映射、标签等会直接迁移过来（无法识别的键会被忽略）。

## 架构

### 目录

```
zotero-pick2anki/
├── addon/                          # 会被原样打包进 .xpi 的静态资源（Zotero 侧）
│   ├── manifest.json               # 插件元数据（构建时替换 __占位符__）
│   ├── bootstrap.js                # Zotero 引导脚本（注册 chrome:// 包 → 加载插件入口 → 调钩子）
│   ├── prefs.js                    # 默认偏好（构建时自动加 extensions.zotero.zoteropick2anki. 前缀）
│   └── content/
│       ├── preferences.xhtml       # 设置面板 fragment（XUL 默认命名空间）
│       ├── zopick2anki.css         # 弹窗 + 设置面板样式（同一份文件两处复用）
│       └── icons/                  # 图标（scripts/make-icons.mjs 生成）
├── src/
│   ├── index.ts / addon.ts / hooks.ts     # 插件入口、实例、生命周期钩子
│   ├── types.ts                           # HTTP 层共享类型
│   └── modules/                            # 词典与写卡逻辑（多为 Pick2anki 原样移植）
│       ├── dict-types.ts  online-dict.ts  dict-utils.ts  dict-html.ts  dict-render.ts
│       ├── youdao-dict.ts collins-dict.ts oxford-dict.ts bing-dict.ts cambridge-dict.ts
│       ├── anki.ts  edge-tts.ts  settings.ts  settings-store.ts
│       ├── http.ts  env.ts  sha256.ts  zdom.ts  styles.ts   # 新增：Zotero 宿主适配层
│       └── reader.ts  prefs-ui.ts  api.ts  item-context.ts  sentence.ts
├── typings/                        # 最小 Zotero 全局声明 + 插件全局声明
├── scripts/                        # 图标生成、自测运行脚本
├── test/                           # 集成自测（Zotero 环境桩 + 真实链路验证）
└── zotero-plugin.config.ts  tsconfig.json  package.json
```

### 从 Pick2anki 复用的文件（对照表）

| Pick2anki 源文件 | 新项目位置 | 移植处理 |
|---|---|---|
| `src/dict-types.ts` | `src/modules/dict-types.ts` | **原样复制**（统一 schema / DictAdapter 契约，一字未改） |
| `src/online-dict.ts` | `src/modules/online-dict.ts` | **原样复制**（适配器注册表、并发查词、聚合、bundle* 字段提取） |
| `src/youdao-dict.ts` | `src/modules/youdao-dict.ts` | **原样复制**（含柯林斯英汉双解解析） |
| `src/collins-dict.ts` | `src/modules/collins-dict.ts` | **原样复制** |
| `src/oxford-dict.ts` | `src/modules/oxford-dict.ts` | **原样复制** |
| `src/bing-dict.ts` | `src/modules/bing-dict.ts` | **原样复制** |
| `src/cambridge-dict.ts` | `src/modules/cambridge-dict.ts` | **原样复制** |
| `src/dict-html.ts` | `src/modules/dict-html.ts` | **原样复制**（Anki 字段的内联样式 HTML、命中词加粗） |
| `src/dict-utils.ts` | `src/modules/dict-utils.ts` | 只改两处环境依赖：`requestUrl` 改为转发 `http.ts`；`parseHtml` 从 Zotero 主窗口借 `DOMParser`（其余解析工具函数原样保留） |
| `src/settings.ts` | `src/modules/settings.ts` | 原有键名/默认值/标签常量**一字未改**，仅在末尾追加 3 个 Zotero 专属项 |
| `src/anki.ts` | `src/modules/anki.ts` | 替换环境依赖：`requestUrl`→`http.ts`、`crypto.createHash("md5")`→`sha256.ts`、`btoa`→`env.bytesToBase64`；新增可选 `cite`（文献条目信息）用于原句/来源字段，并新增 HTTP 兜底发音 |
| `src/edge-tts.ts` | `src/modules/edge-tts.ts` | 协议（Sec-MS-GEC / SSML / 时间戳怪癖）**逐字节保留**；环境适配：Node `ws`→浏览器 `WebSocket`、Node `crypto`→纯 TS SHA-256、返回 `Blob`→`Uint8Array`、自定义请求头→Cookie 服务注入 |
| `src/main.ts` 的划词触发/弹窗 | `src/modules/reader.ts` | 触发源由 `document mouseup` 改为 `Zotero.Reader` 的 `renderTextSelectionPopup` 事件；弹窗由自建浮层改为追加进 Zotero 划词弹窗；按钮状态机（➕/⏳/✔/↺）与自动写卡逻辑沿用 |
| `src/main.ts` 的设置页 | `src/modules/prefs-ui.ts` | Obsidian `PluginSettingTab` → Zotero 偏好面板；分组、名称、说明文字、拖拽排序、连通性自测、试写测试卡全部对齐 |
| `src/main.ts` 的 `extractSentenceAround` | `src/modules/sentence.ts` | 逻辑保留，**新增英文句末切分**（原版只按中文标点切句，用于英文 PDF 会把上一句带进来） |
| `src/main.ts` 的 `loadSettings/saveSettings` | `src/modules/settings-store.ts` | `data.json` → Zotero 偏好（键名一致、数组/对象存 JSON），并新增 Obsidian `data.json` 导入 |
| `styles.css` | `addon/content/zopick2anki.css` | 类名与视觉规则保留；为 Zotero 补齐同名主题变量、新增设置面板样式 |

### 新写的文件（Zotero 宿主适配）

| 文件 | 职责 |
|---|---|
| `src/modules/http.ts` | **网络层适配**：`Zotero.HTTP.request` 封装（浏览器 UA、`successCodes:false` 语义对齐 `requestUrl` 的 `throw:false`、网络错误仍抛出、二进制下载） |
| `src/modules/env.ts` | 沙箱环境适配：主窗口 `DOMParser`/`WebSocket`/`crypto`、定时器、base64、随机串、日志 |
| `src/modules/sha256.ts` | 纯 TS SHA-256（Edge TTS 鉴权 + 音频文件名哈希，替代 Node `crypto`） |
| `src/modules/zdom.ts` | DOM 构造工具，替代 Obsidian 的 `createDiv/createEl` 扩展；按文档类型选择 XHTML 命名空间（偏好面板是 XUL 文档） |
| `src/modules/styles.ts` | 把 CSS 作为文本注入 reader 的 iframe（esbuild `text` loader） |
| `src/modules/reader.ts` | reader 划词事件注册、弹窗 DOM、查词与写卡编排、原句扩写、样式注入 |
| `src/modules/prefs-ui.ts` | 设置面板 UI（中文，分组与文案对齐 Obsidian 版） |
| `src/modules/api.ts` | 面板与插件本体之间的 API（面板 onload 调用 `Zotero.<addonInstance>.api.*`） |
| `src/modules/item-context.ts` | Zotero 文献条目信息（标题/作者/年份/`zotero://` 链接） |
| `src/modules/sentence.ts` | 原句提取（含英文句末切分） |
| `src/index.ts` `src/addon.ts` `src/hooks.ts` | 插件入口/实例/生命周期（沿用 zotero-plugin-template 的组织方式） |
| `addon/*`、`typings/*`、`scripts/*`、`test/*`、`zotero-plugin.config.ts` | 打包脚手架、类型声明、图标生成、自测 |

## 已知限制

1. **Edge TTS 在 Zotero 里属于“尽力而为”**：浏览器的 WebSocket 不能自定义 `Cookie` / `Origin` / `User-Agent`，而微软的 Edge TTS 接口要求带 MUID cookie。本插件改用 Cookie 服务注入 MUID（`src/modules/edge-tts.ts` 的 `ensureMuidCookie`），但若服务端仍因缺少 Origin 而拒绝，就会失败。因此发音链是 **词典 mp3 → 有道发音接口（HTTP，8s 超时）→ Edge TTS（默认关闭，可在设置里开启）**，由 `anki.ts` 的 `storeAudio` 依次尝试，任一成功即写入卡片；全部失败只是跳过「音频」字段，不影响写卡。
2. **原句扩写是启发式的**：PDF 文本层的拼接方式因版面而异，插件会校验「扩写出的句子必须真的包含该词且长度合理」，不满足就回退成**你选中的文本本身**。EPUB 的 DOM 差异较大，默认更容易回退。可在设置里关闭「原句扩写」。
3. **词典源反爬**：柯林斯/牛津/剑桥官网随时可能改版或返回 403（自测里柯林斯就返回了 403）。失败只影响该源。
4. **只处理英文单词/短语**：中文、整段、超过 5 个词或 60 字符不触发（与 Obsidian 版一致）。
5. **需要 Zotero 7 及以上**（`strict_min_version: 7.0`，`strict_max_version: 10.9.9`）；安装前请确认版本落在区间内，否则 Zotero 会判定不兼容。
6. **`update_url` 与发布**：Zotero 强制要求 manifest 里有 `update_url`，本项目的更新清单地址指向 `https://github.com/soyami/zotero-pick2anki/releases/download/release/update.json`。在发布 `update.json` 之前，Zotero 的更新检查会 404（不影响使用，只是查不到新版本）；发布方式见下节「发布」。
7. **AnkiConnect 端口/CORS**：默认 `127.0.0.1:8765`。若修改过 AnkiConnect 的 `webCorsOriginList` 且出现被拒提示，把 `*` 或来源加进白名单（Zotero 的特权请求通常不带 `Origin`，正常情况下无需改动）。

## 更新记录

### v1.0.6 — 修「原句只抓到选中的那个单词」

| 反馈 | 成因 | 修法 |
|---|---|---|
| 原句抓不到内容，写进卡片的 `Context` 只有查的那个词 | **文本层不在划词事件给的那个文档里**。Zotero 的 PDF 阅读器是两层文档：划词弹窗在"阅读器文档"（`event.doc`），而 pdf.js 的文本层在它的**内层 iframe** 里。v1.0.0–v1.0.5 只查了 `event.doc`，于是 `.page` / `.textLayer` / `getSelection()` 全部落空，每次都走"回退为选中文本"分支 | 新增 `src/modules/page-text.ts`，完全按 Zotero 自己的取法定位：`[data-page-number="${pageIndex+1}"] .textLayer`（pageIndex 来自 `annotation.position.pageIndex`），并会**递归钻进内层 iframe** 找文档；取到文本后按"空格拼接 / 原样拼接"两种方式找词，再用新的 `sentenceAround()` 按命中位置截句。另外 `findTerm()` 能容忍 pdf.js 把词拆到相邻 span 造成的空隙（`cata`+`lyses` → `cata lyses` 也能命中）。文档里再找不到时才回退为选中文本，并往调试日志写明原因 |

> 顺带说明：原句现在来自**页面文本层**，所以扫描版 PDF（没有文字层）依旧只能回退成选中文本——这是 PDF 本身没有文字信息，不是插件问题。

### v1.0.5 — 设置面板改为「上下堆叠」版式

| 反馈 | 处理 |
|---|---|
| 设置界面原来是左右两栏（名称在左、控件在右），想改成上下排列 | 每个设置项改成单栏堆叠：**设置名称（加粗）→ 实际控件 → 说明文字（小灰字）**。实现上是纯 CSS：`.zp-row` 改为纵向 flex，说明用 `order: 2` 排到控件之后（DOM 顺序不变，所以 `prefs-ui.ts` 的调用顺序、以及"只有说明没有控件"的信息行都不受影响）。字段映射那张表也从「150px + 1fr」两列网格改成同样的堆叠（名称 → 下拉 → 说明）；导入 / 恢复默认值两个按钮改为横向排列（`.zp-btn-bar`） |

### v1.0.4 — 修「改了宽度设置没反应」

| 反馈 | 成因 | 修法 |
|---|---|---|
| 自定义弹窗宽度后，面板宽度没有任何变化 | **Zotero 自己把划词弹窗写死在 198px**：本机 Zotero 10 的 `resource/reader/reader.css` 里是 `.selection-popup{max-width:198px;padding:8px;gap:8px}`，内容区实际只有约 182px。我们的面板再宽也被这个上限压回去——v1.0.3 的 360→400 其实也没生效，"有点小"的感觉就来自这里 | 检测到划词弹窗后，把它的 `max-width` 改成**有边界的定值**「面板宽 + 20px」（并 clamp 到阅读区宽度），以 `!important` 写入，保证与 zotero-pdf-translate（它会写 `max-width:none`）无论谁先执行都由我们收口。关键区别：v1.0.0 用的是**无上限**的 `none`（于是被长释义撑爆、盖住整页），现在是**带数值的上限**（不可能撑爆，且随设置联动）。同时去掉我们自己多画的一条分隔线——Zotero 的 `.custom-section` 已自带 |

> 补充：这条 198px 也是 v1.0.1「弹窗过大」的半个原因——当时用 `max-width:none` 解开了上限，但面板自己又是 `width:100%`，宿主弹窗便按内容 max-content 一路撑开。现在「上限有数值 + 面板有定宽」两条同时成立，才不会互相放大。

### v1.0.3 — 弹窗宽度可调（默认 400px）+ 自测词换成超长单词

| 反馈 | 处理 |
|---|---|
| 关掉 zotero-pdf-translate 后，词典面板显得偏小 | 面板定宽 360px → **400px**，并升级为设置项「弹窗宽度(px)」（默认 400，限制 240–720，且不超过阅读区宽度）。宿主划词弹窗是按内容撑开的，所以面板必须定宽；之前保守取值是为了兼容另一个插件的宽度，现在你可以按自己的习惯调 |
| 小巧思：设置页的测试写入词用 `hippopotomonstrosesquippedaliophobia` | 「端到端自测」改用这个词（长词恐惧症，34 个字母）。实测发现**它对所有词典源都是超纲词**：有道只返回维基摘要、必应返回"无结果 + 推荐"页，因此各源都拿不到释义——这反而是个绝佳的边界样本，所以自测逻辑做成：先查它 → 无释义时把各源原因写进状态行 → **自动回退到 `hello` 完成写卡**，并注明"该长词未收录，属预期"。这样按钮在任何网络下都能完成自测，同时顺带压测了超长单词的排版换行与音频文件名截断（实测写入 `[sound:p2a-hippopotomonstrosesquipp-914a6951.mp3]`，文件名被正确截断到 24 字符） |

### v1.0.2 — 释义从顶部开始显示

| 反馈 | 成因 | 修法 |
|---|---|---|
| 弹窗里的释义停在**底部**，要手动往上滚才能从第一条读起 | 从 Obsidian 版移植时保留了它的 `scrollToBottom`：Obsidian 版是**边查边追加**（流式），滚到底部才合理；Zotero 版是**一次性渲染**完整结果，滚到底反而让人先看到最后一条释义 | 渲染完成后回到顶部（`scrollTop = 0`），并补了「首屏必须是排序最前的可用源、且释义在例句之前」的回归测试 |

### v1.0.1 — 修 3 个实测反馈的问题

| 反馈 | 成因 | 修法 |
|---|---|---|
| ① 词典弹窗太大、几乎盖住整个 PDF，连 ➕ Anki 按钮都被遮住；同时 zotero-pdf-translate 的弹窗也被撑大 | 两个插件共用同一个划词弹窗容器（`.selection-popup`）。v1.0.0 为了让长释义放得下，把宿主弹窗的 `max-width` 改成了 `none`，弹窗便按内容 max-content 撑开；而词典面板自己写的是 `width: 100%`，进一步放大；按钮行位于内容末尾，被挤出可视区域 | ① 不再改动宿主弹窗任何样式（回归测试已锁死）；② 面板改为**定宽 360px**；③ 面板总高度 = `min(设置值, 阅读区高度 × 45%)`，内部用纵向 flex：标题行/按钮行固定不压缩，**只有释义区滚动** → ➕ Anki 永远可见；④ 设置项改名为「弹窗整体最大高度」 |
| ② 写卡成功后还弹系统小窗口；➕ Anki 按下后很久才变 ✔ | ① v1.0.0 在读者弹窗里用了 Zotero 的进度窗口（ProgressWindow）做提示；② 写卡链路里音频最慢（最多 4 个候选 × 30s 超时 + Edge TTS 30s） | ① **全面改为面板内联提示**：成功完全静默（只有按钮变 ✔），失败/已存在显示在面板内一行小字，不再弹任何浮窗；② 按钮上回显阶段（`⏳ 音频…` / `⏳ 写卡…`）；③ 音频候选减到 2 个、单个超时 8s，HTTP 兜底优先，Edge TTS 改为**默认关闭**的设置项（原来它可能白等 30s） |
| ③ 设置面板里点「测试连接并读取」后设置窗口像被关掉了 | 同样源于进度窗口：Zotero 的 ProgressWindow 挂在**主窗口**上，弹出时会抢走焦点，偏好窗口就被顶到主窗口后面，看起来像被关闭 | ① 设置面板内**不再使用任何系统浮窗**，结果全部显示在面板内的状态行/结果区；② 异步操作完成后**不再整体重建面板**（只重建受影响的分区），保持偏好窗口 DOM 稳定；③ 所有异步回调包 try/catch，异常只写状态行 |

> 顺带删除了 `src/modules/notify.ts`（v1.0.0 的通知封装）：全面内联化之后它已无用武之地。

### v1.0.0 — 首个版本

从 Obsidian 插件 Pick2anki 移植，功能对齐（5 源聚合查词 + 9 种内容源写卡 + 中文设置面板）。

---

## 验证记录

### 已自动化验证（`npm test`，真实网络 + 真实 AnkiConnect）

`npm test` 会把插件源码打成 Node 可执行文件，用 `test/zotero-stub.ts` 提供最小 `Zotero.HTTP` / `Zotero.Prefs` / `getMainWindow` 桩，然后跑完整链路。**最近一次结果：96/96 项通过**，覆盖：

| 环节 | 结果 |
|---|---|
| SHA-256（Edge TTS 鉴权依赖） | 与 Node `crypto` 逐字节一致（含 UTF-8、跨 64 字节块边界共 6 组） |
| `canUseOnlineDict` 触发判断 | 10 个用例全部符合预期（英文单词/短语触发，中文/整段/超长不触发） |
| 5 个词典源真实查词 | 有道 ✅ / 必应 ✅ / 剑桥 ✅ / 牛津 ✅ / 柯林斯 ❌ 403（自动跳过），成功 4/5 |
| 设置读写与迁移 | 默认值往返、单项修改持久化、非法字段映射键被过滤、Obsidian `data.json` 导入 12 项 ✅ |
| 原句提取 | 英文句号切分正确、中文标点行为保留、无匹配返回空 |
| 9 种内容源 HTML | 单一释义/全部释义/例句/额外信息全部生成正确（内联样式、命中词加粗、HTML 转义） |
| 划词弹窗渲染器（jsdom） | 只展开前 2 个源、样式类齐全、命中词加粗、“另有 …”提示、全部失败时的说明 |
| 划词弹窗结构与样式约束（jsdom，模拟 `renderTextSelectionPopup` 事件） | 面板含标题行/释义区/按钮行/内联提示行；Ctrl 模式显示「查词」按钮且不自动联网；启用写卡时显示 ➕ Anki；面板高度受「设置值」与「视口 45%」双重约束；面板为定宽 360px；**回归项：不再改写宿主划词弹窗的样式**；样式注入与静默提示行 |
| AnkiConnect 写卡（真实 Anki） | 连接 ✅（version 6）→ 读取 9 字段模板「Pick2anki」→ 写入卡片 → 校验 9 个字段内容（Word/Context/Phonetic/SingleDef/AllDefs/Examples/Extra/Audio/Source）→ 音频入库 `[sound:p2a-hello-28bb9761.mp3]` → 重复策略 skip/add 行为正确 → **删除测试卡片、媒体文件与测试牌组，不留痕** |

实测写入 Anki 的字段内容（`hello`，模板 Pick2anki）：

```
[Word]      hello
[Context]   She said hello to everyone in the room before the meeting started.
            —— 来自 《自测文献标题》· Smith, J. et al. (2024) ·《Journal of Testing》
[Phonetic]  /heˈləʊ/ · UK /həˈləʊ/ · US /heˈləʊ/ · UK /heˈləʊ/ · US /heˈloʊ/
[SingleDef] <div style="margin:3px 0;line-height:1.5;"><span style="…background-color:#0d47a1…">int.</span>…
[AllDefs]   <div style="font-weight:600;color:#0d47a1…">有道词典（含柯林斯英汉双解）</div>…
[Examples]  <ul style="…list-style:square inside…">…
[Extra]     <div style="color:#666…">词形：hellos</div>…
[Audio]     [sound:p2a-hello-28bb9761.mp3]
[Source]    有道词典（含柯林斯英汉双解）：https://dict.youdao.com/result?word=hello&lang=en
            必应词典（英汉）：https://cn.bing.com/dict/search?q=hello
            …
            条目链接：zotero://select/library/items/TESTKEY
            《自测文献标题》· Smith, J. et al. (2024) ·《Journal of Testing》
```

### 已自动化验证的宿主侧（构建产物结构）

构建产物结构（`.xpi` 内为根级 `manifest.json` + `bootstrap.js` + `prefs.js` + `content/**`）已核对；`prefs.js` 的键前缀（`extensions.zoteropick2anki.`）与 manifest 的必填字段（`applications.zotero.id` / `update_url` / `strict_max_version`）均符合 Zotero 的插件校验要求 —— 这一点很关键：Zotero 会**强制要求** `update_url`，缺了会被判为「插件无效」而无法安装。

### 已在真实 Zotero 中验证（隔离 profile 加载测试）

本机装有 Zotero **10.0.1**（Windows）。做法：在项目的临时目录里建一个**隔离的 profile 与数据目录**（不碰你现有的 Zotero 库），把构建产物以 `profile/extensions/zoteropick2anki@local.xpi` 方式旁加载，用 `-ZoteroDebugText` 启动 Zotero 抓取调试输出，最后关闭进程（这段加载测试脚本属于本地工具，未纳入仓库）。最近一次结果：

| 检查项 | 实测结果 |
|---|---|
| 插件被 AddonManager 收录 | `zoteropick2anki@local` version 1.0.6，`location=app-profile`，**active=True** |
| bootstrap 启动钩子被调用 | `Calling bootstrap method 'startup' for plugin zoteropick2anki@local version 1.0.6 with reason APP_STARTUP` |
| 设置从 Zotero 偏好正确读出 | `[zopick2anki] 设置已加载：词典源 [youdao, bing, cambridge, collins, oxford]，Anki 写卡 未启用` |
| 设置面板注册 | `[zopick2anki] 设置面板已注册：Zotero 设置 → Pick2anki` + Zotero 侧 `Plugin zoteropick2anki@local registered preference pane plugin-pane-… ("Pick2anki")` |
| **reader 划词监听注册** | `[zopick2anki] 划词监听已注册：renderTextSelectionPopup（插件 ID zoteropick2anki@local）` |
| 启动无异常 | 调试输出与 stderr 中没有 `Error running bootstrap method`，也没有本插件的任何报错 |

（说明：旁加载的 xpi 会被 Firefox 默认自动禁用，因此测试 profile 里设了 `extensions.autoDisableScopes = 0`；正常通过「从文件安装插件」安装时不需要。）

### 需要人工在 Zotero 里验证的环节

自动化覆盖不到「GUI 交互」，以下请按序确认（每项都给了判断标准）：

1. **从文件安装**：工具 → 插件 → 从文件安装 `.xpi` → 重启。判断：插件列表出现 **Pick2anki** 且已启用（加载与启动钩子本身已由上面的自动化测试验证，这里只确认 GUI 安装路径）。
2. **设置面板渲染**：编辑 → 设置 → **Pick2anki**。判断：出现中文设置面板（注册已自动验证，渲染与交互需人眼确认）；拖动词典源行可改顺序；点「试查 hello」弹出各源成败；「测试连接并读取」能列出你的牌组/模板；切换模板后字段下拉自动刷新。
3. **PDF 划词**：打开一篇英文 PDF，选一个单词。判断：划词弹窗内出现「📖 在线词典」区块，含当前选中词、蓝色词性徽章、例句方块；释义超出高度上限时区块内滚动；位置与宽度正常（不会把弹窗挤变形）。
4. **EPUB 划词**：同上，在 EPUB 阅读器里重复一次（EPUB 的原句扩写更可能回退为选中文本，属预期）。
5. **弹窗交互**：点「➕ Anki」。判断：按钮依次显示 ⏳ → ✔（成功）或 ↺（已存在）；点击按钮**不会**让 Zotero 划词弹窗异常关闭；若未启用写卡或未配置牌组，右下角弹出中文错误提示。
6. **卡片内容**：到 Anki 里打开刚写入的卡片。判断：字段内容与上表一致（写卡本身已自动验证）；音频可播放（`[sound:…]`）；来源字段里的 `zotero://` 链接可点击跳回 Zotero。
7. **与 zotero-pdf-translate 共存**：同时启用两者，划词。判断：弹窗里同时出现它的译文面板与本插件的词典面板，两者互不干扰。
8. **禁用/重载清理**：禁用再启用本插件。判断：不会出现两个词典面板（说明 `pluginID` 自动注销生效）；禁用后划词不再出现本插件面板。
9. **深色模式**：系统切到深色主题后重复第 3 步。判断：面板文字/背景对比度正常。
10. **原句扩写效果**：选一个出现在长句中间的词，看写入卡片的 `Context` 字段。判断：多数情况下是完整句子；若出现奇怪的拼接，就把设置里的「原句扩写」关掉（此时原句 = 你选中的文本，即需求约定的行为）。
11. **重复策略**：把「重复卡片处理」设为「跳过」，对同一个词再写一次。判断：按钮变 ↺，Anki 里不新增卡片（逻辑已自动验证，这里确认按钮状态）。

## License 与致谢

MIT。本项目是 MIT 许可的 Obsidian 插件 **Pick2anki** 的衍生物，原始许可证见 `LICENSE-Pick2anki`。

- **[Pick2anki](https://github.com/soyami/pick2anki)** — MIT © soyami。本项目的词典适配器（有道/柯林斯/牛津/必应/剑桥）、统一词典 schema、AnkiConnect 客户端、Anki 字段 HTML 生成、Edge TTS 协议实现、弹窗与设置页设计均移植自它，**没有它就沒有本项目**。
- **[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)** — AGPL-3.0-or-later。本项目沿用了它的项目组织结构、`zotero-plugin.config.ts` 构建配置写法（`zotero-plugin-scaffold`）与 `addon/manifest.json` / `bootstrap.js` 骨架（该骨架本身来自 Zotero 官方的 [Make It Red](https://github.com/zotero/make-it-red) 示例与 [Zotero 7 开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)），未复制其中的业务代码。
- **[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)** — AGPL-3.0-or-later。仅参考其公开的架构思路（在 Zotero 官方划词弹窗里追加自己的面板、给面板内控件做事件隔离），**未复制任何代码**；两者的定位互补，详见上文对比表。
- **[AnkiConnect](https://foosoft.net/projects/anki-connect/)** — Anki 的本地 JSON-RPC 桥，写卡的传输层。
- 词典数据版权归各来源网站所有（有道、柯林斯、牛津、必应、剑桥），本插件仅做个人学习用途的页面解析，请遵守各站条款。
