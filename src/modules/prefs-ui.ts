// ============ 设置面板（Zotero 偏好面板 UI） ============
// 与 Obsidian 版 Pick2ankiSettingTab 一一对应：分组、名称、说明文字、下拉/开关/拖拽排序全部对齐，
// 便于用户在两版之间迁移。差异只在宿主控件上：Obsidian 的 Setting/PluginSettingTab → 手写 HTML 控件。
//
// 运行位置：Zotero 偏好窗口（chrome 特权文档），由 addon/content/preferences.xhtml 的 onload
// 调用 Zotero.<addonInstance>.api.renderPrefs(document, this)。
//
// v1.0.1 修复（用户反馈「点测试连接后设置界面会消失」）：
//   1) 面板内【不再使用】Zotero 的系统进度窗口（ProgressWindow）——那个浮窗是挂在主窗口上的，
//      弹出时会抢走焦点，偏好窗口就跑到主窗口后面，看起来像"被关掉了"。所有提示改为面板内联状态文字。
//   2) 异步操作完成后【不再整体重建面板】，只重建受影响的分区（拖拽排序只重建词典列表，
//      连接 Anki 只重建 Anki 分区），保持 Zotero 偏好窗口自身的 DOM 稳定。
//   3) 所有异步回调都包了 try/catch，异常只显示在状态行里，不会冒泡到偏好窗口。
import type { AnkiFieldSource, OnlineDictSource, Pick2ankiSettings } from "./settings";
import {
  ANKI_FIELD_SOURCES, ANKI_SOURCE_LABELS, ANKI_SOURCE_PLACEHOLDERS,
  ONLINE_DICT_NAMES, ONLINE_DICT_SOURCES,
} from "./settings";
import {
  exportSettingsJson, getSettings, importSettingsJson, resetSettings, setSetting,
} from "./settings-store";
import { dictHasContent, lookupWordOnline } from "./online-dict";
import {
  addWordCard, ankiVersion, fetchAnkiDecks, fetchAnkiModelFields, fetchAnkiModels,
} from "./anki";
import { div, el, empty, span } from "./zdom";
import { log } from "./env";

/** 端到端自测用的词。
 *  首选「hippopotomonstrosesquippedaliophobia」（长词恐惧症，34 个字母）：既走通完整链路，
 *  又顺带压测超长单词的排版换行、音频文件名截断。
 *  注意：这个玩笑词所有词典源都没有释义（有道只给维基摘要、必应是"无结果"页），
 *  所以自测会自动回退到 FALLBACK_TEST_WORD 继续，避免用户点了按钮只看到"查不到"。 */
const SELF_TEST_WORD = "hippopotomonstrosesquippedaliophobia";
/** 超长词查不到时用于完成自测的常用词 */
const FALLBACK_TEST_WORD = "hello";

/** 固定内容源在设置页的补充说明（与 Obsidian 版 ANKI_SOURCE_DESC 一致） */
const ANKI_SOURCE_DESC: Record<AnkiFieldSource, string> = {
  word: "填入的内容：所查的单词/词组",
  context: "PDF/EPUB 中选中该词的句子（原句即选中文本；开启“原句扩写”后会尽量取完整句子）+ 文献条目信息",
  phonetic: "英/美 IPA 发音音标",
  def_single: "首个简明释义，并内嵌该释义自己的例句",
  def_all: "启用词典的完整释义列表，每条释义均内嵌它自己的例句",
  examples: "例句已内嵌在释义下方，通常无需单独映射；若想单独汇总一栏例句可在此选择字段",
  extra: "词形变化 / 常用搭配 / 考试范围标签",
  audio: "自动获取发音并导入 Anki 媒体库（词典发音优先，HTTP 兜底；Edge TTS 默认关闭）",
  source: "各词典的网页链接 + 文献条目的 zotero:// 链接 + 条目信息（作者/年份）",
};

