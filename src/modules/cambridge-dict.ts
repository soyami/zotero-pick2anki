// ============ 适配器：剑桥词典（英英 + 例句，HTML 尽力解析） ============
import type { DictAdapter, DictDefinition, DictResult } from "./dict-types";
import { ONLINE_DICT_NAMES } from "./settings";
import { absUrl, clean, fetchText, friendlyPos, joinPhonetic, parseHtml, slugify } from "./dict-utils";

const entryUrl = (word: string) => `https://dictionary.cambridge.org/dictionary/english/${slugify(word)}`;

export const cambridgeAdapter: DictAdapter = {
  id: "cambridge",
  name: ONLINE_DICT_NAMES.cambridge,
  sourceUrlFor: entryUrl,
  async lookup(word) {
    try {
      const html = await fetchText(entryUrl(word));
      return parseToDict(word, html);
    } catch (e) {
      console.warn("[pick2anki] 剑桥查询失败，词条:", word, e instanceof Error ? e.message : String(e));
      return null;
    }
  },
};

function parseToDict(word: string, html: string): DictResult | null {
  const doc = parseHtml(html);
  if (doc.querySelector("title")?.textContent?.includes("doesn't have a definition")) return null;

  // 音标 + 发音（us / uk 容器内含 .pron.dpron 与 audio source）
  let ukPron = "", usPron = "";
  const ukAudio: string[] = [];
  const usAudio: string[] = [];
  for (const el of Array.from(doc.querySelectorAll(".pron.dpron"))) {
    const holder = el.closest?.('[class~="uk"], [class~="us"]');
    if (!holder) continue;
    const ipa = el.querySelector(".ipa");
    const raw = clean(ipa?.textContent || "");
    if (!raw) continue;
    const src = el.querySelector('source[src], [data-src-mp3]');
    const au = src ? absUrl(src.getAttribute("src") || src.getAttribute("data-src-mp3") || "", entryUrl(word)) : undefined;
    if (holder.classList.contains("uk")) {
      ukPron = ukPron || raw;
      if (au) ukAudio.push(au);
    } else if (holder.classList.contains("us")) {
      usPron = usPron || raw;
      if (au) usAudio.push(au);
    }
  }
  const phonetic = ukPron || usPron ? joinPhonetic(ukPron, usPron) : undefined;
  const audioUrl: DictResult["audioUrl"] = ukAudio[0] || usAudio[0]
    ? { uk: ukAudio[0], us: usAudio[0] }
    : undefined;

  // 释义：def-block 内 .def.ddef_d.db（英英）
  const defs: DictDefinition[] = [];
  const seen = new Set<string>();
  for (const block of Array.from(doc.querySelectorAll(".def-block.ddef_block"))) {
    const defEl = block.querySelector(".def.ddef_d.db");
    const en = clean(defEl?.textContent || "");
    if (!en || seen.has(en.slice(0, 60))) continue;
    seen.add(en.slice(0, 60));
    const dsense = block.closest(".pr.dsense");
    const posRaw = clean(dsense?.querySelector(".pos.dsense_pos")?.textContent);
    const def: DictDefinition = { meaning: en };
    const pos = friendlyPos(posRaw);
    if (pos) def.pos = pos;
    // 该义项第一条例句
    const ex = block.querySelector(".examp .eg, .examp");
    const exT = clean(ex?.textContent);
    if (exT) def.example = exT;
    defs.push(def);
  }
  if (defs.length === 0) return null;
  return {
    word,
    phonetic,
    audioUrl,
    definitions: defs,
    source: ONLINE_DICT_NAMES.cambridge,
    sourceUrl: entryUrl(word),
  };
}
