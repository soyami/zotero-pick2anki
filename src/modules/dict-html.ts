// ============ Anki 字段 HTML 生成（内联样式，与弹窗 demo.css 风格一致） ============
// Anki 笔记字段本质是 HTML：为不依赖用户模板 CSS，全部使用内联 style。
// 设计：和查词弹窗一致 —— 每条释义自带与之对应的例句（一个释义一组例句），
// 因此“例句”无需单独映射字段；释义字段即已包含例句。
import type { DictDefinition, DictLookupBundle, DictResult } from "./dict-types";
import { posPretty } from "./dict-utils";

export function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escWordRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 文本转 HTML，命中 word（含常见屈折变化 escalated/escalates/escalating）用 <b> 包起 */
export function hlHtml(word: string, text: string): string {
  const safe = escHtml(text);
  if (!word) return safe;
  const re = new RegExp(`\\b(${escWordRe(word)})(?:s|es|ed|ing|d)?\\b`, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out += escHtml(text.slice(last, m.index)) + "<b>" + escHtml(m[0]) + "</b>";
    last = m.index + m[0].length;
  }
  out += escHtml(text.slice(last));
  return out;
}

const POS_BADGE = "display:inline-block;margin-right:5px;padding:0 5px;font-size:.9em;"
  + "text-transform:lowercase;color:#fff;background-color:#0d47a1;border-radius:3px;";
const DEF_ROW = "margin:3px 0;line-height:1.5;";
const SRC_TITLE = "font-weight:600;color:#0d47a1;margin:4px 0 2px;";
const NUMS = "color:#0d47a1;margin-right:4px;";
const SENTS_UL = "margin:3px 0 6px;padding:4px 9px;list-style:square inside;"
  + "background:rgba(13,71,161,0.1);border-radius:5px;font-size:.93em;";

/** 一条释义的内容（词性徽章 + 英/中文），不含外层行容器 */
function defBody(def: DictDefinition, word: string): string {
  const zh = def.zh || "";
  const meaning = def.meaning || "";
  let content = "";
  if (zh) {
    if (meaning && !/[\u4e00-\u9fff]/.test(meaning)) {
      content += `<span>${hlHtml(word, meaning)}</span>`;
    } else if (meaning) {
      content += `<span style="color:#0d47a1">${escHtml(meaning)}</span>`;
    }
    content += `<span style="color:#0d47a1">${escHtml(zh)}</span>`;
  } else if (meaning) {
    content += `<span>${hlHtml(word, meaning)}</span>`;
  }
  const badge = def.pos
    ? `<span style="${POS_BADGE}">${escHtml(posPretty(def.pos).toLowerCase())}</span>`
    : "";
  return badge + content;
}

/** 一组例句 → 浅蓝列表（英文加粗命中词 + 中文蓝），无例句返回 "" */
function sentencesHtml(pairs: Array<{ en?: string; zh?: string }>, word: string): string {
  const items: string[] = [];
  for (const p of pairs) {
    const en = (p.en || "").trim();
    const zh = (p.zh || "").trim();
    if (!en && !zh) continue;
    const eng = en ? `<span style="margin-right:4px;">${hlHtml(word, en)}</span>` : "";
    const chn = zh ? `<span style="color:#0d47a1">${escHtml(zh)}</span>` : "";
    items.push(`<li style="margin:2px 0;padding:0;">${eng}${chn}</li>`);
  }
  return items.length ? `<ul style="${SENTS_UL}">${items.join("")}</ul>` : "";
}

/** 语义：一个释义 + 它自己的例句（保持一致的结构，与查词弹窗相同） */
function definitionWithSentences(def: DictDefinition, word: string): string {
  const rows = [`<div style="${DEF_ROW}">${defBody(def, word)}</div>`];
  const pairs: Array<{ en?: string; zh?: string }> = [];
  if (def.example) pairs.push({ en: def.example, zh: def.exampleZh });
  const sent = sentencesHtml(pairs, word);
  if (sent) rows.push(sent);
  return rows.join("");
}

