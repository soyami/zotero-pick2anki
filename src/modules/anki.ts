// ============ AnkiConnect 写卡（Anki 桌面端 + AnkiConnect 插件） ============
// 通过 http://127.0.0.1:8765 的 JSON-RPC 读写 Anki：
// - 读取牌组 / 模板 / 模板字段，供设置页做下拉与“固定内容源 → 模板字段名”映射
// - 生成单词卡内容（单词/原句/音标/单一释义/全部释义/例句/额外信息/来源地址）
// - 音频：优先使用词典在线发音 mp3（柯林斯/牛津/有道），失败回退 Edge TTS 合成，
//   先 storeMediaFile 存入 Anki 媒体库，再以 [sound:xxx.mp3] 引用
// 【移植说明】与原版差异仅在三处环境依赖上：requestUrl → http.ts（Zotero.HTTP）、
// crypto.createHash("md5") → sha256.ts、btoa → env.bytesToBase64；
// 另外新增可选的 input.cite（文献条目信息），用于“原句/来源”字段在 Zotero 里补上下文。
import type { AnkiFieldSource, Pick2ankiSettings } from "./settings";
import { ANKI_FIELD_SOURCES } from "./settings";
import type { DictLookupBundle } from "./online-dict";
import {
  bundleAudioCandidates, bundlePhoneticText, bundleSourceText, dictHasContent,
} from "./online-dict";
import { allDefsHtml, escHtml, examplesHtml, extrasHtml, singleDefHtml } from "./dict-html";
import { edgeSynth, EDGE_VOICES } from "./edge-tts";
import { fetchBinary as httpFetchBinary, request } from "./http";
import { bytesToBase64 } from "./env";
import { sha256Hex } from "./sha256";

// ---------- 底层 JSON-RPC ----------
interface AnkiEnvelope<T> { result?: T; error?: string }

export async function ankiInvoke<T>(action: string, params: unknown, url: string): Promise<T> {
  let resp;
  try {
    resp = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      timeout: 30000,
    });
  } catch (e) {
    throw new Error("无法连接 AnkiConnect：" + (e instanceof Error ? e.message : String(e))
      + "。请先启动 Anki 并安装/启用 AnkiConnect 插件（工具→插件→AnkiConnect）。");
  }
  if (!resp || resp.status === 0 || resp.status >= 400) {
    throw new Error(`AnkiConnect HTTP ${resp?.status ?? 0}：无法访问 ${url}`);
  }
  let data: AnkiEnvelope<T>;
  try { data = resp.json as AnkiEnvelope<T>; }
  catch { throw new Error("AnkiConnect 返回内容不是合法 JSON"); }
  if (!data || typeof data !== "object") throw new Error("AnkiConnect 返回内容不是合法 JSON");
  if (typeof data.error === "string" && data.error) throw new Error("Anki 错误：" + data.error);
  return data?.result as T;
}

export async function ankiVersion(url: string): Promise<number> {
  return ankiInvoke<number>("version", {}, url);
}

export async function fetchAnkiDecks(s: Pick2ankiSettings): Promise<string[]> {
  const decks = await ankiInvoke<string[]>("deckNames", {}, s.ankiConnectUrl);
  return Array.isArray(decks) ? decks.sort((a, b) => a.localeCompare(b)) : [];
}

export async function fetchAnkiModels(s: Pick2ankiSettings): Promise<string[]> {
  const models = await ankiInvoke<string[]>("modelNames", {}, s.ankiConnectUrl);
  return Array.isArray(models) ? models.sort((a, b) => a.localeCompare(b)) : [];
}

export async function fetchAnkiModelFields(s: Pick2ankiSettings, model: string): Promise<string[]> {
  const fields = await ankiInvoke<string[]>("modelFieldNames", { modelName: model }, s.ankiConnectUrl);
  return Array.isArray(fields) ? fields : [];
}

// ---------- 字段内容构建 ----------
/** 来源信息引用：name = 文献条目标题，uri = zotero:// 条目链接（对应 Obsidian 版的笔记名/笔记链接） */
export interface CardNoteRef { name: string; uri?: string; path?: string }

export interface CardInput {
  word: string;                          // 单词/词组
  contextSentence?: string;              // 原句：Zotero 里为 PDF/EPUB 选中文本（或扩写出的完整句子）
  note?: CardNoteRef;                    // 条目名 + zotero:// 链接
  cite?: string;                         // 文献条目信息（作者 · 年份 · 期刊），Zotero 版新增
  bundle?: DictLookupBundle | null;      // 结构化在线词典结果
}

export interface AddCardResult { ok: boolean; added: boolean; skipped: boolean; message: string }

/** 写卡进度回调（用于把「音频/写卡」等阶段回显到 UI，避免用户以为卡住了） */
export type CardProgress = (stage: string) => void;

