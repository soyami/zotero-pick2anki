# zotero-pick2anki

> **Zotero 划词词典插件**：在内置 PDF / EPub 阅读器里选中英文单词或短语 → 5 个在线词典源聚合释义 → 一键通过 AnkiConnect 写入 Anki 生词卡（原句就是你在文献里选中的那句话）。

<details>
<summary><b>English (short version)</b> — the full documentation below is in Chinese</summary>

**Pick2anki for Zotero** — highlight an English word or phrase in Zotero's built-in PDF/EPUB reader to get aggregated definitions from five online dictionaries (Youdao, Bing, Cambridge, Oxford Advanced Learner's, Collins), then send it to Anki as a vocabulary card in one click, including the sentence it appeared in.

- **Requirements**: Zotero 7 or later (tested on 10.0.1). Writing cards needs Anki desktop with the [AnkiConnect](https://foosoft.net/projects/anki-connect/) add-on (default `127.0.0.1:8765`); looking words up works without Anki. No account, no API key.
- **Install**: download `zotero-pick2anki.xpi` from the [latest release](https://github.com/soyami/zotero-pick2anki/releases/latest) → in Zotero: Tools → Plugins → Install Plugin From File → restart → Edit → Settings → Pick2anki.
- **Usage**: select an English word in the reader; the selection popup shows the definitions and an "➕ Anki" button. Pick the target deck, note type and field mapping once in the settings panel.
- **Privacy**: the only requests are to those five dictionary sites (and their audio CDNs) when you look a word up, plus a local call to AnkiConnect when you save a card. No telemetry, no upload of your library or reading data; dictionary pages are parsed for personal study use only.
- **Complementary to [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)**: that plugin translates sentences, this one collects vocabulary cards. They share the same selection popup and can be enabled together.
- **License**: MIT.

</details>

---

## 它解决什么问题

读英文文献的痛点是二段式的：**查词**（PDF 阅读器里选一个词，想要即时的多源释义）和**制卡**（把这个词连同它出现的原句一起，变成 Anki 里复习的卡片）。Zotero 生态里这两步目前是断开的：翻译插件帮你读懂句子，但不会替你攒生词卡。
只能翻译大概五个词左右长度的单词或者词组，整句不行，但是把它和[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)插件页面整合了，真是长句的话交给zotero-pdf-translate翻译好了。其实是长句子我觉得没有往Anki里放的必要，因为它会抓取查询单词的上下文，也能够在学习的时候形成一种语境对吧。而且这个长句既要好看也不违和，逻辑上我不知道怎么去实现比较好。
插件是我用DeepSeek vibe coding出来的，我只懂很少的代码，现在AI这么厉害，diy一个符合自己需求的工具真的挺方便的。但也因为如此我自己写的小脚本、小插件越来越多，最后给自己造了一堆需求。我想着能精简还是精简，觉得这个应该还是有用的吧。

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

**日常发版的全部操作就三步**（其余由 CI 完成）：

```bash
# 1) 改 package.json 的 version（例如 1.0.6 → 1.0.7）并提交推送
git commit -am "release: 1.0.7" && git push
# 2) 打纯数字标签（不带 v），名字必须与 version 一致
git tag 1.0.7
# 3) 推送标签，触发工作流
git push origin 1.0.7
```

工作流会自动：类型检查 + 打包 `.xpi` → 挂到 `1.0.7` 这个 Release → 刷新固定的 `release` 标签（`update.json` + 一份 `.xpi`，并保持 pre-release）→ 最后跑一遍自检（断言 `latest` 是带 `.xpi` 的版本 Release，否则整个 job 失败）。

```bash
npm run build          # 想本地手动构建：产出 .scaffold/build/zotero-pick2anki.xpi 与 update.json
```


仓库内置了 GitHub Actions 工作流 `.github/workflows/release.yml`：推送数字标签（如 `1.0.7`）即自动构建，把 `.xpi` 挂到该标签的 Release、并把 `update.json` 挂到固定的 `release` 标签。

两个 Release 的分工：

| 标签 | 内容 | 说明 |
|---|---|---|
| `<版本号>`（如 `1.0.7`） | `zotero-pick2anki.xpi` | 用户下载安装用；也是插件市场抓取 `.xpi` 的地方 |
| `release`（固定） | `update.json`（+ 一份 `.xpi` 备份） | 更新清单桶：manifest 的 `update_url` 指向它。**标记为 pre-release**，这样 GitHub 的 `latest` 始终指向真正的版本 Release（抓取方都是按「latest 里的 .xpi」取包的，否则会在清单桶里找不到包） |

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

## 已知限制

1. **Edge TTS 在 Zotero 里属于“尽力而为”**：浏览器的 WebSocket 不能自定义 `Cookie` / `Origin` / `User-Agent`，而微软的 Edge TTS 接口要求带 MUID cookie。本插件改用 Cookie 服务注入 MUID（`src/modules/edge-tts.ts` 的 `ensureMuidCookie`），但若服务端仍因缺少 Origin 而拒绝，就会失败。因此发音链是 **词典 mp3 → 有道发音接口（HTTP，8s 超时）→ Edge TTS（默认关闭，可在设置里开启）**，由 `anki.ts` 的 `storeAudio` 依次尝试，任一成功即写入卡片；全部失败只是跳过「音频」字段，不影响写卡。
2. **原句扩写是启发式的**：PDF 文本层的拼接方式因版面而异，插件会校验「扩写出的句子必须真的包含该词且长度合理」，不满足就回退成**你选中的文本本身**。EPUB 的 DOM 差异较大，默认更容易回退。可在设置里关闭「原句扩写」。
3. **词典源反爬**：柯林斯/牛津/剑桥官网随时可能改版或返回 403（自测里柯林斯就返回了 403）。失败只影响该源。
4. **只处理英文单词/短语**：中文、整段、超过 5 个词或 60 字符不触发（与 Obsidian 版一致）。
5. **需要 Zotero 7 及以上**（`strict_min_version: 7.0`，`strict_max_version: 10.9.9`）；安装前请确认版本落在区间内，否则 Zotero 会判定不兼容。
6. **`update_url` 与发布**：Zotero 强制要求 manifest 里有 `update_url`，本项目的更新清单地址指向 `https://github.com/soyami/zotero-pick2anki/releases/download/release/update.json`。在发布 `update.json` 之前，Zotero 的更新检查会 404（不影响使用，只是查不到新版本）；发布方式见下节「发布」。
7. **AnkiConnect 端口/CORS**：默认 `127.0.0.1:8765`。若修改过 AnkiConnect 的 `webCorsOriginList` 且出现被拒提示，把 `*` 或来源加进白名单（Zotero 的特权请求通常不带 `Origin`，正常情况下无需改动）。

## 隐私与网络行为

Zotero 插件对本机有完全权限，所以这里把本插件的联网行为列清楚：

- **查词时**：向有道、必应、剑桥、牛津高阶、柯林斯五个词典站发普通 HTTPS 请求（读词条页/接口），发音音频从对应 CDN 直接下载 mp3。请求只带一个常见浏览器 User-Agent，不携带你的任何身份信息或文献内容。
- **写卡时**：只连本机 `127.0.0.1:8765`（AnkiConnect），不经过任何第三方服务器。
- **不做的**：没有账号体系、没有 API Key、没有遥测或统计上报；不收集、不上传你的文献、标注或阅读行为。只有你主动写卡时，「选中词 + 所在句子 + 词典释义」才会写进**你本地的 Anki**。
- **唯一的主动联网检查**：Zotero 会按 manifest 里的 `update_url` 定期拉取本仓库 Release 中的 `update.json` 检查更新（可在 Zotero 偏好里关闭插件自动更新）。

## License 与致谢

MIT（`LICENSE` 为标准 MIT 正文）。本项目是 MIT 许可的 Obsidian 插件 **Pick2anki** 的衍生物：其原始许可证文本见 `LICENSE-Pick2anki`，衍生关系与第三方致谢见下面列表。

- **[Pick2anki](https://github.com/soyami/pick2anki)** — MIT © soyami。本项目的词典适配器（有道/柯林斯/牛津/必应/剑桥）、统一词典 schema、AnkiConnect 客户端、Anki 字段 HTML 生成、Edge TTS 协议实现、弹窗与设置页设计均移植自它，**没有它就沒有本项目**。
- **[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)** — AGPL-3.0-or-later。本项目沿用了它的项目组织结构、`zotero-plugin.config.ts` 构建配置写法（`zotero-plugin-scaffold`）与 `addon/manifest.json` / `bootstrap.js` 骨架（该骨架本身来自 Zotero 官方的 [Make It Red](https://github.com/zotero/make-it-red) 示例与 [Zotero 7 开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)），未复制其中的业务代码。
- **[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)** — AGPL-3.0-or-later。仅参考其公开的架构思路（在 Zotero 官方划词弹窗里追加自己的面板、给面板内控件做事件隔离），**未复制任何代码**；两者的定位互补，详见上文对比表。
- **[AnkiConnect](https://foosoft.net/projects/anki-connect/)** — Anki 的本地 JSON-RPC 桥，写卡的传输层。
- 词典数据版权归各来源网站所有（有道、柯林斯、牛津、必应、剑桥），本插件仅做个人学习用途的页面解析，请遵守各站条款。
