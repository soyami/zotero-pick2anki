// ============ 从 PDF 文本层取"原句" ============
// 背景（这是 v1.0.6 修的 bug）：Zotero 的 PDF 阅读器分两层文档——
//   · 划词弹窗所在的文档 = 阅读器自身文档（事件里的 event.doc）
//   · 文本层所在的文档   = pdf.js 视图的文档（阅读器文档里的内层 iframe）
// 之前只查了 event.doc，于是 .page / .textLayer / getSelection() 全部落空，
// 原句永远回退成"选中的那个单词"。
//
// 现在的做法完全对齐 Zotero 自己的取法（见其 reader.js）：
//   win.document.querySelector(`[data-page-number="${pageIndex + 1}"] .textLayer`)
// 即：用划词事件里 annotation.position.pageIndex（1 基换算）精确定位该页的文本层，
// 再从中取文本。找不到时退回到"按选区最近的祖先元素"（对 EPUB / snapshot 兜底）。
import { findTerm, sentenceAround } from "./sentence";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 一页文本层的定位结果 */
export interface TextLayerHit {
  doc: Document;
  layer: Element;
  /** 定位方式，用于日志诊断 */
  how: string;
}

/** 最多向下钻几层 iframe（PDF 文本层在第 1 层，留点余量） */
const MAX_IFRAME_DEPTH = 3;

/** 收集一个文档及其所有内层 iframe 的文档 */
function collectDocuments(root: Document, depth = 0, out: Document[] = []): Document[] {
  out.push(root);
  if (depth >= MAX_IFRAME_DEPTH) return out;
  let iframes: Element[] = [];
  try {
    iframes = Array.from(root.querySelectorAll("iframe"));
  } catch { iframes = []; }
  for (const frame of iframes) {
    try {
      const inner = (frame as HTMLIFrameElement).contentDocument;
      if (inner && !out.includes(inner)) collectDocuments(inner, depth + 1, out);
    } catch {
      // 跨进程/跨源 iframe 拿不到 contentDocument，跳过
    }
  }
  return out;
}

/**
 * 定位文本层。
 * @param doc       划词事件的 doc（阅读器文档）
 * @param pageIndex  0 基页码（annotation.position.pageIndex），没有则按"选区所在文本层"兜底
 */
export function findTextLayer(doc: Document, pageIndex?: number): TextLayerHit | null {
  const docs = collectDocuments(doc);
  // 1) 首选：按页码精确取（Zotero 自己的做法）
  if (typeof pageIndex === "number" && pageIndex >= 0) {
    for (const d of docs) {
      try {
        const layer = d.querySelector(`[data-page-number="${pageIndex + 1}"] .textLayer`);
        if (layer) {
          return { doc: d, layer, how: `[data-page-number="${pageIndex + 1}"] .textLayer（${d === doc ? "阅读器文档" : "内层 iframe"}）` };
        }
      } catch { /* 忽略 */ }
    }
  }
  // 2) 其次：文档里第一个文本层
  for (const d of docs) {
    try {
      const layer = d.querySelector(".textLayer");
      if (layer) return { doc: d, layer, how: `.textLayer（${d === doc ? "阅读器文档" : "内层 iframe"}）` };
    } catch { /* 忽略 */ }
  }
  return null;
}

/** 文本层的文本：返回两种拼接方式（空格拼接 / 原始拼接），供"目标词是否出现"择优 */
export interface LayerText {
  /** 按 span 之间补空格拼接（最适合切句） */
  spaced: string;
  /** 原样拼接（pdf.js 有时把词拆到相邻 span 且不含空格，这里能还原） */
  raw: string;
  chunks: number;
  how: string;
}

/** 提取文本层里的文字 */
export function readLayerText(hit: TextLayerHit): LayerText {
  const { layer, how } = hit;
  let chunks: string[] = [];
  try {
    // pdf.js 的文本层是若干个直接子元素（span / div），每个是一段文字
    chunks = Array.from(layer.children)
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
  } catch { chunks = []; }
  if (chunks.length === 0) {
    // 结构不认识时退回到整块 textContent
    const whole = (layer.textContent || "").trim();
    if (whole) chunks = [whole];
  }
  return {
    spaced: chunks.join(" "),
    raw: chunks.join(""),
    chunks: chunks.length,
    how,
  };
}

/** 找不到文本层时，从"选区最近的祖先"取文本（对 EPUB/snapshot 之类结构兜底） */
function readFromSelection(doc: Document): { text: string; how: string } | null {
  try {
    for (const d of collectDocuments(doc)) {
      const sel = d.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) continue;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const startEl: Element | null = node?.nodeType === 1 ? node as Element : (node?.parentElement ?? null);
      const container = startEl?.closest?.(".textLayer, .epub-view, .epub-container, .page") || startEl?.parentElement;
      if (!container) continue;
      const text = (container.textContent || "").trim();
      if (text) return { text, how: "选区祖先元素（无 .textLayer 时兜底）" };
    }
  } catch { /* 忽略 */ }
  return null;
}

export interface PageSentenceResult {
  /** 截到的原句（已裁剪到合理长度） */
  sentence: string;
  /** 用了哪种方式、命中了哪个文本层，便于日志诊断 */
  detail: string;
}

/**
 * 从页面文本层截出包含 target 的那句话。
 * @param doc        划词事件的 doc
 * @param target     目标词（= 划词弹窗里的选中文本）
 * @param pageIndex  0 基页码（可选）
 * @param maxLen     结果最大长度，超过则围绕命中处裁剪（默认 220）
 */
export function extractPageSentence(
  doc: Document,
  target: string,
  pageIndex?: number,
  maxLen = 220,
): PageSentenceResult | null {
  const hit = findTextLayer(doc, pageIndex);
  if (hit) {
    const layer = readLayerText(hit);
    // 先试"补空格"版本：句子可读性最好，也是绝大多数情况
    for (const [text, label] of [[layer.spaced, "空格拼接"], [layer.raw, "原样拼接"]] as Array<[string, string]>) {
      if (!text) continue;
      const pos = findTerm(text, target);
      if (pos) {
        const sentence = sentenceAround(text, pos.index, pos.length, maxLen);
        if (sentence) {
          return {
            sentence,
            detail: `${hit.how} / ${label} / ${layer.chunks} 段 / 命中成功`,
          };
        }
      }
    }
    return {
      sentence: "",
      detail: `${hit.how} / ${layer.chunks} 段 / 文本层里未找到「${target}」`,
    };
  }
  const fallback = readFromSelection(doc);
  if (fallback) {
    const pos = findTerm(fallback.text, target);
    if (pos) {
      const sentence = sentenceAround(fallback.text, pos.index, pos.length, maxLen);
      if (sentence) return { sentence, detail: `${fallback.how} / 命中成功` };
    }
    return { sentence: "", detail: `${fallback.how} / 未找到「${target}」` };
  }
  return { sentence: "", detail: "没有找到 .textLayer，也没有可用的选区（EPUB 等结构会走到这里）" };
}
