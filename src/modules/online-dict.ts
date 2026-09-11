// ============ 词典查词：适配器注册表 + 统一渲染/写卡辅助 ============
// 架构：一个源 = 一个独立适配器脚本（youdao-dict.ts / bing-dict.ts / cambridge-dict.ts /
// collins-dict.ts / oxford-dict.ts），只做“抓取 → 统一 DictResult”。
// 本文件负责：注册适配器、按用户排序并发查词、把统一结果渲染为弹窗文本、
// 以及为 Anki 写卡提供字段内容提取（bundle* 系列）。任何第三方爬虫只要产出统一
// DictResult（至少一条 definition），即可通过 lookupWordOnline/注册表接入。
import type { DictAdapter, DictAudioUrl, DictDefinition, DictExample, DictLookupBundle, DictResult, DictSourceId } from "./dict-types";
import { youdaoAdapter } from "./youdao-dict";
import { bingAdapter } from "./bing-dict";
import { cambridgeAdapter } from "./cambridge-dict";
import { collinsAdapter } from "./collins-dict";
import { oxfordAdapter } from "./oxford-dict";

import { posPretty } from "./dict-utils";

export type { DictLookupBundle, DictResult, DictDefinition, DictExample, DictSourceId };
export type { DictAdapter, DictAudioUrl };

/** 全部可用适配器（固定编译期注册；新增源在此追加并在设置里可勾选） */
export const DICT_ADAPTERS: DictAdapter[] = [
  youdaoAdapter,
  collinsAdapter,
  oxfordAdapter,
  bingAdapter,
  cambridgeAdapter,
];

const ADAPTER_MAP: Record<string, DictAdapter> = Object.fromEntries(DICT_ADAPTERS.map((a) => [a.id, a]));

