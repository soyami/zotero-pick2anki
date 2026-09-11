// ============ 适配器：牛津高阶学习者词典（英英，HTML 尽力解析） ============
import type { DictAdapter, DictDefinition, DictResult } from "./dict-types";
import { ONLINE_DICT_NAMES } from "./settings";
import { absUrl, clean, fetchText, friendlyPos, joinPhonetic, parseHtml, slugify } from "./dict-utils";

const entryUrls = (word: string): string[] => {
  const base = `https://www.oxfordlearnersdictionaries.com/definition/english/${slugify(word)}`;
  return [base, `${base}_1`, `${base}_2`];
};

export const oxfordAdapter: DictAdapter = {
  id: "oxford",
  name: ONLINE_DICT_NAMES.oxford,
  sourceUrlFor: (word) => entryUrls(word)[0],
  async lookup(word) {
    let lastErr = "";
    for (const url of entryUrls(word)) {
      try {
        const html = await fetchText(url);
        const r = parseToDict(word, html, url);
        if (r) return r;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    console.warn("[pick2anki] 牛津未查询到，词条:", word, lastErr);
    return null;
  },
};

function parseToDict(word: string, html: string, url: string): DictResult | null {
  const doc = parseHtml(html);
  const body = doc.body ? doc.body.textContent || "" : "";
  if (doc.querySelector("title")?.textContent?.includes("404") || !body || body.length < 200) return null;

  // 音标 + 音频（.phons_br / .phons_n_am 内含 .sound[data-src-mp3] 与 .phon）
  let ukPron = "", usPron = "", ukAudio = "", usAudio = "";
  let phonSections = Array.from(doc.querySelectorAll(".phons_br, .phons_n_am"));
  if (phonSections.length === 0) phonSections = Array.from(doc.querySelectorAll(".pron-uk, .pron-us"));
  for (const el of phonSections) {
    const cls = String(el.className || "");
    const phonEl = el.querySelector(".phon");
    const txt = clean(phonEl?.textContent || "");
    if (!txt) continue;
    const auEl = el.querySelector("[data-src-mp3]");
    const au = auEl ? absUrl(auEl.getAttribute("data-src-mp3") || "", url) : "";
    if (/uk/i.test(cls)) { ukPron = ukPron || txt; ukAudio = ukAudio || au; }
    else if (/us|ame|n_am/i.test(cls)) { usPron = usPron || txt; usAudio = usAudio || au; }
  }
  // 页面所有 data-src-mp3（缺文案时仅提供发音）
  let phonetic = ukPron || usPron ? joinPhonetic(ukPron, usPron) : undefined;
  let audioUrl: DictResult["audioUrl"] = ukAudio || usAudio ? { uk: ukAudio || undefined, us: usAudio || undefined } : undefined;
  if (!phonetic && !audioUrl) {
    for (const a of Array.from(doc.querySelectorAll("[data-src-mp3]"))) {
      const p = absUrl(a.getAttribute("data-src-mp3") || "", url);
      if (p) { audioUrl = p; break; }
    }
  }

  // 词性（页头 <span class="pos">，如 noun / verb）
  let posGlobal = "";
  const posEl = doc.querySelector(".pos, .top-container .pos, .webtop .pos");
  if (posEl) posGlobal = friendlyPos(clean(posEl.textContent).replace(/^\./, ""));

  // 释义：li.sense（含 .def 与 .x 例句）
  const defs: DictDefinition[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll("li.sense, .senses_multiple > li, .senses > li, section .sense, .entry .sense"))) {
    const defEl = el.querySelector(".def");
    const def = clean(defEl?.textContent || el.textContent);
    if (!def || seen.has(def.slice(0, 40))) continue;
    seen.add(def.slice(0, 40));
    const d: DictDefinition = { meaning: def };
    if (posGlobal) d.pos = posGlobal;
    const x = el.querySelector(".x");
    const t = clean(x?.textContent);
    if (t) d.example = t;
    defs.push(d);
  }
  if (defs.length === 0) {
    // 直接收 .def
    for (const d of Array.from(doc.querySelectorAll(".def"))) {
      const t = clean(d.textContent);
      if (t) defs.push({ pos: posGlobal || undefined, meaning: t });
    }
  }
  if (defs.length === 0) return null;
  return {
    word,
    phonetic,
    audioUrl,
    definitions: defs,
    source: ONLINE_DICT_NAMES.oxford,
    sourceUrl: url,
  };
}
