// ============ 词典解析共享工具（各 adapter 通用，全部按 unknown 防御访问） ============
// 【移植说明】原文件在此处 `import { requestUrl } from "obsidian"` 并直接实现 fetchText。
// Zotero 插件没有 requestUrl：网络能力抽到 http.ts（Zotero.HTTP），这里改为转发导出，
// 因此 5 个词典适配器的 import 语句与解析逻辑保持一字未改。
import { getDOMParser } from "./env";

export { fetchText, HTTP_UA } from "./http";

type Dict = Record<string, unknown>;

export function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** 数组/字符串统一取值 */
export function strOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((x) => clean(x)).filter(Boolean).join(" ");
  return "";
}

/** 去掉句子里的 <b> 等 HTML 标签 */
export function stripHtml(v: unknown): string {
  return typeof v === "string" ? clean(v.replace(/<[^>]+>/g, " ")) : "";
}

export function asDict(v: unknown): Dict {
  return typeof v === "object" && v !== null ? v as Dict : {};
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 把 /.../ 或裸音标统一成 "/xx/" 展示 */
export function phonText(s: unknown): string {
  const t = clean(s);
  if (!t) return "";
  if (t.startsWith("/") && t.endsWith("/")) return t;
  return `/${t}/`;
}

export function absUrl(u: string, base: string): string {
  if (!u) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(u, base).href; } catch { return u; }
}

/** 解析词典 HTML（插件沙箱里没有全局 DOMParser，从 Zotero 主窗口借用；只读不改） */
export function parseHtml(html: string): Document {
  const DP = getDOMParser();
  if (!DP) throw new Error("当前环境缺少 DOMParser，无法解析词典页面");
  return new DP().parseFromString(html, "text/html");
}

export function slugify(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "-");
}

/** 从标签文本中解析 “英 /x/ 美 /y/” 或一串 /phon/ 音标 */
export function parseLabeledPhon(txt: string, fallbackLabel = ""): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const t = clean(txt);
  if (!t) return out;
  const segs: Array<{ label: string; body: string }> = [];
  if (/英/.test(t) || /美/.test(t)) {
    const parts = t.split(/(?=英|美)/);
    for (const p of parts) {
      const label = /^英/.test(p) ? "英" : /^美/.test(p) ? "美" : "";
      if (label) segs.push({ label, body: p.replace(/^[英美]\s*/, "") });
    }
  } else {
    segs.push({ label: fallbackLabel, body: t });
  }
  for (const seg of segs) {
    const bracketed = seg.body.match(/\/[^/]+\//g);
    if (bracketed && bracketed.length > 0) {
      for (const b of bracketed) out.push({ label: seg.label, text: b });
    } else if (seg.body) {
      const noise = seg.body.replace(/^(英|美|UK|US|British|American)\s*/i, "");
      if (noise) out.push({ label: seg.label, text: phonText(noise) });
    }
  }
  return out;
}

// 词性代码 → 中文标签（柯林斯/牛津/有道的缩写与语法标签统一转中文，便于展示与写卡）
const POS_LABELS: Record<string, string> = {
  n: "名词", v: "动词", vt: "及物动词", vi: "不及物动词",
  adj: "形容词", adv: "副词", pron: "代词", prep: "介词",
  conj: "连词", int: "感叹词", interj: "感叹词", num: "数词",
  art: "冠词", aux: "助动词", modal: "情态动词", det: "限定词",
  abbr: "缩写", phrase: "短语", idiom: "习语", prefix: "前缀", suffix: "后缀",
  cn: "可数名词", un: "不可数名词", unc: "不可数名词", uncount: "不可数名词",
  ncount: "可数名词", nuncount: "不可数名词", nvar: "可数/不可数名词",
  np: "复数名词", npl: "复数名词", nsng: "单数名词", nsing: "单数名词",
  sing: "单数", pl: "复数", attrib: "定语", predic: "表语",
  noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词",
  pronoun: "代词", preposition: "介词", conjunction: "连词",
  interjection: "感叹词", exclamation: "感叹词", determiner: "限定词",
  numeral: "数词", article: "冠词", auxiliary: "助动词",
};