/** 该源未被任何释义“认领”的额外例句（如有道 blng_sents_part），作补充小节 */
function extraExamplesHtml(r: DictResult, word: string): string {
  const used = new Set<string>();
  r.definitions.forEach((d) => { if (d.example) used.add(d.example.trim().toLowerCase()); });
  const rest = (r.examples || []).filter((ex) => !ex.en || !used.has(ex.en.trim().toLowerCase()));
  if (rest.length === 0) return "";
  const list = sentencesHtml(rest, word);
  return `<div style="font-size:.85em;color:#888;margin:2px 0;">更多例句</div>${list}`;
}

/** 单一释义（首个可用源的第一条）+ 该义项的例句 */
export function singleDefHtml(bundle: DictLookupBundle): string {
  for (const s of bundle.sources) {
    if (!s.ok || !s.result || s.result.definitions.length === 0) continue;
    return definitionWithSentences(s.result.definitions[0], s.result.word);
  }
  return "";
}

/** 全部释义（所有可用源）：每条释义各自携带对应例句；多源带源名，多余例句收进“更多例句” */
export function allDefsHtml(bundle: DictLookupBundle): string {
  const out: string[] = [];
  const okSources = bundle.sources.filter((s) => s.ok && !!s.result && s.result.definitions.length > 0);
  for (const src of okSources) {
    const r = src.result as DictResult;
    if (okSources.length > 1) out.push(`<div style="${SRC_TITLE}">${escHtml(src.name)}</div>`);
    const many = r.definitions.length > 1;
    r.definitions.forEach((d, i) => {
      const num = many ? `<span style="${NUMS}">${i + 1}.</span>` : "";
      const row = `<div style="${DEF_ROW}">${num}${defBody(d, r.word)}</div>`;
      out.push(row);
      const pairs: Array<{ en?: string; zh?: string }> = [];
      if (d.example) pairs.push({ en: d.example, zh: d.exampleZh });
      const sent = sentencesHtml(pairs, r.word);
      if (sent) out.push(sent);
    });
    const extra = extraExamplesHtml(r, r.word);
    if (extra) out.push(extra);
  }
  return out.join("");
}

/** 独立例句字段（仅当用户仍想单独放一栏例句时使用）：释义自带例句 + 额外例句去重 */
export function examplesHtml(bundle: DictLookupBundle, limit = 10): string {
  const items: string[] = [];
  const seen = new Set<string>();
  const push = (en: string | undefined, zh: string | undefined, word: string): void => {
    const en0 = (en || "").trim();
    const zh0 = (zh || "").trim();
    if (!en0 && !zh0) return;
    if (en0) {
      const key = en0.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
    }
    const eng = en0 ? `<span style="margin-right:4px;">${hlHtml(word, en0)}</span>` : "";
    const chn = zh0 ? `<span style="color:#0d47a1">${escHtml(zh0)}</span>` : "";
    if (eng || chn) items.push(`<li style="margin:2px 0;padding:0;">${eng}${chn}</li>`);
  };
  for (const s of bundle.sources) {
    if (!s.ok || !s.result) continue;
    const r = s.result;
    for (const d of r.definitions) {
      if (d.example) push(d.example, d.exampleZh, r.word);
      if (items.length >= limit) break;
    }
    for (const ex of r.examples || []) {
      push(ex.en, ex.zh, r.word);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  if (items.length === 0) return "";
  return `<ul style="${SENTS_UL}">${items.join("")}</ul>`;
}

/** 附加信息（词形/搭配/考试标签等） */
export function extrasHtml(bundle: DictLookupBundle, limit = 6): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const s of bundle.sources) {
    if (!s.ok || !s.result?.extras) continue;
    for (const e of s.result.extras) {
      if (!e || seen.has(e.slice(0, 30))) continue;
      seen.add(e.slice(0, 30));
      lines.push(`<div style="color:#666;font-size:.92em;margin:1px 0;">${escHtml(e)}</div>`);
      if (lines.length >= limit) return lines.join("");
    }
  }
  return lines.join("");
}
