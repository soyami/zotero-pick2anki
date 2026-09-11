// ============ 适配器：柯林斯英汉双解官网（HTML 尽力解析） ============
import type { DictAdapter, DictDefinition, DictResult } from "./dict-types";
import { ONLINE_DICT_NAMES } from "./settings";
import { absUrl, clean, fetchText, friendlyPos, parseHtml, parseLabeledPhon, phonText, slugify } from "./dict-utils";

const entryUrl = (word: string) => `https://www.collinsdictionary.com/dictionary/english-chinese/${slugify(word)}`;

export const collinsAdapter: DictAdapter = {
  id: "collins",
  name: ONLINE_DICT_NAMES.collins,
  sourceUrlFor: entryUrl,
  async lookup(word) {
    try {
      const html = await fetchText(entryUrl(word));
      return parseToDict(word, html);
    } catch (e) {
      console.warn("[pick2anki] 柯林斯官网查询失败，词条:", word, e instanceof Error ? e.message : String(e));
      return null;
    }
  },
};

function parseToDict(word: string, html: string, url = entryUrl(word)): DictResult | null {
  const doc = parseHtml(html);
  const homs = Array.from(doc.querySelectorAll(".hom"));
  if (homs.length === 0) return null;

  // 音标与发音（尽力：从 .pron / .phon 收集）
  let ukPron = "", usPron = "", ukAudio = "", usAudio = "", plainPron = "", plainAudio = "";
  const addPron = (body: string, audioUrl?: string) => {
    const parsed = parseLabeledPhon(body);
    for (const p of parsed) {
      const audio = p.label === "英" ? (ukAudio || audioUrl || "") : p.label === "美" ? (usAudio || audioUrl || "") : "";
      if (p.label === "英") { ukPron = ukPron || p.text.replace(/^\/|\/$/g, ""); if (audio) ukAudio = audio; }
      else if (p.label === "美") { usPron = usPron || p.text.replace(/^\/|\/$/g, ""); if (audio) usAudio = audio; }
      else if (!plainPron) { plainPron = p.text.replace(/^\/|\/$/g, ""); if (audioUrl) plainAudio = audioUrl; }
    }
    if (!parsed.length && body) {
      const m = body.match(/\/[^/]+\//g);
      if (m && m[0]) { plainPron = plainPron || m[0].replace(/^\/|\/$/g, ""); if (audioUrl) plainAudio = audioUrl; }
    }
  };
  const audioFrom = (el: Element): string | undefined => {
    const a = el.querySelector("[data-src-mp3], audio[src], source[src]");
    return a ? absUrl(a.getAttribute("data-src-mp3") || a.getAttribute("src") || "", url) : undefined;
  };
  for (const pron of Array.from(doc.querySelectorAll(".pron"))) addPron(pron.textContent || "", audioFrom(pron));
  for (const ph of Array.from(doc.querySelectorAll(".phon"))) addPron(ph.textContent || "");

  const hasAccent = ukPron || usPron;
  const phonetic = hasAccent
    ? (ukPron === usPron ? phonText(ukPron) : [ukPron ? `UK ${phonText(ukPron)}` : "", usPron ? `US ${phonText(usPron)}` : ""].filter(Boolean).join(" · "))
    : plainPron ? phonText(plainPron) : undefined;
  const audioUrl: DictResult["audioUrl"] = ukAudio || usAudio
    ? { uk: ukAudio || undefined, us: usAudio || undefined }
    : plainAudio || undefined;

  // 释义：.hom .sense（中文 zh + 英文 def 成对）
  const defs: DictDefinition[] = [];
  const seen = new Set<string>();
  for (const hom of homs) {
    for (const el of Array.from(hom.querySelectorAll(".sense"))) {
      const r = senseToDef(el);
      if (!r) continue;
      const key = [r.pos || "", r.zh || "", r.meaning].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      defs.push(r);
    }
  }
  if (defs.length === 0) return null;
  return {
    word,
    phonetic,
    audioUrl,
    definitions: defs,
    source: ONLINE_DICT_NAMES.collins,
    sourceUrl: url,
  };
}

function senseToDef(el: Element): DictDefinition | null {
  const posEl = el.querySelector("[class*='gram'], [class*='pos'], [class*='type']");
  const posText = clean(posEl?.textContent);
  let pos = "";
  if (posText && posText.length <= 16 && /^[A-Z]/.test(posText)) pos = friendlyPos(posText);

  let zh = "";
  for (const l of Array.from(el.querySelectorAll(".lang"))) {
    const cls = String(l.className || "");
    if (/ZH|zh|CHN|中文/i.test(cls) || /[\u4e00-\u9fff]/.test(l.textContent || "")) {
      const t = clean(l.textContent);
      if (t.length > zh.length) zh = t;
    }
  }
  const defs: string[] = [];
  for (const d of Array.from(el.querySelectorAll(".def, .cobuild"))) {
    const t = clean(d.textContent);
    if (t && !(zh && zh.length > 3 && t === zh)) defs.push(t);
  }
  if (defs.length === 0) {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(".sensenum, .sense, .lang, .gram, .audio_play_button, script, style").forEach((n) => n.remove());
    const rest = clean(clone.textContent);
    if (rest && !(zh && zh.length > 3 && rest === zh)) defs.push(rest);
  }
  const en = defs.join(" ");
  if (!zh && !en) return null;
  const def: DictDefinition = { meaning: en || zh };
  if (zh) def.zh = zh;
  if (pos) def.pos = pos;
  // 该义项第一条例句
  const q = el.querySelector(".quote");
  if (q) {
    const qEn = clean(q.querySelector(".quote_content")?.textContent || q.textContent);
    const qZh = clean(q.querySelector(".quote_translation, .lang")?.textContent);
    if (qEn) { def.example = qEn; if (qZh) def.exampleZh = qZh; }
  }
  return def;
}