const POS_CJK: Record<string, string> = {
  名: "名词（专名）", 动: "动词", 形: "形容词", 副: "副词",
  介: "介词", 连: "连词", 代: "代词", 叹: "感叹词", 数: "数词", 冠: "冠词",
};

/** 把柯林斯/牛津/有道的词性标记转成易懂中文标签；无法识别则原样返回 */
export function friendlyPos(raw: unknown): string {
  const src = clean(raw);
  if (!src) return "";
  const key = src.toLowerCase().replace(/[.\s-]+/g, "");
  if (POS_LABELS[key]) return POS_LABELS[key];
  const cjk = src.match(/^【\s*([^】\s]{1,4})\s*】/);
  if (cjk && POS_CJK[cjk[1]]) return POS_CJK[cjk[1]];
  return src;
}

// 词性 → 展示用英文标签（名词→noun、形容词→adj.、动词→verb 等）
const POS_PRETTY: Record<string, string> = {
  // 中文词性
  名词: "noun", 名词专名: "proper noun",
  动词: "verb", 及物动词: "vt.", 不及物动词: "vi.",
  形容词: "adj.", 副词: "adv.", 代词: "pron.", 介词: "prep.", 连词: "conj.",
  感叹词: "int.", 数词: "num.", 冠词: "art.", 助动词: "aux.", 情态动词: "modal",
  限定词: "det.", 缩写: "abbr.", 短语: "phrase", 习语: "idiom",
  前缀: "prefix", 后缀: "suffix", 定语: "attr.", 表语: "pred.",
  可数名词: "noun[C]", 不可数名词: "noun[U]", 可数或不可数名词: "noun[C/U]", 可数与不可数名词: "noun[C/U]",
  复数名词: "noun[pl]", 单数名词: "noun[sg]", 单数: "sing.", 复数: "pl.",
  // 英文词
  noun: "noun", verb: "verb", adjective: "adj.", adverb: "adv.", pronoun: "pron.",
  preposition: "prep.", conjunction: "conj.", interjection: "int.", exclamation: "int.",
  determiner: "det.", numeral: "num.", article: "art.", auxiliary: "aux.", modal: "modal",
  // 词典缩写
  n: "n.", v: "v.", vt: "vt.", vi: "vi.", adj: "adj.", adv: "adv.", pron: "pron.",
  prep: "prep.", conj: "conj.", int: "int.", interj: "int.", num: "num.", art: "art.",
  aux: "aux.", abbr: "abbr.", cn: "noun[C]", un: "noun[U]", unc: "noun[U]",
  ncount: "noun[C]", nuncount: "noun[U]", nvar: "noun[C/U]", np: "noun[pl]", npl: "noun[pl]",
  nsng: "noun[sg]", nsing: "noun[sg]",
};

/** 渲染/写卡时使用的英文词性标签（noun / verb / adj. / adv. / vt. …） */
export function posPretty(pos: string | undefined): string {
  if (!pos) return "";
  const src = clean(pos);
  if (!src) return "";
  const key = src.toLowerCase().replace(/[\s.()（）【】-]+/g, "");
  return POS_PRETTY[key] ?? src;
}

/** 把英/美音标对按统一展示格式拼成一个字符串：UK /…/ US /…/ */
export function joinPhonetic(uk?: string, us?: string, extra?: string): string | undefined {
  const parts: string[] = [];
  const ukT = uk ? phonText(uk) : "";
  const usT = us ? phonText(us) : "";
  if (ukT || usT) {
    if (ukT && usT && ukT !== usT) parts.push(`UK ${ukT}`, `US ${usT}`);
    else parts.push(ukT || usT);
  }
  if (extra && !parts.some((p) => p === phonText(extra))) parts.unshift(phonText(extra));
  return parts.length ? parts.join(" · ") : undefined;
}
