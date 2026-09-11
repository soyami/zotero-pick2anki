// ============ Zotero reader（PDF / EPUB）划词查词弹窗 ============
// 这是相对 Obsidian 版 main.ts（划词 → 弹窗）的对应实现：
//   Obsidian：监听 document 的 mouseup → 在 workspace 里自建浮层弹窗
//   Zotero  ：监听 Zotero.Reader 的 renderTextSelectionPopup 事件 → 把 UI 追加进 reader 自己的划词弹窗
// 架构参考 windingwind/zotero-pdf-translate（MIT）：同样在划词弹窗里 append 自己的面板，
// 因此可以与 zotero-pdf-translate 并存（它显示译文，我们显示词典释义 + Anki 按钮）。
import { config } from "../../package.json";
import { canUseOnlineDict, dictHasContent, lookupWordOnline } from "./online-dict";
import type { DictLookupBundle } from "./online-dict";
import { renderBundleInto } from "./dict-render";
import { getSettings } from "./settings-store";
import type { Pick2ankiSettings } from "./settings";
import { addWordCard } from "./anki";
import type { CardInput } from "./anki";
import { getReaderItemContext } from "./item-context";
import type { ItemContext } from "./item-context";
import { extractPageSentence } from "./page-text";
import { sentenceContains } from "./sentence";
import { div, el, empty } from "./zdom";
import { log } from "./env";
import { READER_CSS_ID, readerCssText } from "./styles";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** renderTextSelectionPopup 事件（Zotero 7+；字段按可选处理以兼容不同小版本） */
export interface ReaderSelectionEvent {
  reader?: any;
  doc?: Document;
  params?: { annotation?: { text?: string; pageIndex?: number } };
  append?: (node: HTMLElement) => void;
}

/** 一次划词弹窗的运行时状态 */
interface PopupState {
  doc: Document;
  root: HTMLElement;
  dictEl: HTMLElement;
  msgEl: HTMLElement | null;
  word: string;
  /** 原句：优先用页面文本扩写出的完整句子，否则就是选中文本本身 */
  sentence: string;
  itemCtx: ItemContext | null;
  bundle: DictLookupBundle | null;
  ankiBtn: HTMLButtonElement | null;
  lookupBtn: HTMLButtonElement | null;
  adding: boolean;
  seq: number;
}