/** 是否适合走在线词典（英文单词/短语；中文或整段文字不触发） */
export function canUseOnlineDict(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 60) return false;
  if (t.split(/\s+/).length > 5) return false;
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(t)) return false;
  if (!/^[A-Za-z][A-Za-z'’\- ]{0,59}$/.test(t)) return false;
  return true;
}

/** 查词入口：按启用顺序并发查各源，统一包装成 DictLookupBundle */
export async function lookupWordOnline(word: string, ids: DictSourceId[] = DICT_ADAPTERS.map((a) => a.id)): Promise<DictLookupBundle> {
  const word0 = word.trim();
  const wanted = (ids && ids.length > 0 ? ids : DICT_ADAPTERS.map((a) => a.id));
  const results = await Promise.all(wanted.map(async (id) => {
    const adapter = ADAPTER_MAP[id];
    if (!adapter) return { id, name: id, url: "", ok: false, error: "未知词典源" };
    try {
      const result = await adapter.lookup(word0);
      if (result && result.definitions.length > 0) {
        return { id: adapter.id, name: adapter.name, url: adapter.sourceUrlFor(word0), ok: true, result };
      }
      return { id: adapter.id, name: adapter.name, url: adapter.sourceUrlFor(word0), ok: false, error: "未收录或无有效释义" };
    } catch (e) {
      return { id: adapter.id, name: adapter.name, url: adapter.sourceUrlFor(word0), ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return { word: word0, sources: results };
}

// ---------- 展示 ----------
/** 是否有可展示/可写卡的内容 */
export function dictHasContent(bundle: DictLookupBundle): boolean {
  return bundle.sources.some((s) => s.ok && !!s.result && s.result.definitions.length > 0);
}

/** 词性展示（英文标签），如 名词→noun、形容词→adj. */
export function defLine(d: DictDefinition, withPos = true): string {
  const pos = withPos && d.pos ? `${posPretty(d.pos)} ` : "";
  const zh = d.zh || "";
  const meaning = d.meaning || "";
  if (zh && meaning && zh !== meaning) return `${pos}${zh}  ${meaning}`;
  return `${pos}${zh || meaning}`;
}

/** 纯文本预览（调试用；弹窗实际使用 dict-render 的 DOM 渲染） */
export function formatDictBundle(bundle: DictLookupBundle, maxSources = 2): string {
  const lines: string[] = [];
  const okSources = bundle.sources.filter((s) => s.ok && !!s.result);
  const shown = okSources.slice(0, Math.max(1, maxSources));
  for (const src of shown) {
    const r = src.result as DictResult;
    const usedEx = new Set<string>();
    r.definitions.forEach((d) => { if (d.example) usedEx.add(d.example.trim().toLowerCase()); });
    const restExamples = (r.examples || [])
      .filter((ex) => !ex.en || !usedEx.has(ex.en.trim().toLowerCase()))
      .slice(0, 8);
    lines.push("");
    lines.push(`【${src.name}】${src.url}`);
    if (r.phonetic) lines.push("音标: " + r.phonetic);
    const multi = r.definitions.length > 1;
    r.definitions.forEach((d, i) => {
      const prefix = multi ? `${i + 1}. ` : "";
      const pos = d.pos ? `${posPretty(d.pos)} ` : "";
      const zh = d.zh || "";
      const meaning = d.meaning || "";
      const body = zh && meaning && zh !== meaning ? `${zh}  ${meaning}` : (zh || meaning);
      if (body.trim()) lines.push(`${prefix}${pos}${body}`);
      if (d.example) {
        lines.push(`  例: ${d.example}${d.exampleZh ? " — " + d.exampleZh : ""}`);
      }
    });
    if (restExamples.length) {
      lines.push("  更多例句：");
      for (const ex of restExamples) {
        lines.push(`  · ${ex.en || ""}${ex.en && ex.zh ? " — " + ex.zh : ""}`);
      }
    }
    for (const extra of (r.extras || []).slice(0, 3)) lines.push(`  ${extra}`);
  }
  const hidden = okSources.length - shown.length;
  if (hidden > 0) {
    const names = okSources.slice(shown.length).map((s) => s.name);
    lines.push(`…（另有 ${names.join("、")} 收录该词，弹窗未展开）`);
  }
  const out = lines.join("\n").trim();
  return out || "在线词典未查询到结果";
}

// ---------- 供 Anki 字段映射使用的提取函数（bundle 允许为 null：无结果返回空） ----------
export function bundlePhoneticText(bundle: DictLookupBundle | null): string {
  if (!bundle) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of bundle.sources) {
    if (!s.ok || !s.result?.phonetic) continue;
    const p = s.result.phonetic;
    if (seen.has(p)) continue;
    seen.add(p);
    parts.push(p);
  }
  return parts.slice(0, 3).join(" · ");
}

export function bundleSingleDef(bundle: DictLookupBundle | null, fallback = ""): string {
  if (bundle) {
    for (const s of bundle.sources) {
      if (!s.ok || !s.result || s.result.definitions.length === 0) continue;
      const line = defLine(s.result.definitions[0]);
      if (line.trim()) return line.trim();
    }
  }
  return fallback.trim();
}

export function bundleAllDefs(bundle: DictLookupBundle | null): string {
  if (!bundle) return "";
  const lines: string[] = [];
  const okSources = bundle.sources.filter((s) => s.ok && !!s.result && s.result.definitions.length > 0);
  for (const src of okSources) {
    const r = src.result as DictResult;
    if (okSources.length > 1) lines.push(`【${src.name}】`);
    r.definitions.forEach((d, i) => {
      const line = defLine(d);
      if (line.trim()) lines.push(okSources.length > 1 ? `${i + 1}. ${line}` : line);
    });
  }
  return lines.join("\n");
}

export function bundleExamplesText(bundle: DictLookupBundle | null, limit = 8): string {
  if (!bundle) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  const push = (en: string | undefined, zh?: string): void => {
    const en0 = (en || "").trim();
    const zh0 = (zh || "").trim();
    if (!en0 && !zh0) return;
    if (en0) {
      if (seen.has(en0)) return;
      seen.add(en0);
    }
    lines.push(`${en0}${en0 && zh0 ? " — " : ""}${zh0}`);
  };
  for (const s of bundle.sources) {
    if (!s.ok || !s.result) continue;
    const r = s.result;
    for (const d of r.definitions) {
      if (d.example) push(d.example, d.exampleZh);
      if (lines.length >= limit) return lines.join("\n");
    }
    for (const ex of r.examples || []) {
      push(ex.en, ex.zh);
      if (lines.length >= limit) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

export function bundleExtraText(bundle: DictLookupBundle | null): string {
  if (!bundle) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of bundle.sources) {
    if (!s.ok || !s.result?.extras) continue;
    for (const e of s.result.extras) {
      if (!e || seen.has(e.slice(0, 30))) continue;
      seen.add(e.slice(0, 30));
      lines.push(e);
    }
  }
  return lines.slice(0, 6).join("\n");
}

export interface BundleNoteRef { name: string; uri?: string }
export function bundleSourceText(bundle: DictLookupBundle | null, note?: BundleNoteRef): string {
  const lines: string[] = [];
  if (bundle) {
    for (const s of bundle.sources) {
      if (!s.ok) continue;
      lines.push(`${s.name}：${s.url}`);
    }
  }
  if (note?.name) {
    lines.push(note.uri ? `笔记链接：${note.uri}` : `来源笔记：${note.name}`);
  }
  return lines.join("\n");
}

/** 音频候选（按优先级：字符串直链 → uk/us 直链） */
export function bundleAudioCandidates(bundle: DictLookupBundle | null, word: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u?: string) => {
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  };
  if (bundle) {
    for (const s of bundle.sources) {
      if (!s.ok || !s.result?.audioUrl) continue;
      const au = s.result.audioUrl;
      if (typeof au === "string") add(au);
      else { if (au.uk) add(au.uk); if (au.us) add(au.us); }
    }
  }
  return out;
}