/** 面板运行时状态（Anki 元数据缓存，与 Obsidian 版插件实例上的缓存等价） */
interface PaneState {
  decks: string[];
  models: string[];
  fields: string[];
  fieldsModel: string;
  error: string;
  metaUrl: string;
  busy: boolean;
}

const state: PaneState = {
  decks: [], models: [], fields: [], fieldsModel: "", error: "", metaUrl: "", busy: false,
};

// 面板 DOM 引用（分区容器常驻，异步操作后只重建对应分区）
let paneDoc: Document | null = null;
let topStatus: HTMLElement | null = null;
let dictHost: HTMLElement | null = null;
let ankiHost: HTMLElement | null = null;
let triggerHost: HTMLElement | null = null;
let migrationHost: HTMLElement | null = null;

/** 渲染设置面板（幂等：首次建立骨架与分区容器，之后只重建各分区内容） */
export function renderPrefsPane(doc: Document, host: HTMLElement): void {
  paneDoc = doc;
  host.classList.add("zopick2anki-prefs");

  if (!host.querySelector(".zp-skeleton")) {
    empty(host);
    host.appendChild(heading(doc, "Pick2anki - 设置"));
    topStatus = div(doc, "zp-status zp-top");
    host.appendChild(topStatus);
    const sk = div(doc, "zp-skeleton");
    host.appendChild(sk);
    dictHost = div(doc, "zp-section");
    ankiHost = div(doc, "zp-section");
    triggerHost = div(doc, "zp-section");
    migrationHost = div(doc, "zp-section");
    sk.appendChild(dictHost);
    sk.appendChild(ankiHost);
    sk.appendChild(triggerHost);
    sk.appendChild(migrationHost);
  }
  rerenderAll();
}

function rerenderAll(): void {
  rerenderDict();
  rerenderAnki();
  rerenderTrigger();
  rerenderMigration();
}

/** 只重建词典分区（拖拽排序/启停后调用） */
function rerenderDict(): void {
  if (!paneDoc || !dictHost) return;
  empty(dictHost);
  try { renderDictSection(paneDoc, dictHost, getSettings()); }
  catch (e) { setStatus("词典分区渲染失败：" + errText(e), false); }
}

/** 只重建 Anki 分区（连接/切模板后调用） */
function rerenderAnki(): void {
  if (!paneDoc || !ankiHost) return;
  empty(ankiHost);
  try { renderAnkiSection(paneDoc, ankiHost, getSettings()); }
  catch (e) { setStatus("Anki 分区渲染失败：" + errText(e), false); }
}

function rerenderTrigger(): void {
  if (!paneDoc || !triggerHost) return;
  empty(triggerHost);
  renderTriggerSection(paneDoc, triggerHost, getSettings());
}

