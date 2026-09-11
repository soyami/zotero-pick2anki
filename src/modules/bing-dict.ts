// ============ 适配器：必应词典（英汉，HTML 尽力解析） ============
import type { DictAdapter, DictDefinition, DictResult } from "./dict-types";
import { ONLINE_DICT_NAMES } from "./settings";
import { absUrl, clean, fetchText, friendlyPos, joinPhonetic, parseHtml } from "./dict-utils";

const entryUrl = (word: string) => `https://cn.bing.com/dict/search?q=${encodeURIComponent(word)}`;

export const bingAdapter: DictAdapter = {
  id: "bing",
  name: ONLINE_DICT_NAMES.bing,
  sourceUrlFor: entryUrl,
  async lookup(word) {
    try {
      const html = await fetchText(entryUrl(word));
      return parseToDict(word, html);
    } catch (e) {
      console.warn("[pick2anki] 必应查询失败，词条:", word, e instanceof Error ? e.message : String(e));
      return null;
    }
  },
};

function parseToDict(word: string, html: string): DictResult | null {
  const doc = parseHtml(html);
  const qdef = doc.querySelector(".qdef");
  if (!qdef) return null;

  // 音标 + 发音
  const addAccent = (text: unknown, href?: string | null) => {
    const m = clean(text).match(/[[【（(]\s*([^\]】）)]+)\s*[\]】）)]/);
    const body = m ? m[1] : clean(text);
    return body.replace(/^(英|美|英国|美国)\s*/i, "");
  };
  const usAnchor = qdef.querySelector("#bigaud_us");
  const ukAnchor = qdef.querySelector("#bigaud_uk");
  const usMp3 = usAnchor ? absUrl(usAnchor.getAttribute("data-mp3link") || "", "https://cn.bing.com") : undefined;
  const ukMp3 = ukAnchor ? absUrl(ukAnchor.getAttribute("data-mp3link") || "", "https://cn.bing.com") : undefined;
  const usPron = addAccent(qdef.querySelector(".hd_prUS")?.textContent);
  const ukPron = addAccent(qdef.querySelector(".hd_pr")?.textContent);
  const phonetic = ukPron || usPron ? joinPhonetic(ukPron, usPron) : undefined;
  const audioUrl: DictResult["audioUrl"] = ukMp3 || usMp3
    ? { uk: ukMp3, us: usMp3 }
    : undefined;

  // 释义：ul > li 的 span.pos + span.def
  const defs: DictDefinition[] = [];
  const seen = new Set<string>();
  for (const li of Array.from(qdef.querySelectorAll("ul > li"))) {
    const posEl = li.querySelector(".pos");
    const defEl = li.querySelector(".def");
    if (!posEl || !defEl) continue;
    const posText = clean(posEl.textContent);
    if (/web|网络/i.test(posText)) continue; // 跳过网络释义
    const zh = clean(defEl.textContent);
    if (!zh || seen.has(zh)) continue;
    seen.add(zh);
    const pos = friendlyPos(posText) || undefined;
    defs.push(pos ? { pos, meaning: zh } : { meaning: zh });
  }
  if (defs.length === 0) return null;
  return { word, phonetic, audioUrl, definitions: defs, source: ONLINE_DICT_NAMES.bing, sourceUrl: entryUrl(word) };
}

