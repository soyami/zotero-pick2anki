// ============ 原句提取（从 Pick2anki main.ts 的 extractSentenceAround 移植） ============
// Obsidian 版用它从笔记全文中截取含目标词的那句话；Zotero 版用它从 PDF 文本层里
// 截出包含选中词的完整句子，作为 Anki 的“原句”字段。
//
// 【移植改动 1】原版切句只认中文标点（。！？；;）与换行——笔记多为中文语境；
//   Zotero 这边读的是英文文献，必须再按英文句末标点（. ! ? + 空白 + 后继为大写/引号）切分，
//   否则会把上一句一起带进来。中文行为完全保留。
// 【移植改动 2（v1.0.6）】新增"按命中位置取句"（sentenceAround）与"容忍空白的词定位"（findTerm）：
//   pdf.js 会把一个词拆到相邻 span 里，拼接后可能变成 "cata lyses"，精确查找会落空；
//   原版"取最短的含词句"在整页长文本上也容易截出奇怪的片段。

/** 单个字符是否为中文句末标点或换行 */
function isCjkBoundary(ch: string): boolean {
  return ch === "\n" || ch === "\r" || "。！？；;".includes(ch);
}

/** 英文句末：句号/问号/叹号 + 空白 + 大写字母或引号/括号开头（e.g. / et al. 这类缩写只做粗略处理） */
const EN_BOUNDARY = /[.!?]\s+(?=["“'([]?[A-Z0-9])/g;

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把文本切成句子，并保留每句在原文本中的起止下标 */
export function splitSentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!text) return ranges;
  const cutPoints: number[] = [0];
  // 中文标点与换行：逐字符扫描（用 split 会丢掉位置信息）
  for (let i = 0; i < text.length; i++) {
    if (isCjkBoundary(text[i])) cutPoints.push(i + 1);
  }
  // 英文句末：在"标点 + 空白 + 大写/引号"处切
  EN_BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EN_BOUNDARY.exec(text)) !== null) {
    cutPoints.push(m.index + 1);
    if (EN_BOUNDARY.lastIndex === m.index) EN_BOUNDARY.lastIndex++; // 防御：避免零长度匹配死循环
  }
  cutPoints.sort((a, b) => a - b);
  cutPoints.push(text.length);
  for (let i = 0; i < cutPoints.length - 1; i++) {
    let start = cutPoints[i];
    let end = cutPoints[i + 1];
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/**
 * 在文本里定位目标词。
 * 先做大小写不敏感的精确查找；失败则容忍"每个字符之间可能被插入空白"
 * （pdf.js 把一个词拆到相邻 span 后拼接就会出现这种情况）。
 */
export function findTerm(text: string, term: string): { index: number; length: number } | null {
  const t = term.trim();
  if (!text || !t) return null;
  const exact = text.toLowerCase().indexOf(t.toLowerCase());
  if (exact !== -1) return { index: exact, length: t.length };
  try {
    const pattern = t.split("").map(escRe).join("\\s*");
    const m = new RegExp(pattern, "i").exec(text);
    if (m) return { index: m.index, length: m[0].length };
  } catch { /* 正则构造失败则视为未命中 */ }
  return null;
}

/** 取包含 [index, index+length) 的那句话；超长时围绕命中处裁剪并加省略号 */
export function sentenceAround(text: string, index: number, length: number, maxLen = 220): string {
  if (!text) return "";
  const ranges = splitSentenceRanges(text);
  let hit = ranges.find((r) => index >= r.start && index + length <= r.end);
  if (!hit) hit = ranges.find((r) => index < r.end && index + length > r.start);
  let out = hit ? text.slice(hit.start, hit.end) : text.slice(index, index + Math.max(length, 120));
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > maxLen) {
    const matched = text.slice(index, index + length);
    const rel = out.toLowerCase().indexOf(matched.toLowerCase());
    const start = Math.max(0, (rel > 0 ? rel : 0) - Math.floor(Math.max(0, maxLen - length) / 2));
    out = (start > 0 ? "…" : "") + out.slice(start, start + maxLen) + (start + maxLen < out.length ? "…" : "");
  }
  return out;
}

/**
 * 从一段长文本中提取包含 term 的那句话（保留原版语义，供单测与兜底路径使用）。
 * @param doc  待检索的整段文本（PDF 页文本 / EPub 章节文本 / 笔记全文）
 * @param term 目标词（选中文本）
 */
export function extractSentence(doc: string, term: string): string {
  if (!doc || !term) return "";
  const pos = findTerm(doc, term);
  if (!pos) return "";
  return sentenceAround(doc, pos.index, pos.length);
}

/** 句子里是否真的含该词（大小写不敏感；用于校验扩写结果是否可信） */
export function sentenceContains(sentence: string, term: string): boolean {
  if (!sentence || !term) return false;
  return sentence.toLowerCase().includes(term.toLowerCase());
}
