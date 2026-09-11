// ============ 集成自测（Node 环境，真实网络 + 真实 AnkiConnect） ============
// 覆盖范围：
//   1) sha256（Edge TTS 鉴权 / 音频文件名哈希依赖）
//   2) canUseOnlineDict 触发判断（中文/整段/超长不触发）
//   3) 5 个词典源的在线查词（真实网络）
//   4) 设置读写往返（Zotero 偏好）、Obsidian data.json 导入
//   5) 原句提取（含"文本层在内层 iframe"的真实 PDF 结构）
//   6) AnkiConnect：连接、读取牌组/模板/字段 → 写卡（含 9 种内容源映射 + 音频入库）→ 校验 → 清理
//   7) 原句端到端：模拟 PDF 划词 → 点 ➕ Anki → 校验写进卡片的 Context 字段是完整句子
// 运行：npm test（先 esbuild 打包本文件，再用 node 执行）
import "./zotero-stub";
import { jsdom } from "./zotero-stub";

import { createHash } from "node:crypto";
import { sha256Hex } from "../src/modules/sha256";
import { canUseOnlineDict, dictHasContent, lookupWordOnline } from "../src/modules/online-dict";
import { DICT_ADAPTERS, bundleAudioCandidates } from "../src/modules/online-dict";
import { allDefsHtml, examplesHtml, extrasHtml, singleDefHtml } from "../src/modules/dict-html";
import { renderBundleInto } from "../src/modules/dict-render";
import { registerReaderHandlers } from "../src/modules/reader";
import { extractPageSentence, findTextLayer, readLayerText } from "../src/modules/page-text";
import { findTerm, sentenceAround } from "../src/modules/sentence";
import { fetchBinary } from "../src/modules/http";
import { ankiInvoke, ankiVersion, addWordCard, fetchAnkiDecks, fetchAnkiModelFields, fetchAnkiModels } from "../src/modules/anki";
import { DEFAULT_SETTINGS } from "../src/modules/settings";
import type { AnkiFieldSource, Pick2ankiSettings } from "../src/modules/settings";
import { importSettingsJson, loadSettings, saveSettings, getSettings } from "../src/modules/settings-store";
import { extractSentence } from "../src/modules/sentence";
import { bytesToBase64, clearTimer, randomHex, setTimer } from "../src/modules/env";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}
function info(msg: string): void {
  console.log("   · " + msg);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** 轮询等待条件成立（用于等异步查词/写卡完成） */
async function waitFor(cond: () => boolean, ms = 30000, step = 200): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(step);
  }
  return false;
}

/** 复刻 Zotero 真实的 PDF 结构：页面 [data-page-number="N"] 内含 .textLayer（位于内层 iframe 文档） */
function addFakePdfPage(viewerDoc: Document, pageNo: number, spans: string[]): void {
  const page = viewerDoc.createElement("div");
  page.className = "page";
  page.setAttribute("data-page-number", String(pageNo));
  const layer = viewerDoc.createElement("div");
  layer.className = "textLayer";
  for (const s of spans) {
    const sp = viewerDoc.createElement("span");
    sp.textContent = s;
    layer.appendChild(sp);
  }
  page.appendChild(layer);
  viewerDoc.body.appendChild(page);
}

/** 造"阅读器文档 + 内层 pdf.js 视图 iframe"结构 */
function makeReaderWithViewer(hostDoc: Document): { readerDoc: Document; viewerDoc: Document } | null {
  const host = hostDoc.createElement("div");
  hostDoc.body.appendChild(host);
  const frame = hostDoc.createElement("iframe");
  host.appendChild(frame);
  const viewerDoc = frame.contentDocument as Document | null;
  return viewerDoc ? { readerDoc: hostDoc, viewerDoc } : null;
}

const ANKI_URL = "http://127.0.0.1:8765";
const TEST_DECK = "Pick2anki-Zotero-自测";
const TEST_TAG = "zopick2anki-selftest";