/** 取第一条例句（纯文本，供“原句”字段在笔记中找不到句子时兜底） */
function firstPlainExample(bundle: DictLookupBundle | null): string {
  if (!bundle) return "";
  for (const s of bundle.sources) {
    if (!s.ok || !s.result) continue;
    for (const d of s.result.definitions) {
      if (d.example) return `${d.example}${d.exampleZh ? " — " + d.exampleZh : ""}`;
    }
    const ex = s.result.examples?.[0];
    if (ex?.en) return `${ex.en}${ex.zh ? " — " + ex.zh : ""}`;
  }
  return "";
}

/** 每个字段写入的内容均为安全的 HTML（文本已转义，词典数据经样式渲染） */
function buildFieldContent(src: AnkiFieldSource, input: CardInput, bundle: DictLookupBundle | null): string {
  switch (src) {
    case "word": return escHtml(input.word.trim());
    case "phonetic": return escHtml(bundlePhoneticText(bundle));
    case "def_single": return bundle ? singleDefHtml(bundle) : "";
    case "def_all": return bundle ? allDefsHtml(bundle) : "";
    case "examples": return bundle ? examplesHtml(bundle) : "";
    case "extra": return bundle ? extrasHtml(bundle) : "";
    case "source": {
      // 词典链接（bundleSourceText 的词典部分）+ Zotero 条目链接 + 文献条目信息
      const lines: string[] = [];
      const dictPart = bundleSourceText(bundle, undefined).trim();
      if (dictPart) lines.push(dictPart);
      if (input.note?.uri) lines.push(`条目链接：${input.note.uri}`);
      else if (input.note?.name) lines.push(`来源条目：${input.note.name}`);
      if (input.cite) lines.push(input.cite);
      return escHtml(lines.join("\n")).replace(/\n/g, "<br>");
    }
    case "context": {
      const lines: string[] = [];
      if (input.contextSentence) lines.push(input.contextSentence);
      if (input.cite) lines.push(`—— 来自 ${input.cite}`);
      else if (input.note?.name) lines.push(`—— 来自《${input.note.name}》`);
      if (!lines.length) {
        const ex = firstPlainExample(bundle);
        if (ex) lines.push(`（未取到原文句子，使用词典例句）${ex}`);
      }
      return escHtml(lines.join("\n")).replace(/\n/g, "<br>");
    }
    default: return "";
  }
}

/** 由“内容源 → 模板字段名”固定配置解析实际写入项；字段名不存在于当前模板时列入 missing */
function effectiveMapping(settings: Pick2ankiSettings, modelFields: string[]): { pairs: Array<[string, AnkiFieldSource]>; missing: string[] } {
  const set = new Set(modelFields);
  const pairs: Array<[string, AnkiFieldSource]> = [];
  const missing: string[] = [];
  const map = settings.ankiFieldMap || {};
  for (const src of ANKI_FIELD_SOURCES) {
    const field = (map[src] || "").trim();
    if (!field) continue;
    if (set.has(field)) pairs.push([field, src]);
    else missing.push(field);
  }
  return { pairs, missing };
}

// ---------- 音频 ----------
/** 原版用 crypto.createHash("md5")；插件沙箱里没有 Node crypto，改用纯 TS sha256 取前 8 位 */
function shortHash(s: string): string {
  return sha256Hex(s).slice(0, 8);
}

function sanitizeName(w: string): string {
  return w.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "word";
}

/** 下载词典发音 mp3（走 http.ts；失败返回 null，不抛异常）
 *  超时收紧到 8s：发音只是加分项，不值得让整张卡等 30s（v1.0.1 针对"➕Anki 响应慢"的调整） */
async function fetchBinary(url: string): Promise<ArrayBuffer | null> {
  const buf = await httpFetchBinary(url, 8000);
  if (!buf || buf.byteLength < 1024) return null;
  // 粗略校验：不是 HTML 错误页（mp3 以 ID3 / 0xFF 开头）
  const head = new Uint8Array(buf.slice(0, 4));
  const isMp3 = (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) // ID3
    || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);                     // 0xFFEx 帧头
  if (!isMp3) return null;
  return buf;
}

async function synthTtsBytes(text: string): Promise<ArrayBuffer | null> {
  try {
    // 原版此处拿到 Blob 再读 arrayBuffer；Zotero 版 edgeSynth 直接返回字节
    const bytes = await edgeSynth(text, EDGE_VOICES.en.female, 1, 1, 8000);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch { return null; }
}

/** 原版用 btoa；插件沙箱不保证存在，改用 env.bytesToBase64 */
function bufToBase64(buf: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buf));
}

