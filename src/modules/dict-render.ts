// ============ 弹窗释义渲染器（参照柯林斯卡片样板美化） ============
// 纯 DOM 节点渲染（不解析任何 HTML 字符串）：词性=蓝色徽章、英/中释义分色、
// 例句=浅蓝底方块列表，例句中的查询词用 <b> 加粗。样式类见 addon/content/zopick2anki.css。
//
// 【移植说明】渲染结构与样式类名与 Pick2anki 原版完全一致，只有两处必要改动：
//   1) 所有函数第一个参数显式传入目标 document（要渲染到 Zotero reader 的 iframe 文档里，
//      不能依赖全局 document）
//   2) Obsidian 的 createDiv/createSpan/createEl 扩展 → zdom.ts 中的等价工具
import type { DictDefinition, DictLookupBundle, DictResult } from "./dict-types";
import { posPretty } from "./dict-utils";
import { div, el, span } from "./zdom";

function hasCjk(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/** 把文本分段塞入 parent：命中 word（含常见屈折变化）的片段加粗（大小写不敏感） */
function fillHighlighted(doc: Document, parent: HTMLElement, text: string, word: string): void {
  if (!word) {
    parent.appendChild(doc.createTextNode(text));
    return;
  }
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${esc})(?:s|es|ed|ing|d)?\\b`, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(doc.createTextNode(text.slice(last, m.index)));
    parent.appendChild(el(doc, "b", { text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(doc.createTextNode(text.slice(last)));
}

function addSentenceList(doc: Document, wrap: HTMLElement, sentences: Array<{ en?: string; zh?: string }>, word: string): void {
  const ul = el(doc, "ul", { cls: "p2a-sents" });
  for (const s of sentences) {
    const li = el(doc, "li", { cls: "p2a-sent" });
    if (s.en) {
      const en = span(doc, "p2a-eng-sent");
      fillHighlighted(doc, en, s.en, word);
      li.appendChild(en);
    }
    if (s.zh) li.appendChild(span(doc, "p2a-chn-sent", s.zh));
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
}

function renderDefinition(doc: Document, container: HTMLElement, def: DictDefinition, word: string): void {
  const row = div(doc, "p2a-def");
  if (def.pos) row.appendChild(span(doc, "p2a-pos", posPretty(def.pos).toLowerCase()));
  const tran = span(doc, "p2a-tran");
  // 英汉双解/英英：meaning 为英文 → p2a-eng-tran；纯中文源（meaning 即中文）→ p2a-chn-tran
  const zh = def.zh || "";
  const meaning = def.meaning || "";
  if (zh) {
    if (meaning && !hasCjk(meaning)) {
      const eng = span(doc, "p2a-eng-tran");
      fillHighlighted(doc, eng, meaning, word);
      tran.appendChild(eng);
    } else if (meaning) {
      // 中英混排释义（如有道聚合长串）：整段按中文色展示
      tran.appendChild(span(doc, "p2a-chn-tran", meaning));
    }
    tran.appendChild(span(doc, "p2a-chn-tran", zh));
  } else if (meaning) {
    const eng = span(doc, "p2a-eng-tran");
    fillHighlighted(doc, eng, meaning, word);
    tran.appendChild(eng);
  }
  row.appendChild(tran);
  // 例句紧跟对应释义
  const sentences: Array<{ en?: string; zh?: string }> = [];
  if (def.example) sentences.push({ en: def.example, zh: def.exampleZh });
  if (sentences.length) addSentenceList(doc, row, sentences, word);
  container.appendChild(row);
}

/** 把查词结果渲染进 popup 内容容器（只渲染“排序最前且可用 maxSources 个源”） */
export function renderBundleInto(doc: Document, container: HTMLElement, bundle: DictLookupBundle, maxSources = 2): void {
  const okSources = bundle.sources.filter((s) => s.ok && !!s.result);
  const shown = okSources.slice(0, Math.max(1, maxSources));
  if (shown.length === 0) {
    container.appendChild(span(doc, undefined, "在线词典未查询到结果"));
    return;
  }
  for (const src of shown) {
    const r = src.result as DictResult;
    const section = div(doc, "p2a-dict-src");

    const head = div(doc, "p2a-dict-head");
    head.appendChild(span(doc, "p2a-src-badge", src.name));
    if (src.url) head.appendChild(span(doc, "p2a-src-url", src.url));
    section.appendChild(head);
    if (r.phonetic) section.appendChild(div(doc, "p2a-phon", `音标 ${r.phonetic}`));

    // 释义：例句已跟随各自释义
    for (const def of r.definitions) renderDefinition(doc, section, def, r.word);

    // 释义未涵盖的额外例句
    const used = new Set<string>();
    r.definitions.forEach((d) => { if (d.example) used.add(d.example.trim().toLowerCase()); });
    const rest = (r.examples || []).filter((ex) => !ex.en || !used.has(ex.en.trim().toLowerCase()));
    if (rest.length) {
      const label = div(doc, "p2a-more", "更多例句");
      section.appendChild(label);
      addSentenceList(doc, section, rest, r.word);
    }
    // 附加信息（词形/搭配等）
    for (const extra of (r.extras || []).slice(0, 3)) section.appendChild(div(doc, "p2a-extra", extra));
    container.appendChild(section);
  }
  const hidden = okSources.length - shown.length;
  if (hidden > 0) {
    const names = okSources.slice(shown.length).map((s) => s.name);
    container.appendChild(div(doc, "p2a-more", `…（另有 ${names.join("、")} 收录该词，弹窗未展开）`));
  }
}