function rerenderMigration(): void {
  if (!paneDoc || !migrationHost) return;
  empty(migrationHost);
  renderMigrationSection(paneDoc, migrationHost, getSettings());
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 面板顶部状态行（替代系统进度窗口：不弹浮窗、不抢焦点） */
function setStatus(text: string, ok?: boolean): void {
  log("[设置面板] " + text);
  if (!topStatus) return;
  topStatus.textContent = text;
  topStatus.className = "zp-status zp-top" + (ok === undefined ? "" : ok ? " zp-ok" : " zp-err");
}

// ---------- 通用控件 ----------
function heading(doc: Document, text: string): HTMLElement {
  return el(doc, "h2", { text });
}

function row(doc: Document, name: string, desc?: string): HTMLElement {
  const wrap = div(doc, "zp-row");
  wrap.appendChild(el(doc, "label", { cls: "zp-name", text: name }));
  const body = div(doc, "zp-body");
  wrap.appendChild(body);
  if (desc) body.appendChild(div(doc, "zp-desc", desc));
  return wrap;
}

function addRow(host: HTMLElement, name: string, desc?: string): HTMLElement {
  const doc = paneDoc ?? host.ownerDocument;
  if (!doc) throw new Error("设置面板缺少 document");
  const r = row(doc, name, desc);
  host.appendChild(r);
  return r.querySelector(".zp-body") as HTMLElement;
}

function checkbox(doc: Document, checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = el(doc, "input", { attr: { type: "checkbox" } });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function select(doc: Document, options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = el(doc, "select");
  for (const [v, label] of options) {
    sel.appendChild(el(doc, "option", { text: label, attr: { value: v } }));
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function button(doc: Document, text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el(doc, "button", { cls: primary ? "zp-primary" : undefined, text });
  b.addEventListener("click", () => {
    // 所有按钮回调统一兜底，异常只写进状态行
    try { onClick(); } catch (e) { setStatus("操作失败：" + errText(e), false); }
  });
  return b;
}

/** 异步按钮：运行期间禁用按钮，异常写状态行（v1.0.1：不再整体重建面板） */
function asyncButton(
  doc: Document,
  text: string,
  run: () => Promise<void>,
  primary = false,
): HTMLButtonElement {
  const b = el(doc, "button", { cls: primary ? "zp-primary" : undefined, text });
  b.addEventListener("click", () => {
    if (b.disabled) return;
    b.disabled = true;
    const original = b.textContent;
    b.textContent = "处理中…";
    void (async () => {
      try {
        await run();
      } catch (e) {
        setStatus("操作失败：" + errText(e), false);
      } finally {
        b.disabled = false;
        b.textContent = original;
      }
    })();
  });
  return b;
}

function textInput(doc: Document, value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const input = el(doc, "input", { attr: { type: "text", placeholder } });
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

// ---------- 1. 在线词典 ----------
function renderDictSection(doc: Document, host: HTMLElement, s: Pick2ankiSettings): void {
  host.appendChild(heading(doc, "📖 在线词典查词"));
  addRow(host, "说明", "在 Zotero 内置 PDF / EPub 阅读器里划选英文单词或短语，划词弹窗中即出现聚合释义。"
    + "部分官网受反爬影响失败时会自动跳过该源；弹窗只完整展示“排序最前且可用”的两个源的释义。");

  const body = addRow(host, "顺序与启用", "直接拖动整行调整顺序（越靠上越优先，单一/全部释义与发音按此合并）；行尾开关可停用该源");
  const list = div(doc, "p2a-src-list");
  const active: OnlineDictSource[] = [...(s.onlineDictSources || [])];
  const disabled = ONLINE_DICT_SOURCES.filter((x) => !active.includes(x));
  let dragId: string | null = null;

  for (const src of active) {
    const r = div(doc, "p2a-src-row");
    r.draggable = true;
    r.dataset.src = src;
    r.appendChild(span(doc, "p2a-src-grip", "⠿"));
    r.appendChild(span(doc, "p2a-src-name", ONLINE_DICT_NAMES[src]));
    r.appendChild(checkbox(doc, true, () => {
      setSetting("onlineDictSources", (getSettings().onlineDictSources || []).filter((x) => x !== src));
      rerenderDict();
    }));

    r.addEventListener("dragstart", (e) => {
      dragId = src;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", src); }
      r.classList.add("p2a-src-dragging");
    });
    r.addEventListener("dragend", () => {
      dragId = null;
      r.classList.remove("p2a-src-dragging");
      for (const other of Array.from(list.querySelectorAll(".p2a-src-row"))) other.classList.remove("p2a-src-drag-over");
    });
    r.addEventListener("dragover", (e) => {
      if (!dragId || dragId === (r.dataset.src || "")) return;
      e.preventDefault();
      r.classList.add("p2a-src-drag-over");
    });
    r.addEventListener("dragleave", () => r.classList.remove("p2a-src-drag-over"));
    r.addEventListener("drop", (e) => {
      e.preventDefault();
      r.classList.remove("p2a-src-drag-over");
      const from = dragId;
      const to = r.dataset.src || "";
      if (!from || from === to) return;
      const list2 = [...(getSettings().onlineDictSources || [])];
      const fi = list2.indexOf(from as OnlineDictSource);
      const ti = list2.indexOf(to as OnlineDictSource);
      if (fi >= 0 && ti >= 0 && fi !== ti) {
        list2.splice(ti, 0, list2.splice(fi, 1)[0]);
        setSetting("onlineDictSources", list2);
        rerenderDict();
      }
    });
    list.appendChild(r);
  }
  body.appendChild(list);

  if (disabled.length > 0) {
    addRow(host, "已停用词典", "重新启用会追加到列表末尾");
    for (const src of disabled) {
      const b2 = addRow(host, ONLINE_DICT_NAMES[src]);
      b2.appendChild(checkbox(doc, false, (v) => {
        if (!v) return;
        setSetting("onlineDictSources", [...(getSettings().onlineDictSources || []), src]);
        rerenderDict();
      }));
    }
  }

  const testBody = addRow(host, "连通性自测", "用 hello 联网试查一次各词典源，确认网络可用（结果直接显示在下方，不打扰你的窗口）");
  const testOut = div(doc, "zp-status");
  testBody.appendChild(asyncButton(doc, "试查 hello", async () => {
    setStatus("正在试查各词典源…");
    const bundle = await lookupWordOnline("hello", getSettings().onlineDictSources);
    const lines = bundle.sources.map((x) => `${x.name}：${x.ok ? "✅" : "❌ " + (x.error || "无结果")}`);
    testOut.textContent = lines.join("\n");
    testOut.className = "zp-status " + (dictHasContent(bundle) ? "zp-ok" : "zp-err");
    setStatus(dictHasContent(bundle) ? "词典连通性测试完成" : "词典源全部失败，请检查网络", dictHasContent(bundle));
  }));
  testBody.appendChild(testOut);
}

// ---------- 2. Anki 写卡 ----------
function renderAnkiSection(doc: Document, host: HTMLElement, s: Pick2ankiSettings): void {
  host.appendChild(heading(doc, "🗂 写入 Anki 单词卡"));

  const enableBody = addRow(host, "启用 Anki 写卡", "需要 Anki 桌面版并启用 AnkiConnect 插件（Anki → 工具 → 插件，默认端口 8765）。"
    + "启用后划词弹窗出现 ➕ Anki 按钮");
  enableBody.appendChild(checkbox(doc, s.ankiEnabled, (v) => {
    setSetting("ankiEnabled", v);
    rerenderAnki();
  }));

  if (!s.ankiEnabled) return;

  const urlBody = addRow(host, "本地桥接地址", "一般无需修改");
  urlBody.appendChild(textInput(doc, s.ankiConnectUrl, "http://127.0.0.1:8765", (v) => {
    setSetting("ankiConnectUrl", v.trim() || "http://127.0.0.1:8765");
    state.metaUrl = "";
  }));

  const connBody = addRow(host, "牌组 / 模板", state.decks.length > 0
    ? `已连接：${state.decks.length} 个牌组、${state.models.length} 个模板`
    : "点击右侧按钮测试连接并读取牌组/模板列表");
  connBody.appendChild(asyncButton(doc, "测试连接并读取", async () => {
    setStatus("正在连接 Anki…");
    await refreshAnkiMeta(true);
    if (state.error) {
      setStatus("连接失败：" + state.error, false);
    } else {
      const cur = getSettings();
      if (!cur.ankiDeck && state.decks.length > 0) setSetting("ankiDeck", state.decks[0]);
      if (!cur.ankiNoteType && state.models.length > 0) {
        setSetting("ankiNoteType", state.models[0]);
        await loadTemplateFields(state.models[0]);
      }
      setStatus(`✅ 已连接 Anki，读取到 ${state.decks.length} 个牌组、${state.models.length} 个模板`, true);
    }
    rerenderAnki(); // 只重建 Anki 分区（不动偏好窗口的其他部分）
  }, true));
  if (state.error) addRow(host, "连接状态", "⚠️ " + state.error);

  // 目标牌组
  if (state.decks.length > 0) {
    const chosen = s.ankiDeck && state.decks.includes(s.ankiDeck) ? s.ankiDeck : state.decks[0];
    const b = addRow(host, "目标牌组", "写入的牌组，子牌组用 :: 分隔（如 英语::核心词汇）。列表中没有的请先在 Anki 中创建");
    b.appendChild(select(doc, state.decks.map((d) => [d, d] as [string, string]), chosen, (v) => {
      setSetting("ankiDeck", v);
    }));
  } else {
    addRow(host, "目标牌组", "请先点击上方“测试连接并读取”");
  }

  // 目标模板
  let chosenModel = "";
  if (state.models.length > 0) {
    chosenModel = s.ankiNoteType && state.models.includes(s.ankiNoteType) ? s.ankiNoteType : state.models[0];
    const b = addRow(host, "目标模板", "Anki 中的笔记类型；切换后会读取该模板的字段用于下拉选择");
    b.appendChild(select(doc, state.models.map((m) => [m, m] as [string, string]), chosenModel, (v) => {
      void (async () => {
        try {
          setSetting("ankiNoteType", v);
          setStatus("正在读取模板字段…");
          await loadTemplateFields(v);
          if (state.error) setStatus("读取模板字段失败：" + state.error, false);
          else setStatus(`模板「${v}」共 ${state.fields.length} 个字段`, true);
        } catch (e) {
          setStatus("切换模板失败：" + errText(e), false);
        } finally {
          rerenderAnki();
        }
      })();
    }));
    const fb = addRow(host, "读取模板字段", "随模板选择自动读取；此按钮可手动刷新。下方每个“内容”用下拉单选一个模板字段；留空 = 不写入");
    fb.appendChild(asyncButton(doc, "读取 / 刷新字段", async () => {
      const m = getSettings().ankiNoteType || chosenModel;
      if (!m) { setStatus("请先选择目标模板", false); return; }
      setStatus("正在读取模板字段…");
      await loadTemplateFields(m);
      if (state.error) setStatus("读取模板字段失败：" + state.error, false);
      else setStatus(`模板「${m}」共 ${state.fields.length} 个字段：${state.fields.join("、")}`, true);
      rerenderAnki();
    }));
  } else {
    addRow(host, "目标模板", "请先点击上方“测试连接并读取”");
  }

  // 自动读取当前目标模板的字段（与 Obsidian 版一样只在缓存不匹配时触发一次）
  const model = s.ankiNoteType && state.models.includes(s.ankiNoteType) ? s.ankiNoteType : (state.models[0] || "");
  if (model && state.fieldsModel !== model && !state.busy) {
    state.busy = true;
    void loadTemplateFields(model)
      .then(() => { state.busy = false; rerenderAnki(); })
      .catch((e) => { state.busy = false; setStatus("自动读取字段失败：" + errText(e), false); });
  }

  // 字段映射
  host.appendChild(heading(doc, "模板字段映射（固定）"));
  const fieldsLoaded = model !== "" && state.fieldsModel === model;
  addRow(host, "映射方式", fieldsLoaded
    ? `已读取模板「${state.fieldsModel}」的字段，每个内容从下拉单选。同一字段可被多个内容共用，写卡时自动合并为多行（一般不推荐）`
    : "请先在上方选择目标模板并读取字段，再为每个“内容”选择要写入的模板字段");

  if (state.fields.length > 0) {
    const grid = div(doc, "zp-field-map");
    for (const src of ANKI_FIELD_SOURCES) {
      // 上下堆叠：内容源名称 → 字段下拉 → 说明（与其它设置项同一套版式）
      const fieldRow = div(doc, "zp-field-row");
      fieldRow.appendChild(div(doc, "zp-fm-label", ANKI_SOURCE_LABELS[src]));
      const cur = (s.ankiFieldMap?.[src] || "").trim();
      const options: Array<[string, string]> = [["", "（不填）"], ...state.fields.map((f) => [f, f] as [string, string])];
      if (cur && !state.fields.includes(cur)) options.push([cur, cur + "（当前模板无此字段）"]);
      fieldRow.appendChild(select(doc, options, cur, (v) => {
        const map = { ...(getSettings().ankiFieldMap || {}) };
        map[src] = v.trim();
        setSetting("ankiFieldMap", map);
        setStatus(`${ANKI_SOURCE_LABELS[src]} → ${v || "（不写入）"}`, true);
      }));
      fieldRow.appendChild(div(doc, "zp-fm-desc", ANKI_SOURCE_DESC[src] + "　（占位示例：" + ANKI_SOURCE_PLACEHOLDERS[src] + "）"));
      grid.appendChild(fieldRow);
    }
    host.appendChild(grid);
  } else {
    addRow(host, "当前模板字段", "暂无可用字段（请先点击上方“读取 / 刷新字段”）");
  }

  // 写卡行为
  const autoBody = addRow(host, "查词后自动写卡", "开启后，单词查询一完成即自动写入卡片（重复按下方策略处理）；不开启时用弹窗 ➕ Anki 按钮手动添加");
  autoBody.appendChild(checkbox(doc, s.ankiAutoAdd, (v) => setSetting("ankiAutoAdd", v)));

  const dupBody = addRow(host, "重复卡片处理");
  dupBody.appendChild(select(doc, [["skip", "跳过（不重复添加）"], ["add", "仍然添加（允许重复）"]], s.ankiDup, (v) => {
    setSetting("ankiDup", v as "skip" | "add");
  }));

  const scopeBody = addRow(host, "查重范围");
  scopeBody.appendChild(select(doc, [["deck", "仅当前牌组"], ["model", "整个模板（所有牌组）"]], s.ankiDupScope, (v) => {
    setSetting("ankiDupScope", v as "deck" | "model");
  }));

  const tagBody = addRow(host, "卡片标签", "逗号分隔，例如 pick2anki、生词");
  tagBody.appendChild(textInput(doc, s.ankiTags, "如：生词、复习", (v) => setSetting("ankiTags", v)));

  const edgeBody = addRow(host, "Edge TTS 发音兜底",
    "词典发音与 HTTP 兜底都拿不到音频时，才用微软 Edge TTS 合成。"
    + "Zotero 的浏览器 WebSocket 无法自定义 Cookie/Origin 头，成功率低且最慢（默认关闭）");
  edgeBody.appendChild(checkbox(doc, s.edgeTtsFallback, (v) => setSetting("edgeTtsFallback", v)));

  // 端到端自测：真实查词 + 真实写卡（结果只显示在面板内）
  const selfBody = addRow(host, "端到端自测",
    `先用 ${SELF_TEST_WORD}（长词恐惧症，34 个字母）走一遍完整链路，`
    + `它查不到释义时会自动改用 ${FALLBACK_TEST_WORD} 继续（该词各词典源确实都没收录，属预期）`
    + "：在线词典查词 → AnkiConnect 写卡（写入上面选定的牌组/模板，受重复策略约束）。"
    + "刻意选长词是为了顺便压测超长单词的弹窗排版换行与音频文件名截断");
  const selfOut = div(doc, "zp-status");
  selfBody.appendChild(asyncButton(doc, "写入测试卡", async () => {
    const settings = getSettings();
    setStatus(`正在查词：${SELF_TEST_WORD}…`);
    let word = SELF_TEST_WORD;
    let bundle = await lookupWordOnline(word, settings.onlineDictSources);
    let note = "";
    if (!dictHasContent(bundle)) {
      // 意料之中：这个玩笑词没有词典释义。改用常用词继续，保证按钮在任何网络环境下都能完成自测。
      note = `（${SELF_TEST_WORD} 各源均未收录，已自动改用 ${FALLBACK_TEST_WORD} 继续）`;
      infoDictFailure(bundle); // 把各源原因写到状态行，便于判断"是词没收录"还是"网络不通"
      word = FALLBACK_TEST_WORD;
      setStatus(`正在查词：${word}…`);
      bundle = await lookupWordOnline(word, settings.onlineDictSources);
    }
    if (!dictHasContent(bundle)) {
      selfOut.textContent = `词典未查到 ${word}，请检查网络或词典源开关`;
      selfOut.className = "zp-status zp-err";
      setStatus("端到端自测中止：词典无结果", false);
      return;
    }
    const res = await addWordCard(settings, {
      word,
      contextSentence: `Pick2anki 端到端自测：${word}`,
      cite: "来自 zotero-pick2anki 设置页自测",
      bundle,
    }, undefined, (stage) => setStatus("端到端自测：" + stage));
    selfOut.textContent = (res.ok ? "✅ " : "❌ ") + res.message + note;
    selfOut.className = "zp-status " + (res.ok ? "zp-ok" : "zp-err");
    setStatus(res.ok ? `✅ 端到端自测通过：已写入 Anki（${word}）` : "端到端自测失败", res.ok);
  }));
  selfBody.appendChild(selfOut);
}

/** 把某个词在各源的失败原因写到状态行（诊断"词没收录"还是"网络不通"） */
function infoDictFailure(bundle: { sources: Array<{ name: string; ok: boolean; error?: string }> }): void {
  const lines = bundle.sources.map((s) => `${s.name}：${s.ok ? "✅" : "❌ " + (s.error || "无结果")}`);
  setStatus(lines.join("；"), false);
}

/** 拉取 Anki 牌组/模板元数据（与 Obsidian 版 refreshAnkiMeta 同逻辑） */
async function refreshAnkiMeta(force = false): Promise<void> {
  const s = getSettings();
  if (!s.ankiConnectUrl) return;
  if (!force && state.metaUrl === s.ankiConnectUrl && (state.decks.length > 0 || state.models.length > 0)) return;
  state.metaUrl = s.ankiConnectUrl;
  state.error = "";
  try {
    await ankiVersion(s.ankiConnectUrl);
    const [decks, models] = await Promise.all([fetchAnkiDecks(s), fetchAnkiModels(s)]);
    state.decks = decks;
    state.models = models;
  } catch (e) {
    state.error = errText(e);
    state.decks = [];
    state.models = [];
    log("读取 Anki 元数据失败：" + state.error);
  }
}

/** 读取指定模板的字段列表（供字段映射下拉用） */
async function loadTemplateFields(model: string): Promise<void> {
  state.fieldsModel = model;
  state.fields = [];
  state.error = "";
  if (!model || !getSettings().ankiConnectUrl) return;
  try {
    state.fields = await fetchAnkiModelFields(getSettings(), model);
  } catch (e) {
    state.error = errText(e);
    state.fields = [];
  }
}

// ---------- 3. 触发与 Zotero 专属项 ----------
function renderTriggerSection(doc: Document, host: HTMLElement, s: Pick2ankiSettings): void {
  host.appendChild(heading(doc, "⚡ 触发与显示"));
  const modeBody = addRow(host, "触发模式", "直接选中 = 划词弹窗出现即自动查词；Ctrl+选中 = 弹窗里先显示「🔍 查词」按钮，点击后才联网（"
    + "Zotero 的划词弹窗不携带按键状态，故用“手动确认”等价实现该模式）");
  modeBody.appendChild(select(doc, [["direct", "直接选中"], ["ctrl", "Ctrl+选中（手动点查词）"]], s.triggerMode, (v) => {
    setSetting("triggerMode", v as "direct" | "ctrl");
  }));

  const wBody = addRow(host, "弹窗宽度(px)", "词典面板的固定宽度（默认 400，范围 240–720，且不超过阅读区宽度）。"
    + "Zotero 的划词弹窗自带 max-width:198px 上限，插件会自动把它改成“面板宽 + 20px”的定值上限，"
    + "所以这里的数值是真正生效的（改完下一次划词可见）");
  wBody.appendChild(textInput(doc, String(s.popupWidth), "400", (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 240 && n <= 720) {
      setSetting("popupWidth", Math.round(n));
      setStatus(`弹窗宽度已设为 ${Math.round(n)}px（下次划词生效）`, true);
    } else {
      setStatus("宽度需要是 240–720 之间的数字", false);
    }
  }));

  const hBody = addRow(host, "弹窗整体最大高度(px)", "词典面板总高度的上限（默认 260）。实际高度还会被限制为阅读区高度的 45%，"
    + "所以调大也不会盖住大半个 PDF；标题行与按钮行始终可见，只有释义区滚动");
  hBody.appendChild(textInput(doc, String(s.popupMaxHeight), "260", (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 120) {
      setSetting("popupMaxHeight", Math.round(n));
      setStatus(`弹窗最大高度已设为 ${Math.round(n)}px（下次划词生效）`, true);
    } else {
      setStatus("高度需要是 ≥120 的数字", false);
    }
  }));

  const expandBody = addRow(host, "原句扩写", "开启后：优先从 PDF/EPUB 当前页文本层里截取包含该词的完整句子作为“原句”；"
    + "取不到或结果不可信时，回退为“选中文本本身”");
  expandBody.appendChild(checkbox(doc, s.sentenceExpand, (v) => setSetting("sentenceExpand", v)));

  const citeBody = addRow(host, "附带文献条目信息", "开启后，“原句/来源”字段会附带《标题》· 作者 · (年份) 与 zotero:// 条目链接");
  citeBody.appendChild(checkbox(doc, s.showCite, (v) => setSetting("showCite", v)));
}

// ---------- 4. 迁移 / 备份 ----------
function renderMigrationSection(doc: Document, host: HTMLElement, _s: Pick2ankiSettings): void {
  host.appendChild(heading(doc, "🔁 迁移 / 备份"));
  addRow(host, "说明", "两版 Pick2anki 的设置项键名完全一致，因此可以直接把 Obsidian 版插件目录下 "
    + "`.obsidian/plugins/pick-to-anki/data.json` 的内容粘贴到下面，点“导入”即可完成迁移（多余的键会被忽略）。");

  const outBody = addRow(host, "导出当前设置", "JSON 文本，可复制留档");
  const ta = el(doc, "textarea", { attr: { readonly: "readonly" } });
  ta.value = exportSettingsJson();
  outBody.appendChild(ta);

  const inBody = addRow(host, "导入设置", "粘贴 data.json 或本插件导出的 JSON，然后点“导入”（会覆盖同名设置项）");
  const input = el(doc, "textarea", { attr: { placeholder: "{ \"onlineDictSources\": [\"youdao\"], ... }" } });
  inBody.appendChild(input);
  const status = div(doc, "zp-status");
  const btns = div(doc, "zp-btn-bar");
  btns.appendChild(button(doc, "导入", () => {
    const res = importSettingsJson(input.value);
    status.textContent = (res.ok ? "✅ " : "❌ ") + res.message;
    status.className = "zp-status " + (res.ok ? "zp-ok" : "zp-err");
    setStatus(res.message, res.ok);
    if (res.ok) rerenderAll();
  }, true));
  btns.appendChild(button(doc, "恢复默认值", () => {
    if (!confirmDialog(doc, "确定把所有 Pick2anki 设置恢复为默认值？")) return;
    const defaults = resetSettings();
    status.textContent = `✅ 已恢复默认值（词典源：${defaults.onlineDictSources.join("、")}；Anki 写卡已关闭）`;
    status.className = "zp-status zp-ok";
    setStatus("已恢复默认值", true);
    rerenderAll();
  }));
  inBody.appendChild(btns);
  inBody.appendChild(status);
}

/** 简单确认框（偏好窗口里优先用 window.confirm，失败则默认继续） */
function confirmDialog(doc: Document, message: string): boolean {
  try {
    const win = doc.defaultView as unknown as { confirm?: (m: string) => boolean } | null;
    if (win?.confirm) return win.confirm(message);
  } catch { /* 忽略 */ }
  return true;
}