async function storeAudio(s: Pick2ankiSettings, input: CardInput): Promise<{ fileName: string; audioRef: string } | null> {
  const word = input.word.trim();
  if (!word) return null;
  const candidates = bundleAudioCandidates(input.bundle ?? null, word);
  let bytes: ArrayBuffer | null = null;
  let usedUrl = "";
  // 最多试 2 个候选、每个 8s 超时：发音是加分项，不能拖慢写卡
  for (const u of candidates.slice(0, 2)) {
    bytes = await fetchBinary(u);
    if (bytes) { usedUrl = u; break; }
  }
  if (!bytes) {
    // HTTP 兜底：有道公开发音接口（纯 GET，最稳最快）
    const fallback = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    bytes = await fetchBinary(fallback);
    if (bytes) usedUrl = fallback;
  }
  if (!bytes && s.edgeTtsFallback) {
    // 可选兜底：Edge TTS（Zotero 下浏览器 WebSocket 无法自定义 Cookie/Origin 头，成功率低且慢，
    // 因此默认关闭，需要在设置里显式开启）
    bytes = await synthTtsBytes(word);
    usedUrl = "edge-tts";
  }
  if (!bytes) return null;
  const fileName = `p2a-${sanitizeName(word).slice(0, 24)}-${shortHash(word + "|" + usedUrl)}.mp3`;
  try {
    await ankiInvoke("storeMediaFile", { filename: fileName, data: bufToBase64(bytes) }, s.ankiConnectUrl);
    return { fileName, audioRef: `[sound:${fileName}]` };
  } catch { return null; }
}

// ---------- 主入口：写入一张单词卡 ----------
export async function addWordCard(
  s: Pick2ankiSettings,
  input: CardInput,
  modelFields?: string[],
  onProgress?: CardProgress,
): Promise<AddCardResult> {
  const fail = (msg: string): AddCardResult => ({ ok: false, added: false, skipped: false, message: msg });
  if (!s.ankiEnabled) return fail("Anki 写卡未启用（设置 → 写入 Anki 单词卡）");
  if (!s.ankiDeck) return fail("尚未选择目标牌组");
  if (!s.ankiNoteType) return fail("尚未选择目标模板");

  let fieldsList = modelFields;
  if (!fieldsList) {
    try { fieldsList = await fetchAnkiModelFields(s, s.ankiNoteType); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  const { pairs, missing } = effectiveMapping(s, fieldsList);
  if (pairs.length === 0) {
    return fail(missing.length > 0
      ? `映射字段不在模板「${s.ankiNoteType}」中：${missing.join("、")}。请在设置中核对字段名`
      : "尚未填写“内容 → 模板字段”映射（设置 → 写入 Anki 单词卡）");
  }
  const missingWarn = missing.length > 0 ? `（以下字段不在模板中，已忽略：${missing.join("、")}）` : "";

  const bundle = input.bundle && dictHasContent(input.bundle) ? input.bundle : null;
  // 同一模板字段可被多个内容源映射：内容按源顺序合并（多行），音频引用追加到末尾
  const fieldParts = new Map<string, string[]>();
  const audioFields: string[] = [];
  for (const [field, src] of pairs) {
    if (src === "audio") {
      if (!audioFields.includes(field)) audioFields.push(field);
      continue;
    }
    const content = buildFieldContent(src, input, bundle);
    if (!content) continue;
    const arr = fieldParts.get(field) ?? [];
    arr.push(content);
    fieldParts.set(field, arr);
  }

  // 音频：先存媒体库
  let audioWarn = "";
  if (audioFields.length > 0) {
    onProgress?.("音频…");
    const media = await storeAudio(s, input);
    if (media) {
      for (const f of audioFields) {
        const arr = fieldParts.get(f) ?? [];
        arr.push(media.audioRef);
        fieldParts.set(f, arr);
      }
    } else {
      audioWarn = "（音频获取失败，已跳过音频字段）";
    }
  }
  const contents: Record<string, string> = {};
  // 多个内容合并进同一字段时用轻量间距分隔（字段为 HTML）
  const JOIN = '<div style="height:6px"></div>';
  for (const [field, parts] of fieldParts) contents[field] = parts.join(JOIN);

  // 重复卡处理
  const tags = (s.ankiTags || "").split(/[,，;；\s]+/).filter(Boolean);
  const dupScopeOptions = s.ankiDupScope === "deck"
    ? { deckName: s.ankiDeck, checkChildren: false }
    : undefined;
  const options = { allowDuplicate: s.ankiDup === "add", duplicateScope: s.ankiDupScope, duplicateScopeOptions: dupScopeOptions };
  const note = { deckName: s.ankiDeck, modelName: s.ankiNoteType, fields: contents, options, tags };

  try {
    onProgress?.("写卡…");
    if (s.ankiDup === "skip") {
      const can = await ankiInvoke<boolean[]>("canAddNotes", { notes: [note] }, s.ankiConnectUrl);
      if (Array.isArray(can) && can[0] === false) {
        return { ok: true, added: false, skipped: true, message: `「${input.word}」已存在牌组「${s.ankiDeck}」中，已跳过${missingWarn}` };
      }
    }
    await ankiInvoke("addNote", { note }, s.ankiConnectUrl);
    return { ok: true, added: true, skipped: false, message: `已写入 Anki：${input.word} → ${s.ankiDeck}${audioWarn}${missingWarn}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 竞态/查重策略差异导致 addNote 抛出 duplicate 时也按“跳过”处理
    if (/duplicate|重复/i.test(msg)) {
      return { ok: true, added: false, skipped: true, message: `「${input.word}」已存在（Anki 拒绝重复），已跳过${missingWarn}` };
    }
    return fail(msg);
  }
}