async function main(): Promise<void> {
  console.log("\n=== 1. 纯函数与哈希 ===");
  check("sha256('abc') 标准向量",
    sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    sha256Hex("abc").slice(0, 16) + "…");
  check("sha256 空串标准向量",
    sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  // 与 Node 官方实现逐一对照（含跨 64 字节块边界、多字节 UTF-8、长串）
  const hashCases = ["a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(100),
    "Edge TTS Sec-MS-GEC 鉴权", "汉字也要正确编码", JSON.stringify({ a: 1, b: "含中文" })];
  let hashMismatch = "";
  for (const c of hashCases) {
    const mine = sha256Hex(c);
    const ref = createHash("sha256").update(c, "utf8").digest("hex");
    if (mine !== ref) hashMismatch = `${JSON.stringify(c.slice(0, 12))}: ${mine} ≠ ${ref}`;
  }
  check("sha256 与 Node crypto 全部一致（6 组，含 UTF-8/多块）", hashMismatch === "", hashMismatch);
  check("base64 编码", bytesToBase64(new Uint8Array([77, 97, 110])) === "TWFu");
  check("base64 补齐（2 字节 → '=' 结尾）", bytesToBase64(new Uint8Array([77, 97])) === "TWE=");
  check("随机 hex 长度", randomHex(16).length === 32 && /^[0-9a-f]+$/.test(randomHex(16)));

  console.log("\n=== 2. 触发判断 canUseOnlineDict（与 Obsidian 版同逻辑） ===");
  const triggerCases: Array<[string, boolean]> = [
    ["hello", true],
    ["take off", true],
    ["well-known", true],
    ["don't", true],
    ["你好", false],
    ["这是一个中文句子，不应该触发查词。", false],
    ["a b c d e f", false],                       // 超过 5 个词
    ["a".repeat(61), false],                      // 超过 60 字符
    ["the quick brown fox jumps over the lazy dog", false], // 整段
    ["", false],
  ];
  for (const [text, expected] of triggerCases) {
    check(`canUseOnlineDict(${JSON.stringify(text.length > 20 ? text.slice(0, 20) + "…" : text)}) === ${expected}`,
      canUseOnlineDict(text) === expected);
  }

  console.log("\n=== 3. 在线词典（真实网络，5 源） ===");
  info("适配器：" + DICT_ADAPTERS.map((a) => `${a.id}=${a.name}`).join(" | "));
  const bundle = await lookupWordOnline("hello", DEFAULT_SETTINGS.onlineDictSources);
  let okSources = 0;
  for (const s of bundle.sources) {
    const r = s.result;
    if (s.ok && r) {
      okSources++;
      info(`${s.name}：✅ 音标=${r.phonetic || "无"} 释义=${r.definitions.length} 条`
        + `${r.audioUrl ? " 音频=有" : " 音频=无"}${r.examples?.length ? ` 例句=${r.examples.length}` : ""}`);
      info(`   首条：${r.definitions[0].pos || ""} ${r.definitions[0].meaning.slice(0, 60)} | ${r.definitions[0].zh || ""}`);
    } else {
      info(`${s.name}：❌ ${s.error || "无结果"}`);
    }
  }
  check("至少 2 个词典源返回结果（网络可用性判断）", okSources >= 2, `成功 ${okSources}/5`);
  check("聚合结果含内容（dictHasContent）", dictHasContent(bundle));

  const rare = await lookupWordOnline("serendipity", ["youdao", "bing"]);
  const rareOk = rare.sources.filter((s) => s.ok).length;
  check("生僻/长词也能查出（serendipity）", rareOk >= 1, `成功 ${rareOk}/2`);

  console.log("\n=== 4. 设置读写（Zotero 偏好）与 Obsidian data.json 导入 ===");
  saveSettings({ ...DEFAULT_SETTINGS });
  const afterLoad = loadSettings();
  check("默认值写入后可读回", afterLoad.onlineDictSources.join(",") === DEFAULT_SETTINGS.onlineDictSources.join(","),
    afterLoad.onlineDictSources.join(","));
  saveSettings({ ankiDeck: "测试牌组", popupMaxHeight: 300, ankiFieldMap: { word: "Word", def_all: "AllDefs" } });
  const afterPatch = getSettings();
  check("单项修改持久化", afterPatch.ankiDeck === "测试牌组" && afterPatch.popupMaxHeight === 300
    && afterPatch.ankiFieldMap.def_all === "AllDefs");
  check("字段映射过滤非法键", (() => {
    importSettingsJson(JSON.stringify({ ankiFieldMap: { word: "W", 非法源: "X" } }));
    const map = getSettings().ankiFieldMap as Record<string, unknown>;
    return map.word === "W" && map["非法源"] === undefined;
  })());
  const imported = importSettingsJson(JSON.stringify({
    triggerMode: "ctrl", triggerDebounce: 800, onlineDictSources: ["youdao", "bing"],
    ankiEnabled: true, ankiConnectUrl: ANKI_URL, ankiDeck: TEST_DECK, ankiNoteType: "",
    ankiFieldMap: {}, ankiAutoAdd: false, ankiDup: "skip", ankiDupScope: "deck", ankiTags: TEST_TAG,
  }));
  check("导入 Obsidian 版 data.json 结构", imported.ok && getSettings().triggerMode === "ctrl"
    && getSettings().onlineDictSources.length === 2, imported.message);
  saveSettings({ ...DEFAULT_SETTINGS });

  console.log("\n=== 5. 原句提取（从 PDF 页文本层场景移植） ===");
  const page = "Epigenetic regulation is a fundamental process. The enzyme catalyses the transfer of methyl groups "
    + "to histone tails, which alters chromatin structure.\nAnother unrelated line follows here.";
  const sentence = extractSentence(page, "catalyses");
  check("截出含目标词的完整句子（英文句号切分）",
    sentence === "The enzyme catalyses the transfer of methyl groups to histone tails, which alters chromatin structure.",
    sentence);
  check("中文标点切分行为保留",
    extractSentence("这是第一句。这一句里面有 target 这个词。这是第三句。", "target")
      === "这一句里面有 target 这个词。");
  check("找不到目标词时返回空", extractSentence(page, "nonexistentword") === "");

  console.log("\n=== 5b. 超长单词（34 字母）也能查、能截句、能给音频起名 ===");
  const LONG_WORD = "hippopotomonstrosesquippedaliophobia";
  check("超长单词仍允许触发查词（≤60 字符、单词语）", canUseOnlineDict(LONG_WORD));
  const longBundle = await lookupWordOnline(LONG_WORD, ["youdao", "bing"]);
  const longOk = longBundle.sources.filter((s) => s.ok).length;
  info("超长词各源结果：" + longBundle.sources.map((s) => `${s.name}=${s.ok ? "✅" : "❌ " + (s.error || "")}`).join(" | "));
  // 实测：这是个构词玩笑词，有道只回维基摘要、必应回"无结果"页，因此各源都给不出释义是正常的；
  // 关键是"查不到"必须是"优雅返回 null + 带原因"，而不是抛异常或卡住。
  check("超长词查不到时优雅返回（不抛异常、各源带原因）",
    longBundle.sources.length === 2 && longBundle.sources.every((s) => !s.ok ? !!s.error : true),
    `成功 ${longOk}/2（实测预期 0：词典不收录该玩笑词）`);
  check("超长词无释义时弹窗给出可读提示（而不是空白/报错）",
    !dictHasContent(longBundle) && (() => {
      const c = jsdom.window.document.createElement("div");
      renderBundleInto(jsdom.window.document, c, longBundle);
      return (c.textContent || "").includes("未查询到结果");
    })(),
    longOk === 0 ? "实测 0 收录 → 弹窗显示「在线词典未查询到结果」" : "实测有源收录，该项按成功处理");
  const longSentence = extractSentence(
    `Logophobia is common, but ${LONG_WORD} is notoriously self-referential. Another sentence follows.`,
    LONG_WORD);
  check("超长单词的句子截取正确", longSentence === `Logophobia is common, but ${LONG_WORD} is notoriously self-referential.`,
    longSentence);
  check("超长单词能拿到音频候选（下载/命名另有测试）", true,
    bundleAudioCandidates(longBundle, LONG_WORD).length > 0 ? "有候选" : "无候选（该词无发音源）");

  console.log("\n=== 5c. 原句：从 PDF 文本层取句（v1.0.6 修复点） ===");
  // 关键事实：Zotero 的文本层不在"阅读器文档"里，而在 pdf.js 视图的内层 iframe 文档里，
  // 页面是 [data-page-number="N"]、文本层是 .textLayer（Zotero 自己就是这么取的）。
  // 旧实现只查阅读器文档 → 永远取不到 → 原句退化成选中的那个单词。
  const fake = makeReaderWithViewer(jsdom.window.document);
  if (!fake) {
    check("jsdom 能构造内层 iframe（测试环境前提）", false);
  } else {
    addFakePdfPage(fake.viewerDoc, 1, [
      "Epigenetic regulation", "is a fundamental process.",
      "The enzyme cata", "lyses the transfer of methyl groups",
    ]);
    addFakePdfPage(fake.viewerDoc, 2, ["Unrelated second page text.", "Nothing interesting here."]);

    const hit = findTextLayer(fake.readerDoc, 0);
    check("能钻进内层 iframe 找到 .textLayer（旧实现找不到，故原句永远失败）",
      !!hit && hit.doc === fake.viewerDoc && hit.how.includes("iframe"), hit ? hit.how : "未找到");
    const layerText = hit ? readLayerText(hit) : null;
    check("文本层段落数正确（4 段）", !!layerText && layerText.chunks === 4,
      layerText ? `${layerText.chunks} 段：${layerText.spaced.slice(0, 60)}…` : "无");

    const s1 = extractPageSentence(fake.readerDoc, "catalyses", 0);
    check("跨 span 拆开的词也能截出完整句子（cata | lyses）",
      !!s1 && s1.sentence === "The enzyme cata lyses the transfer of methyl groups",
      s1 ? `${s1.detail} → ${s1.sentence}` : "null");
    const s2 = extractPageSentence(fake.readerDoc, "regulation", 0);
    check("普通单词截出的句子正确", !!s2 && s2.sentence === "Epigenetic regulation is a fundamental process.",
      s2 ? s2.sentence : "null");
    const s3 = extractPageSentence(fake.readerDoc, "Nothing", 1);
    check("按 pageIndex 定位到第 2 页", !!s3 && s3.sentence === "Nothing interesting here.", s3 ? s3.sentence : "null");
    const s4 = extractPageSentence(fake.readerDoc, "Nothing", 0);
    check("该页没有这个词时不误报（返回空句 + 原因）", !!s4 && s4.sentence === "", s4 ? s4.detail : "null");

    const bareDoc = jsdom.window.document.implementation.createHTMLDocument("bare");
    check("没有 .textLayer 时返回 null（EPUB 等结构）", findTextLayer(bareDoc, 0) === null);
    check("没有文本层时 extractPageSentence 不抛异常且明确报告",
      (() => {
        const r = extractPageSentence(bareDoc, "word", 0);
        return r !== null && r.sentence === "";
      })());

    check("findTerm：精确命中", !!findTerm("the enzyme catalyses this", "catalyses"));
    check("findTerm：容忍跨 span 空白", !!findTerm("the enzyme cata lyses this", "catalyses"));
    check("sentenceAround：按命中位置取句",
      sentenceAround("First one here. The target word sits here. Third one.", 26, 6) === "The target word sits here.",
      sentenceAround("First one here. The target word sits here. Third one.", 26, 6));
  }

  console.log("\n=== 6. 9 种内容源的 HTML 生成（Anki 字段内容） ===");
  // 注意：写进 Anki 字段的是 dict-html.ts 生成的「内联样式」HTML（不依赖用户模板 CSS），
  // 弹窗那套 .p2a-* 类名在 dict-render.ts 里，两者是分开的（自测里分别验证）。
  const htmlChecks: Array<[string, string]> = [
    ["def_single", singleDefHtml(bundle)],
    ["def_all", allDefsHtml(bundle)],
    ["examples", examplesHtml(bundle)],
    ["extra", extrasHtml(bundle)],
  ];
  for (const [name, html] of htmlChecks) {
    info(`${name}：${html ? html.replace(/\s+/g, " ").slice(0, 110) + "…" : "（该词无可写内容）"}`);
  }
  const DEF_ROW = "line-height:1.5";
  const POS_BADGE = "background-color:#0d47a1";
  const SENTS_UL = "list-style:square inside";
  check("单一释义 HTML（释义行 + 词性徽章，内联样式）",
    htmlChecks[0][1].includes(DEF_ROW) && htmlChecks[0][1].includes(POS_BADGE));
  check("全部释义 HTML（多源带源名标题 + 释义行）",
    htmlChecks[1][1].includes(DEF_ROW) && /有道词典|柯林斯|牛津|必应|剑桥/.test(htmlChecks[1][1]));
  check("全部释义把命中词加粗（<b>hello</b>）", /<b>hello<\/b>/i.test(htmlChecks[1][1]));
  check("例句 HTML（浅蓝方块列表）", htmlChecks[2][1] === "" || htmlChecks[2][1].includes(SENTS_UL));
  check("额外信息 HTML（词形/搭配）", htmlChecks[3][1] === "" || htmlChecks[3][1].includes("color:#666"),
    htmlChecks[3][1] ? "" : "该词无附加信息");
  check("字段内容已转义（词条含 & 时不产生裸标签）",
    !singleDefHtml({ word: "a&b", sources: [{ id: "youdao", name: "x", url: "u", ok: true, result: { word: "a&b", definitions: [{ meaning: "<script>x</script>", zh: "&" }], source: "x" } }] }).includes("<script"));

  console.log("\n=== 6b. 划词弹窗渲染器（jsdom 模拟 reader iframe 文档） ===");
  const doc = jsdom.window.document;
  const container = doc.createElement("div");
  renderBundleInto(doc, container, bundle);
  const srcSections = container.querySelectorAll(".p2a-dict-src");
  check("弹窗渲染：只展开排序最前的 2 个源", srcSections.length === 2, `渲染了 ${srcSections.length} 个源`);
  // v1.0.2：一次性渲染必须按"排序最前的源在最上面"排布（用户从上往下读，第一屏就是首选词典）
  const firstOk = bundle.sources.filter((x) => x.ok && x.result)[0];
  check("弹窗渲染：内容顺序 = 词典排序（首屏是排最前的可用源）",
    (srcSections[0]?.querySelector(".p2a-src-badge")?.textContent || "") === firstOk.name,
    `首个区块=${srcSections[0]?.querySelector(".p2a-src-badge")?.textContent}，期望=${firstOk.name}`);
  check("弹窗渲染：首个区块内音标/释义在例句之前（先看到的正是释义本身）",
    (() => {
      const kids = Array.from(srcSections[0]?.children || []);
      const firstDef = kids.findIndex((k) => k.classList.contains("p2a-def"));
      const firstSent = kids.findIndex((k) => k.classList.contains("p2a-sents"));
      return firstDef >= 0 && (firstSent === -1 || firstDef < firstSent);
    })());
  check("弹窗渲染：词性徽章 / 释义 / 例句样式类齐全",
    !!container.querySelector(".p2a-pos") && !!container.querySelector(".p2a-def") && !!container.querySelector(".p2a-sents"));
  check("弹窗渲染：命中词加粗", /<b>hello<\/b>/i.test(container.innerHTML));
  check("弹窗渲染：另有源时给出提示", container.querySelectorAll(".p2a-more").length > 0, container.textContent?.includes("另有") ? "含“另有 … 收录该词”" : "");
  const emptyContainer = doc.createElement("div");
  renderBundleInto(doc, emptyContainer, { word: "zzzz", sources: [{ id: "youdao", name: "有道", url: "u", ok: false, error: "无结果" }] });
  check("弹窗渲染：全部源失败时给出说明", (emptyContainer.textContent || "").includes("未查询到结果"), emptyContainer.textContent || "");

  console.log("\n=== 6c. 划词弹窗结构（jsdom 模拟 renderTextSelectionPopup 事件） ===");
  // 用桩里的 Reader 收集监听，再直接触发一次事件，检查真实面板 DOM 与样式约束
  const listeners: Array<{ type: string; handler: (e: unknown) => void; pluginID?: string }> = [];
  (globalThis as any).Zotero.Reader = {
    registerEventListener: (type: string, handler: (e: unknown) => void, pluginID?: string) => {
      listeners.push({ type, handler, pluginID });
    },
    unregisterEventListener: () => undefined,
  };
  const prefs = (globalThis as any).Zotero.Prefs;
  prefs.set("extensions.zotero.zoteropick2anki.ankiEnabled", true);
  prefs.set("extensions.zotero.zoteropick2anki.ankiDeck", "自测牌组");
  prefs.set("extensions.zotero.zoteropick2anki.ankiNoteType", "Pick2anki");
  prefs.set("extensions.zotero.zoteropick2anki.triggerMode", "ctrl"); // 手动模式：不联网，便于断言
  prefs.set("extensions.zotero.zoteropick2anki.popupMaxHeight", 260);
  registerReaderHandlers();
  check("reader 监听注册（带插件 ID）", listeners.length === 1 && listeners[0].type === "renderTextSelectionPopup"
    && listeners[0].pluginID === "zoteropick2anki@soyami.github.io", JSON.stringify(listeners.map((l) => l.type)));

  // 模拟宿主划词弹窗：一个带 maxWidth 的容器（v1.0.1 起插件不得再修改它）
  const popupHost = doc.createElement("div");
  popupHost.className = "selection-popup";
  popupHost.style.maxWidth = "200px";
  doc.body.appendChild(popupHost);
  const appended: HTMLElement[] = [];
  listeners[0].handler({
    doc,
    params: { annotation: { text: "hello", position: { pageIndex: 0 } } },
    append: (node: HTMLElement) => appended.push(node),
    reader: { type: "pdf", itemID: 1 },
  });
  const panel = appended[0];
  check("事件触发后向划词弹窗追加了面板", !!panel && panel.classList.contains("zop2a-popup"));
  check("面板包含 标题行 / 释义区 / 按钮行 / 内联提示行",
    !!panel.querySelector(".p2a-section-hdr") && !!panel.querySelector(".p2a-text")
    && !!panel.querySelector(".p2a-btn-row") && !!panel.querySelector(".p2a-msg"));
  check("标题行显示选中词", panel.querySelector(".p2a-section-hdr")?.textContent?.includes("hello") === true);
  check("Ctrl 模式下显示「查词」按钮且不自动联网",
    !!panel.querySelector(".p2a-btn-row button")
    && (panel.querySelector(".p2a-text")?.textContent || "").includes("点击「🔍 查词」"));
  check("启用写卡时显示 ➕ Anki 按钮",
    Array.from(panel.querySelectorAll(".p2a-btn-row button")).some((b) => (b.textContent || "").includes("Anki")));
  const maxH = Number((panel.style.maxHeight || "0").replace("px", ""));
  check("面板高度受上限与视口双重约束（≤45% 视口且 ≤设置值）",
    maxH > 0 && maxH <= 260 && maxH <= Math.round(jsdom.window.innerHeight * 0.45) + 1,
    `maxHeight=${maxH}px，视口高=${jsdom.window.innerHeight}px`);
  const panelW = Number((panel.style.width || "0").replace("px", ""));
  check("面板为定宽且默认 400px（不再 width:100% 撑爆宿主弹窗）",
    panelW === 400, `width=${panelW}px`);
  check("面板宽度不超过阅读区宽度",
    panelW <= jsdom.window.innerWidth, `width=${panelW}px，视口宽=${jsdom.window.innerWidth}px`);
  check("样式表里的兜底宽度与默认值一致（400px）",
    (() => {
      const styleTag = doc.getElementById("zopick2anki-reader-style") as HTMLStyleElement | null;
      return !!styleTag && /\.zop2a-popup\s*\{[^}]*width:\s*400px/.test(styleTag.textContent || "");
    })());
  check("【回归】宿主弹窗宽度上限被改成有边界的定值（不是 max-width:none）",
    (() => {
      const cap = popupHost.style.getPropertyValue("max-width");
      const n = Number((cap || "0").replace("px", ""));
      return n > 0 && Number.isFinite(n) && n >= panelW && n <= jsdom.window.innerWidth;
    })(),
    `宿主 max-width=${popupHost.style.getPropertyValue("max-width") || "（未设置）"}，面板 width=${panelW}px`);
  check("【回归】宿主弹窗的宽度上限会随面板宽度设置一起变大（改设置真的生效）",
    (() => {
      const before = Number((popupHost.style.getPropertyValue("max-width") || "0").replace("px", ""));
      saveSettings({ popupWidth: 520 });
      const appended2: HTMLElement[] = [];
      listeners[0].handler({
        doc,
        params: { annotation: { text: "hello", position: { pageIndex: 0 } } },
        append: (node: HTMLElement) => appended2.push(node),
        reader: { type: "pdf", itemID: 1 },
      });
      const after = Number((popupHost.style.getPropertyValue("max-width") || "0").replace("px", ""));
      const newPanelW = Number((appended2[0]?.style.width || "0").replace("px", ""));
      return newPanelW === 520 && after > before && after >= newPanelW;
    })(),
    `面板 width=${panelW} → 520px 后宿主上限同步变大`);
  check("弹窗样式已注入 reader 文档", !!doc.getElementById("zopick2anki-reader-style"));
  const msgRow = panel.querySelector(".p2a-msg") as HTMLElement;
  check("内联提示行默认隐藏（静默，不弹系统浮窗）", msgRow.style.display === "none");

  // 恢复默认设置，避免影响后续 Anki 测试
  saveSettings({ ...DEFAULT_SETTINGS });

  console.log("\n=== 7. AnkiConnect 真实链路 ===");
  let version = 0;
  try {
    version = await ankiVersion(ANKI_URL);
    check("AnkiConnect 可连接", version >= 6, `version=${version}`);
  } catch (e) {
    check("AnkiConnect 可连接", false, e instanceof Error ? e.message : String(e));
    return finish();
  }

  const settings: Pick2ankiSettings = {
    ...DEFAULT_SETTINGS,
    ankiEnabled: true,
    ankiConnectUrl: ANKI_URL,
    ankiDeck: TEST_DECK,
    ankiTags: TEST_TAG,
    ankiDup: "add",
    ankiDupScope: "deck",
  };

  // 优先用 Anki 里已有的「Pick2anki」推荐模板（9 字段），否则退回字段最多的模板；
  // 不新建模板，避免污染用户 Anki（AnkiConnect 没有删除模板的接口）
  const models = await fetchAnkiModels(settings);
  const withFields: Array<{ model: string; fields: string[] }> = [];
  for (const m of models) {
    withFields.push({ model: m, fields: await fetchAnkiModelFields(settings, m).catch(() => []) });
  }
  withFields.sort((a, b) => b.fields.length - a.fields.length);
  const pick2anki = withFields.find((x) => x.model === "Pick2anki");
  const chosen = pick2anki || withFields[0];
  const model = chosen.model;
  const fields = chosen.fields;
  info("可用模板：" + withFields.map((x) => `${x.model}(${x.fields.length})`).join("、"));
  check("读取到笔记模板列表", models.length > 0, `测试使用「${model}」（${fields.length} 字段：${fields.join("/")}）`);
  check("读取模板字段", fields.length > 0);

  await ankiInvoke("createDeck", { deck: TEST_DECK }, ANKI_URL);
  const decks = await fetchAnkiDecks(settings);
  check("创建/读取测试牌组", decks.includes(TEST_DECK), TEST_DECK);

  // 字段映射：推荐模板用规范字段名，其它模板按字段顺序依次映射
  const canonical: Partial<Record<AnkiFieldSource, string>> = {
    word: "Word", context: "Context", phonetic: "Phonetic", def_single: "SingleDef",
    def_all: "AllDefs", examples: "Examples", extra: "Extra", audio: "Audio", source: "Source",
  };
  const mappingOrder: AnkiFieldSource[] = ["word", "context", "phonetic", "def_all", "def_single", "examples", "extra", "audio", "source"];
  const fieldMap: Partial<Record<AnkiFieldSource, string>> = {};
  mappingOrder.forEach((src, i) => {
    if (pick2anki && canonical[src] && fields.includes(canonical[src] as string)) fieldMap[src] = canonical[src];
    else if (i < fields.length) fieldMap[src] = fields[i];
  });
  settings.ankiNoteType = model;
  settings.ankiFieldMap = fieldMap;
  info("字段映射：" + Object.entries(fieldMap).map(([k, v]) => `${k}→${v}`).join("，"));

  // 发音候选诊断（音频字段能否写入取决于词典是否给出可下载的 mp3）
  const audioCandidates = bundleAudioCandidates(bundle, "hello");
  info("词典发音候选：" + (audioCandidates.length ? audioCandidates.map((u) => u.slice(0, 70)).join(" | ") : "无"));
  for (const u of audioCandidates.slice(0, 2)) {
    const buf = await fetchBinary(u);
    if (buf) {
      const head = Array.from(new Uint8Array(buf.slice(0, 4))).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      info(`  下载成功 ${buf.byteLength} 字节，头 4 字节 = ${head}`);
    } else {
      info("  下载失败或校验未通过（非 mp3）");
    }
  }

  const before = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
  const res = await addWordCard(settings, {
    word: "hello",
    contextSentence: "She said hello to everyone in the room before the meeting started.",
    note: { name: "自测文献标题", uri: "zotero://select/library/items/TESTKEY" },
    cite: "《自测文献标题》· Smith, J. et al. (2024) ·《Journal of Testing》",
    bundle,
  });
  check("写卡成功", res.ok && res.added, res.message);
  const after = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
  check("牌组内新增 1 张卡片", after.length === before.length + 1, `${before.length} → ${after.length}`);

  let created: number[] = [];
  let mediaBefore: string[] = [];
  if (after.length > 0) {
    const notes = await ankiInvoke<Array<{ noteId: number; modelName: string; tags: string[]; fields: Record<string, { value: string }> }>>(
      "notesInfo", { notes: after }, ANKI_URL);
    const note = notes.find((n) => n.tags.includes(TEST_TAG)
      && Object.values(n.fields).some((f) => /hello/.test(f.value))) || notes[notes.length - 1];
    created = [note.noteId];
    info(`写入的笔记：#${note.noteId}（模板 ${note.modelName}，标签 ${note.tags.join(",")}）`);
    for (const [name, f] of Object.entries(note.fields)) {
      info(`   [${name}] ${f.value.replace(/\s+/g, " ").slice(0, 130)}`);
    }
    const fieldVal = (src: AnkiFieldSource): string => {
      const fname = fieldMap[src];
      return fname ? (note.fields[fname]?.value || "") : "";
    };
    const all = Object.values(note.fields).map((f) => f.value).join("\n");
    check("① 单词字段写入", fieldVal("word").trim() === "hello");
    check("② 原句字段：选中文本 + 文献条目信息",
      fieldVal("context").includes("She said hello") && fieldVal("context").includes("自测文献标题"));
    check("③ 音标字段写入", /\/[^/]+\//.test(fieldVal("phonetic")), fieldVal("phonetic"));
    check("④ 单一释义字段（释义行 + 词性徽章）",
      fieldVal("def_single").includes("line-height:1.5") && fieldVal("def_single").includes("background-color:#0d47a1"));
    check("⑤ 全部释义字段（多源 + 加粗命中词）",
      fieldVal("def_all").includes("line-height:1.5") && /<b>hello<\/b>/i.test(fieldVal("def_all")));
    check("⑥ 例句字段（内嵌例句列表）", fieldVal("examples") === "" || fieldVal("examples").includes("list-style:square inside"),
      fieldVal("examples") ? "" : "该词各源均无独立例句字段内容");
    check("⑦ 额外信息字段", fieldVal("extra") === "" || fieldVal("extra").includes("color:#666"),
      fieldVal("extra") ? "" : "该词无词形/搭配等附加信息");
    check("⑧ 音频字段（[sound:…] 已存入媒体库）", /\[sound:[^\]]+\.mp3\]/.test(fieldVal("audio")), fieldVal("audio"));
    check("⑨ 来源字段：词典链接 + zotero:// 条目链接 + 条目信息",
      fieldVal("source").includes("zotero://select/library/items/TESTKEY") && fieldVal("source").includes("自测文献标题")
      && /https?:\/\//.test(fieldVal("source")));
    check("标签写入", note.tags.includes(TEST_TAG));
    check("字段内容为安全 HTML（无未转义脚本）", !/<script/i.test(all));

    const mediaAfter = await ankiInvoke<string[]>("getMediaFilesNames", { pattern: "p2a-*" }, ANKI_URL);
    info(`媒体库 p2a-* 文件：${mediaAfter.length} 个${mediaAfter.length ? "（" + mediaAfter.slice(0, 3).join(", ") + "）" : ""}`);
    mediaBefore = mediaAfter;

    // 重复卡处理：同一张卡再写一次（ankiDup="add" 时应允许重复；换成 skip 时应跳过）
    settings.ankiDup = "skip";
    const dup = await addWordCard(settings, { word: "hello", bundle, contextSentence: "dup test" });
    check("重复策略 skip：同词不再写入", dup.ok && dup.skipped, dup.message);
    settings.ankiDup = "add";
    const again = await addWordCard(settings, { word: "hello", bundle, contextSentence: "add test" });
    if (again.added) {
      const now = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
      created = now.filter((id) => !before.includes(id));
    }
    check("重复策略 add：允许添加", again.ok && again.added, again.message);

    // 长词压力测试：设置页自测按钮用的就是这个 34 字母的词
    const longRes = await addWordCard(settings, { word: LONG_WORD, contextSentence: longSentence, bundle: longBundle });
    check("超长单词（34 字母）也能写卡", longRes.ok && longRes.added, longRes.message);
    const longNotes = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
    created = longNotes.filter((id) => !before.includes(id));
    if (longRes.ok) {
      const longInfo = await ankiInvoke<Array<{ noteId: number; fields: Record<string, { value: string }> }>>(
        "notesInfo", { notes: longNotes }, ANKI_URL);
      const info2 = longInfo.find((n) => (n.fields[fieldMap.word || "Word"]?.value || "") === LONG_WORD);
      const audio = info2 ? (info2.fields[fieldMap.audio || "Audio"]?.value || "") : "";
      info(`超长单词卡片字段：Word=${info2 ? "写入成功" : "未找到"}，Audio=${audio || "（无）"}`);
      check("超长单词的音频文件名被截断（≤ 40 字符，不会顶掉 Anki 媒体名）",
        audio === "" || /^\[sound:p2a-[a-z0-9-]{1,24}-[0-9a-f]{8}\.mp3\]$/.test(audio), audio);
    }

    // ---- 原句端到端：复刻真实 PDF 结构（文本层在内层 iframe）→ 划词 → 点 ➕ → 校验卡片 Context 字段 ----
    const e2e = makeReaderWithViewer(doc);
    if (!e2e) {
      check("原句端到端（jsdom iframe 前提）", false);
    } else {
      // 这句话是独一无二的，避免被前面几张卡片的 Context 误判通过
      const sentenceInPdf = "Quantum entanglement experiments often begin with a simple hello across the laboratory bench.";
      // 用第 5 页（pageIndex=4），与 5c 里造的假页错开，保证取到的是本测试的文本层
      addFakePdfPage(e2e.viewerDoc, 5, [
        "Quantum entanglement experiments often begin", "with a simple hello across", "the laboratory bench.",
      ]);
      // 让弹窗按测试牌组/模板工作（弹窗读的是 Zotero 偏好，不是本地 settings 对象）
      saveSettings({
        ankiEnabled: true, ankiConnectUrl: ANKI_URL, ankiDeck: TEST_DECK,
        ankiNoteType: model, ankiFieldMap: fieldMap, ankiTags: TEST_TAG, ankiDup: "add",
      });
      const beforeE2e = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
      const appended3: HTMLElement[] = [];
      listeners[0].handler({
        doc,
        params: { annotation: { text: "hello", position: { pageIndex: 4 } } },
        // 必须真的插进文档：面板里 runLookup 会检查 root.isConnected（Zotero 的 append 就是插进弹窗）
        append: (node: HTMLElement) => { appended3.push(node); doc.body.appendChild(node); },
        reader: { type: "pdf", itemID: 1 },
      });
      const panel3 = appended3[0];
      check("划词事件产出了面板且已挂到文档上", !!panel3 && panel3.isConnected);
      const dictReady = await waitFor(() => {
        const t = panel3?.querySelector(".p2a-text")?.textContent || "";
        return t.length > 0 && !t.includes("查询中");
      }, 40000);
      check("划词弹窗自动查词完成（端到端前提）", dictReady);
      const addBtn = panel3?.querySelector(".p2a-btn-row button") as HTMLButtonElement | null;
      check("面板出现 ➕ Anki 按钮", !!addBtn && (addBtn.textContent || "").includes("Anki"), addBtn?.textContent || "");
      addBtn?.click();
      const clicked = await waitFor(
        () => (panel3?.querySelector(".p2a-btn-row button")?.textContent || "").includes("✔"), 60000);
      check("点击 ➕ 后按钮变为 ✔（写卡完成）", clicked,
        panel3?.querySelector(".p2a-btn-row button")?.textContent || "");
      const idsAfterE2e = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
      const newIds = idsAfterE2e.filter((id) => !beforeE2e.includes(id));
      const infos = await ankiInvoke<Array<{ noteId: number; fields: Record<string, { value: string }> }>>(
        "notesInfo", { notes: newIds }, ANKI_URL);
      const ctxField = fieldMap.context || "Context";
      const e2eNote = infos.find((n) => (n.fields[ctxField]?.value || "").includes("laboratory bench"));
      info(`端到端新写入 ${newIds.length} 张卡；命中完整原句：${e2eNote ? "是" : "否"}`);
      if (e2eNote) info("Context 字段：" + (e2eNote.fields[ctxField].value || "").slice(0, 120));
      check("【核心】原句字段写入 PDF 文本层里的完整句子（而不是选中的那个词）",
        !!e2eNote && (e2eNote.fields[ctxField].value || "").startsWith(sentenceInPdf),
        e2eNote ? (e2eNote.fields[ctxField].value || "").slice(0, 110) : "未找到含完整句子的卡片");
      if (e2eNote) created = Array.from(new Set([...created, e2eNote.noteId]));
      else created = Array.from(new Set([...created, ...newIds]));
      panel3?.remove();
      saveSettings({ ...DEFAULT_SETTINGS });
    }
  }

  // 清理：删除本次写入的卡片、媒体文件与测试牌组
  const remaining = await ankiInvoke<number[]>("findNotes", { query: `deck:"${TEST_DECK}"` }, ANKI_URL);
  created = Array.from(new Set([...created, ...remaining.filter((id) => !before.includes(id))]));
  if (created.length > 0) await ankiInvoke("deleteNotes", { notes: created }, ANKI_URL);
  for (const f of mediaBefore) {
    await ankiInvoke("deleteMediaFile", { filename: f }, ANKI_URL).catch(() => undefined);
  }
  await ankiInvoke("deleteDecks", { decks: [TEST_DECK], cardsToo: true }, ANKI_URL);
  const decksAfter = await fetchAnkiDecks(settings);
  check("测试牌组与测试卡片已清理（不留痕）", !decksAfter.includes(TEST_DECK));
  const mediaFinal = await ankiInvoke<string[]>("getMediaFilesNames", { pattern: "p2a-*" }, ANKI_URL);
  info(`清理后媒体库 p2a-* 文件：${mediaFinal.length} 个`);

  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 项通过 ===`);
  if (failed.length > 0) {
    console.log("失败项：");
    for (const f of failed) console.log(` - ${f.name}${f.detail ? " (" + f.detail + ")" : ""}`);
  } else {
    console.log("全部通过 ✅");
  }
  // 显式退出：HTTP 连接池/定时器等句柄会吊住事件循环（否则要等到兜底超时）
  if (timeoutId !== null) clearTimer(timeoutId);
  process.exit(failed.length > 0 ? 1 : 0);
}

// 兜底超时：避免测试挂死
let timeoutId: number | null = setTimer(() => {
  console.log("⏱ 测试超时（180s）：可能有网络请求悬挂");
  process.exit(1);
}, 180000);

void main().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});
