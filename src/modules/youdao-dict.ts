// ============ 适配器：有道词典（柯林斯英汉双解官方授权 + 双语例句） ============
// 解析规则（固定）：
//   主源   collins_primary：gramcat[].{partofspeech, pronunciation, audiourl, senses[]}
//               senses[].{definition=英文, word=中文, examples[].{example, sense.word=例句中文}}
//   补充   blng_sents_part.sentence-pair[]（sentence / sentence-translation）
//              collins_primary 缺失/为空 → simple(音标) + ec / expand_ec(释义)
// 输出    统一 DictResult（无 definitions 时返回 null ）
import type { DictAdapter, DictDefinition, DictResult } from "./dict-types";
import { ONLINE_DICT_NAMES } from "./settings";
import { asArray, asDict, asStr, clean, fetchText, friendlyPos, joinPhonetic, phonText, stripHtml, strOf } from "./dict-utils";

const apiUrl = (word: string) => `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}&doctype=json&jsonversion=2`;

function makeAdapter(): DictAdapter {
  const sourceName = ONLINE_DICT_NAMES.youdao;

  return {
    id: "youdao",
    name: sourceName,
    sourceUrlFor: (word) => `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`,
    async lookup(word) {
      try {
        const txt = await fetchText(apiUrl(word));
        const json: unknown = JSON.parse(txt);
        return parseToDict(word, json);
      } catch (e) {
        console.warn("[pick2anki] 有道查询失败，词条:", word, e instanceof Error ? e.message : String(e));
        return null;
      }
    },
  };

  /** 原始 JSON → 统一结构；无有效释义返回 null */
  function parseToDict(word: string, json: unknown): DictResult | null {
    const root = asDict(json);
    if (!Object.keys(root).length) return null;
    const errCode = asStr(root.errorCode);
    if (errCode && errCode !== "0") return null;

    const url = `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`;
    const defs: DictDefinition[] = [];
    const extras: string[] = [];
    const extraExamples: DictResult["examples"] = [];
    const exSeen = new Set<string>();
    const addExtraEx = (en: unknown, zh?: unknown): void => {
      const en0 = stripHtml(en);
      const zh0 = clean(zh);
      if (!en0 && !zh0) return;
      const key = en0 || zh0;
      if (!exSeen.has(key)) { exSeen.add(key); extraExamples.push({ en: en0 || "", zh: zh0 || undefined }); }
    };
    const exOf = (def: DictDefinition, arr: unknown): void => {
      for (const rawEx of asArray(arr)) {
        const ex = asDict(rawEx);
        const en = stripHtml(ex.example ?? ex.sentence);
        const zh = clean(asDict(ex.sense).word ?? ex.translation);
        if (!def.example && en) { def.example = en; def.exampleZh = zh || undefined; }
        addExtraEx(en || undefined, zh || undefined);
      }
    };

    const ec = asDict(root.ec);
    const wordArr = asArray(ec.word);
    const w0 = asDict(wordArr[0]);
    const simp = asDict(asArray(asDict(root.simple).word)[0]);
    const audioParam = word.trim().replace(/\s+/g, "+");
    const dictvoice = (type: number) => (audioParam ? `https://dict.youdao.com/dictvoice?audio=${audioParam}&type=${type}` : undefined);

    // ---- 1) 主源 collins_primary ----
    const cp = asDict(root.collins_primary);
    const gramcats = asArray(cp.gramcat);
    let firstPron = "";
    let firstAudio = "";
    const cpForms = new Set<string>();
    const senseSeen = new Set<string>();
    const pushSense = (pos: string | undefined, zh: string, en: string, arr: unknown): void => {
      const key = [pos || "", zh, en].join("|");
      if (senseSeen.has(key) || (!zh && !en)) return;
      senseSeen.add(key);
      const def: DictDefinition = { meaning: en || zh || "" };
      if (zh) def.zh = zh;
      if (pos) def.pos = pos;
      exOf(def, arr);
      if (def.meaning) defs.push(def);
    };
    for (const rawGc of gramcats) {
      const gc = asDict(rawGc);
      const pos = friendlyPos(clean(gc.partofspeech)) || undefined;
      const pron = clean(gc.pronunciation);
      const gcAudio = asStr(gc.audiourl);
      if (pron && !firstPron) firstPron = pron;
      if (gcAudio && !firstAudio) firstAudio = gcAudio;
      for (const rawF of asArray(gc.forms)) {
        const f = clean(asDict(rawF).form);
        if (f) cpForms.add(f);
      }
      for (const rawSense of asArray(gc.senses)) {
        const s = asDict(rawSense);
        pushSense(pos, clean(s.word), stripHtml(s.definition), s.examples);
        for (const rawD of asArray(s.derivatives)) {
          const d = asDict(rawD);
          const dPos = friendlyPos(clean(d.partofspeech)) || pos;
          for (const rawDs of asArray(d.sense)) {
            const ds = asDict(rawDs);
            pushSense(dPos, clean(ds.word), stripHtml(ds.definition), ds.examples);
          }
          pushSense(dPos, clean(d.word), stripHtml(d.definition), d.examples);
        }
      }
    }
    if (gramcats.length > 0 && defs.length === 0) {
      console.warn("[pick2anki] 有道 collins_primary 结构未命中解析规则，请补充规则。词条:", word, JSON.stringify(cp).slice(0, 600));
    }
    if (cpForms.size) extras.push("词形：" + Array.from(cpForms).slice(0, 8).join("；"));

    // ---- 2) 音标与音频：柯林斯优先，simple补充 ----
    const usPhone = clean(simp.usphone);
    const ukPhone = clean(simp.ukphone) || clean(ec.phonetic);
    let phonetic: string | undefined;
    let audio: DictResult["audioUrl"];
    if (firstPron) phonetic = phonText(firstPron);
    if (firstAudio) audio = firstAudio;
    else {
      const uk = ukPhone ? phonText(ukPhone) : "";
      const us = usPhone ? phonText(usPhone) : "";
      if (uk && us && uk !== us) {
        if (!phonetic) phonetic = `UK ${uk} · US ${us}`;
        audio = { uk: dictvoice(1), us: dictvoice(2) };
      } else {
        const one = uk || us;
        if (!phonetic) phonetic = one || undefined;
        audio = uk ? dictvoice(1) : us ? dictvoice(2) : undefined;
      }
    }
    // ec 音标
    if (!phonetic) {
      const uk2 = clean(w0.ukphone) || clean(ec.phonetic);
      const us2 = clean(w0.usphone);
      phonetic = joinPhonetic(uk2, us2);
    }

    // ---- 3) 释义：collins 无释义 → expand_ec / ec.trs ----
    if (defs.length === 0) {
      const exp = asDict(root.expand_ec);
      const groups = asArray(exp.word);
      const fallbackForms: string[] = [];
      const examSet = new Set<string>();
      if (groups.length > 0) {
        for (const rawG of groups) {
          const g = asDict(rawG);
          const gpos = clean(g.pos);
          for (const rawWf of asArray(g.wfs)) {
            const wf = asDict(rawWf);
            const name = clean(wf.name), value = clean(wf.value);
            if (name && value) fallbackForms.push(`${name} ${value}`);
          }
          for (const rawT of asArray(g.transList)) {
            const t = asDict(rawT);
            const trans = stripHtml(t.trans ?? t.tran);
            if (!trans) continue;
            const content = asDict(t.content);
            const pos = friendlyPos(clean(content.detailPos) || gpos) || undefined;
            const def: DictDefinition = { meaning: trans };
            if (pos) def.pos = pos;
            const exs = asArray(content.sents);
            if (exs.length) {
              const st = asDict(exs[0]);
              def.example = stripHtml(st.sentOrig ?? st.sentSpeech ?? st.sentence) || undefined;
              def.exampleZh = clean(st.sentTrans ?? st.sentenceTrans) || undefined;
            }
            defs.push(def);
            for (const rawEt of asArray(content.examType)) {
              const et = asDict(rawEt);
              const z = clean(et.zh) || clean(et.en);
              if (z) examSet.add(z);
            }
          }
        }
      } else {
        // 粗解析：ec.word[0].trs 结构 [{tr:[{l:{i:[“n. 单词；话语…”]}}]}]
        for (const rawItem of asArray(w0.trs)) {
          const item = asDict(rawItem);
          for (const rawTr of asArray(item.tr)) {
            const tr = asDict(rawTr);
            const text = strOf(asDict(tr.l).i);
            if (!text) continue;
            const m = text.match(/^\s*((?:n|v|vt|vi|adj|adv|prep|pron|conj|int|num|art|abbr|aux)\.)\s*/i);
            defs.push({
              pos: m ? friendlyPos(m[1]) : undefined,
              meaning: m ? text.slice(m[0].length).trim() : text,
            });
          }
        }
        for (const rawWf of asArray(w0.wfs)) {
          const wf = asDict(asDict(rawWf).wf);
          const name = clean(wf.name), value = clean(wf.value);
          if (name && value) fallbackForms.push(`${name} ${value}`);
        }
      }
      if (fallbackForms.length && !cpForms.size) extras.push("词形：" + fallbackForms.slice(0, 8).join("；"));
      if (examSet.size) extras.push("考试范围：" + Array.from(examSet).slice(0, 8).join(" / "));
    }

    // ---- 4) 常用短语与双语例句补充 ----
    const phrs: string[] = [];
    for (const rawP of asArray(asDict(root.phrs).phrs)) {
      const p = asDict(rawP);
      const phr = asDict(p.phr ?? p);
      const hw = asDict(phr.headword);
      const head = strOf(asDict(hw.l).i);
      if (!head) continue;
      const tr0 = asDict(asArray(phr.trs)[0]);
      const transl = strOf(asDict(asDict(tr0.tr).l).i);
      if (head.length <= 60) phrs.push(transl ? `${head} → ${transl}` : head);
    }
    if (phrs.length) extras.push("常用短语：" + phrs.slice(0, 6).join("；"));
    const blng = asDict(root.blng_sents_part);
    const auth = asDict(root.auth_sents_part);
    const pairs = [...asArray(blng["sentence-pair"]), ...asArray(auth["sentence-pair"])];
    for (const rawSp of pairs) {
      const sp = asDict(rawSp);
      addExtraEx(sp["sentence-eng"] ?? sp.sentence ?? sp.sentenceEng, sp["sentence-translation"] ?? sp.sentenceTrans);
    }

    if (defs.length === 0) return null; // 无释义不产出，走其它源
    const result: DictResult = {
      word,
      phonetic: phonetic || undefined,
      audioUrl: audio,
      definitions: defs,
      examples: extraExamples.length ? extraExamples : undefined,
      source: sourceName,
      sourceUrl: url,
      extras: extras.length ? extras : undefined,
      raw: json,
    };
    return result;
  }
}

export const youdaoAdapter = makeAdapter();