/** 注册 reader 事件（返回解绑函数，供插件卸载时调用） */
export function registerReaderHandlers(): () => void {
  const Z = (globalThis as any).Zotero;
  if (!Z?.Reader?.registerEventListener) {
    log("当前 Zotero 版本没有 Reader.registerEventListener，划词弹窗不可用（需要 Zotero 7 及以上）");
    return () => { /* 无需解绑 */ };
  }
  const type = "renderTextSelectionPopup";
  const handler = (event: ReaderSelectionEvent) => {
    try {
      onRenderSelectionPopup(event);
    } catch (e) {
      log("划词弹窗渲染失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };
  // 第三个参数传插件 ID：Zotero 会在插件卸载/禁用时自动注销该监听。
  // 注意：不要调用 Zotero.Reader.unregisterEventListener —— 在 Zotero 7/8/9 上它的过滤条件写反了
  // （会误删其他插件的监听，包括 zotero-pdf-translate 的），10.0 才修好。因此这里只依赖 pluginID 自动清理。
  try {
    Z.Reader.registerEventListener(type, handler, config.addonID);
    log(`划词监听已注册：${type}（插件 ID ${config.addonID}）`);
  } catch (e) {
    Z.Reader.registerEventListener(type, handler);
    log(`划词监听已注册（旧签名，未带 pluginID）：${type} ${e instanceof Error ? e.message : ""}`);
  }
  return () => {
    // 依赖 Zotero 按 pluginID 自动清理（见上）；这里不再主动注销
  };
}

// ---------- 事件入口 ----------
function onRenderSelectionPopup(event: ReaderSelectionEvent): void {
  const doc = event.doc;
  if (!doc) return;
  const settings = getSettings();
  const word = readSelectionText(event);
  // 只查英文单词/短语：中文、整段、超过 5 个词或 60 字符不触发（复用 Pick2anki 的判断）
  if (!canUseOnlineDict(word)) return;

  injectStyles(doc);
  // 注意（v1.0.1）：这里刻意【不】修改宿主划词弹窗的样式。
  // 早先版本为了放下长释义给 .selection-popup 设置了 maxWidth = "none"，
  // 结果弹窗按内容 max-content 撑开、把整个 PDF 页面盖住，还会连带影响
  // zotero-pdf-translate 面板的宽度（两者共用同一个弹窗容器）。
  // 现在改为：只约束我们自己的面板（定宽 + 定高 + 内部滚动），宿主弹窗保持原样。

  const state = createPopup(doc, word, event, settings);
  if (typeof event.append === "function") event.append(state.root);
  else {
    const host = doc.querySelector(".selection-popup") || doc.body;
    host?.appendChild(state.root);
  }

  if (settings.triggerMode === "ctrl") {
    // 触发模式 = Ctrl+选中：不自动联网，等用户点「查词」
    state.dictEl.textContent = "已选中「" + word + "」，点击「🔍 查词」联网查询";
  } else {
    void runLookup(state, settings);
  }
}

/** 读取选中文本：优先取事件里的 annotation.text，退回到 iframe 内的 getSelection */
function readSelectionText(event: ReaderSelectionEvent): string {
  const fromParams = event.params?.annotation?.text;
  if (typeof fromParams === "string" && fromParams.trim()) return fromParams.trim();
  const sel = event.doc?.getSelection?.();
  const txt = sel && !sel.isCollapsed ? String(sel.toString() || "") : "";
  return txt.trim();
}

// ---------- 弹窗 DOM（结构对齐 Obsidian 版：标题栏 + 释义区 + 按钮行） ----------
function createPopup(doc: Document, word: string, event: ReaderSelectionEvent, settings: Pick2ankiSettings): PopupState {
  const root = div(doc, "zop2a-popup");
  const viewW = doc.defaultView?.innerWidth || 800;
  const viewH = doc.defaultView?.innerHeight || 800;
  // 面板尺寸（v1.0.3：宽度纳入设置，默认 400px；v1.0.4：同时放开宿主弹窗的宽度上限）
  // 宽度必须是"定值"而不是 100%：宿主划词弹窗按内容 max-content 撑开，百分比会让它递归放大
  const width = Math.max(240, Math.min(settings.popupWidth || 400, viewW - 40));
  root.style.width = `${width}px`;
  // 总高度上限 = min(设置值, 阅读区高度 45%)，保证弹窗永远不会盖住大半个 PDF
  const maxH = Math.max(140, Math.min(settings.popupMaxHeight || 260, Math.round(viewH * 0.45)));
  root.style.maxHeight = `${maxH}px`;
  // 关键：Zotero 的 reader.css 里 `.selection-popup{max-width:198px;padding:8px}`，
  // 宿主弹窗默认只有 198px 宽（内容区约 182px），不放开的话无论设置多大都只显示这么宽
  // ——这正是"改了宽度设置没反应"的原因（v1.0.4 修复）。
  // 做法：把它改成【有上限的定值】(面板宽 + 弹窗自身内边距 + 余量)，而不是 v1.0.0 那种 max-width:none：
  //   · 定值 → 弹窗宽度可预测、绝不会被长释义撑爆（v1.0.1 那个"盖住整页"的坑不会再出现）
  //   · !important → 无论与其它插件（如 zotero-pdf-translate 会设 max-width:none）谁先执行，都由我们收口
  try {
    const host = doc.querySelector(".selection-popup") as HTMLElement | null;
    if (host) {
      const cap = Math.min(width + 20, viewW - 16);
      host.style.setProperty("max-width", `${cap}px`, "important");
      log(`已放开划词弹窗宽度上限：max-width=${cap}px（面板 ${width}px）`);
    }
  } catch (e) {
    log("放开宿主弹窗宽度上限失败（不影响查词）：" + (e instanceof Error ? e.message : String(e)));
  }
  // 标题行与按钮行固定不压缩，只有释义区滚动 → 「➕ Anki」永远可见

  const hdr = div(doc, "p2a-section-hdr");
  hdr.appendChild(div(doc, "p2a-label", "📖 在线词典"));
  hdr.appendChild(div(doc, "p2a-word", word));
  root.appendChild(hdr);

  const dictEl = div(doc, "p2a-text");
  dictEl.textContent = "查询中…";
  root.appendChild(dictEl);

  const state: PopupState = {
    doc,
    root,
    dictEl,
    word,
    sentence: "",
    itemCtx: null,
    bundle: null,
    ankiBtn: null,
    lookupBtn: null,
    msgEl: null,
    adding: false,
    seq: 0,
  };

  // 原句 + 文献条目信息（不联网即可准备，写卡时用）
  state.sentence = resolveSentence(doc, word, settings, readPageIndex(event));
  state.itemCtx = getReaderItemContext(event.reader);

  // 按钮行
  const btnRow = div(doc, "p2a-btn-row");
  if (settings.triggerMode === "ctrl") {
    const lookBtn = el(doc, "button", { cls: "p2a-anki", text: "🔍 查词" });
    lookBtn.onclick = () => { void runLookup(state, getSettings()); };
    state.lookupBtn = lookBtn;
    btnRow.appendChild(lookBtn);
  }
  if (settings.ankiEnabled) {
    const b = el(doc, "button", { cls: "p2a-anki", text: "➕ Anki" });
    b.onclick = () => { void addSelectionToAnki(state, getSettings()); };
    state.ankiBtn = b;
    btnRow.appendChild(b);
  }
  if (btnRow.childNodes.length > 0) root.appendChild(btnRow);

  // 内联提示行（替代系统进度窗口：v1.0.1 起写卡成功/失败都在面板内显示，不再弹任何浮窗）
  const msgEl = div(doc, "p2a-msg");
  msgEl.style.display = "none";
  root.appendChild(msgEl);
  state.msgEl = msgEl;

  // 阻止指针事件冒泡到宿主弹窗：否则拖动/点击我们的内容会被 reader 当成新的划词操作
  for (const node of Array.from(root.querySelectorAll("button, .p2a-text"))) {
    keepEventsLocal(node as HTMLElement);
  }
  return state;
}

/** 让事件留在本面板内（架构参考 zotero-pdf-translate 对弹窗内控件的处理） */
function keepEventsLocal(node: HTMLElement): void {
  const stop = (e: Event) => e.stopPropagation();
  node.addEventListener("pointerup", stop);
  node.addEventListener("mousedown", stop);
  node.addEventListener("dragstart", stop);
}

/** 面板内联提示（没有浮窗、不抢焦点；弹窗已关闭时静默丢弃） */
function setMessage(state: PopupState, text: string, isError = false): void {
  const node = state.msgEl;
  if (!node || !state.root.isConnected) return;
  node.textContent = text;
  node.className = "p2a-msg" + (isError ? " p2a-msg-err" : "");
  node.style.display = text ? "" : "none";
}

/** 释义渲染完成后回到顶部。
 *  注意：Obsidian 版是"边查边追加"（流式），所以原代码渲染后滚到底部；
 *  Zotero 版是一次性渲染完整结果，滚到底会让用户看到最后一条释义、还得手动往上翻，
 *  因此这里改为停在顶部（v1.0.2 修复）。 */
function scrollToTop(dictEl: HTMLElement): void {
  try { dictEl.scrollTop = 0; } catch { /* 忽略 */ }
}

// ---------- 查词 ----------
async function runLookup(state: PopupState, settings: Pick2ankiSettings): Promise<void> {
  const seq = ++state.seq;
  state.dictEl.textContent = "查询中…";
  setMessage(state, "");
  const sources = settings.onlineDictSources || [];
  if (sources.length === 0) {
    state.dictEl.textContent = "未启用任何词典源，请在 设置 → Pick2anki → 在线词典查词 中勾选";
    return;
  }
  const bundle = await lookupWordOnline(state.word, sources);
  if (seq !== state.seq || !state.root.isConnected) return; // 弹窗已关闭或已发起新查询
  const has = dictHasContent(bundle);
  state.bundle = has ? bundle : null;
  empty(state.dictEl);
  renderBundleInto(state.doc, state.dictEl, bundle);
  scrollToTop(state.dictEl);
  // 可选自动写卡（与 Obsidian 版同语义）
  if (has && settings.ankiEnabled && settings.ankiAutoAdd) {
    await addSelectionToAnki(state, getSettings());
  }
}

// ---------- 写卡（全程静默：只在面板内更新按钮状态与一行提示，不弹系统浮窗） ----------
async function addSelectionToAnki(state: PopupState, settings: Pick2ankiSettings): Promise<void> {
  if (state.adding) return;
  const word = state.word.trim();
  if (!word) { setMessage(state, "请先选中一个单词/短语", true); return; }
  if (!canUseOnlineDict(word)) { setMessage(state, "仅英文单词/短语可写入 Anki 卡片", true); return; }
  if (!settings.ankiEnabled) { setMessage(state, "Anki 写卡未启用：设置 → Pick2anki → 写入 Anki 单词卡", true); return; }
  if (!settings.ankiDeck || !settings.ankiNoteType) { setMessage(state, "请先在设置中配置目标牌组与模板", true); return; }
  if ((settings.onlineDictSources || []).length === 0) { setMessage(state, "未启用任何词典源：设置 → Pick2anki → 在线词典查词", true); return; }

  state.adding = true;
  setAnkiButton(state, "busy", "准备…");
  setMessage(state, "");
  try {
    let bundle = state.bundle;
    if (!bundle) {
      setAnkiButton(state, "busy", "查词…");
      const b = await lookupWordOnline(word, settings.onlineDictSources);
      bundle = dictHasContent(b) ? b : null;
      state.bundle = bundle;
    }
    if (!bundle) {
      setAnkiButton(state, "err");
      setMessage(state, `词典未查到「${word}」的释义，未写入卡片（可检查网络或更换词典源）`, true);
      return;
    }
    const input: CardInput = {
      word,
      contextSentence: state.sentence || word,
      note: state.itemCtx
        ? { name: state.itemCtx.title || word, uri: state.itemCtx.uri }
        : undefined,
      cite: settings.showCite ? (state.itemCtx?.cite || undefined) : undefined,
      bundle,
    };
    // 各阶段回显到按钮上（音频下载/上传最慢，用户能看出在做什么）
    const res = await addWordCard(settings, input, undefined, (stage) => {
      setAnkiButton(state, "busy", stage);
    });
    if (!res.ok) {
      setAnkiButton(state, "err");
      setMessage(state, "Anki 写入失败：" + res.message, true);
    } else if (res.skipped) {
      setAnkiButton(state, "dup");
      setMessage(state, `「${word}」已存在，已跳过`);
    } else if (res.added) {
      setAnkiButton(state, "ok");
      setMessage(state, ""); // 成功保持静默，按钮变 ✔ 即反馈
    }
  } catch (e) {
    setAnkiButton(state, "err");
    setMessage(state, "Anki 写入失败：" + (e instanceof Error ? e.message : String(e)), true);
  } finally {
    state.adding = false;
  }
}

/** 弹窗 Anki 按钮状态：busy=⏳ 阶段名 / ok=✔ / dup=↺ / err=➕ */
function setAnkiButton(state: PopupState, st: "busy" | "ok" | "dup" | "err", stage = ""): void {
  const btn = state.ankiBtn;
  if (!btn) return;
  btn.classList.remove("p2a-anki-ok", "p2a-anki-dup", "p2a-anki-err");
  if (st === "busy") {
    btn.textContent = "⏳ " + (stage || "Anki…");
    btn.classList.add("p2a-anki-err");
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  if (st === "ok") {
    btn.textContent = "✔ Anki";
    btn.classList.add("p2a-anki-ok");
  } else if (st === "dup") {
    btn.textContent = "↺ 已有";
    btn.classList.add("p2a-anki-dup");
  } else {
    btn.textContent = "➕ Anki";
    btn.classList.add("p2a-anki-err");
  }
}

// ---------- 原句：从 PDF 文本层取包含该词的句子（失败回退选中文本） ----------
/** reader 类型：'pdf' | 'epub' | 'snapshot'（Zotero 的 reader.type，7/10 都有） */
function readReaderType(reader: any): string {
  try {
    return String(reader?.type || "");
  } catch {
    return "";
  }
}

/** 划词事件里 annotation.position.pageIndex（0 基页码；EPUB 是 CFI，没有这个字段） */
function readPageIndex(event: ReaderSelectionEvent): number | undefined {
  const pos = (event.params?.annotation as { position?: { pageIndex?: number } } | undefined)?.position;
  return typeof pos?.pageIndex === "number" ? pos.pageIndex : undefined;
}

/**
 * 取"原句"：优先从 PDF 文本层里截包含该词的完整句子，取不到就回退为选中文本本身。
 * v1.0.6 起改用 page-text.ts（按 [data-page-number] + .textLayer 定位，且会钻进内层 iframe）——
 * 之前的实现只查了阅读器自身文档，所以永远取不到文本层、只能回退成那个单词。
 */
function resolveSentence(
  doc: Document,
  word: string,
  settings: Pick2ankiSettings,
  pageIndex?: number,
): string {
  if (!settings.sentenceExpand) return word;
  try {
    const res = extractPageSentence(doc, word, pageIndex, 220);
    if (!res) {
      log(`原句扩写：未取到句子（pageIndex=${pageIndex ?? "无"}）→ 回退为选中文本`);
      return word;
    }
    if (!res.sentence) {
      log("原句扩写：" + res.detail + " → 回退为选中文本");
      return word;
    }
    // 校验：句子必须真的含该词（容忍拼接空格），且长度合理
    const okContains = sentenceContains(res.sentence, word)
      || res.sentence.toLowerCase().replace(/\s+/g, "").includes(word.toLowerCase().replace(/\s+/g, ""));
    if (okContains && res.sentence.length <= 400) {
      log("原句扩写成功：" + res.detail + " → " + res.sentence.slice(0, 80));
      return res.sentence;
    }
    log("原句扩写结果未通过校验（不含目标词或过长）→ 回退为选中文本");
  } catch (e) {
    log("原句扩写失败（回退为选中文本）：" + (e instanceof Error ? e.message : String(e)));
  }
  return word;
}

// ---------- 样式注入（reader 是独立 iframe，直接插 <style> 最稳） ----------
function injectStyles(doc: Document): void {
  try {
    if (doc.getElementById?.(READER_CSS_ID)) return;
    const style = el(doc, "style", { attr: { id: READER_CSS_ID } });
    style.textContent = readerCssText();
    (doc.head || doc.documentElement)?.appendChild(style);
  } catch (e) {
    log("样式注入失败：" + (e instanceof Error ? e.message : String(e)));
  }
}
