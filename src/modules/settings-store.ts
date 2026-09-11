// ============ 设置持久化（Zotero 偏好 ↔ Pick2ankiSettings） ============
// Obsidian 版把整个设置对象存在 data.json；Zotero 插件没有这个概念，改用 Zotero 偏好
// （about:config 里的 extensions.zotero.zoteropick2anki.*），一个键对应一个设置项，
// 键名与 Obsidian 版 schema 完全一致；数组/对象（onlineDictSources / ankiFieldMap）
// 以 JSON 字符串存放，以便迁移时逐键对照。
import { config } from "../../package.json";
import type { AnkiFieldSource, OnlineDictSource, Pick2ankiSettings } from "./settings";
import { ANKI_FIELD_SOURCES, DEFAULT_SETTINGS, ONLINE_DICT_SOURCES } from "./settings";
import { log } from "./env";

const PREFIX = config.prefsPrefix;

/** 需要 JSON 序列化存储的键（Zotero 偏好只支持 bool / int / string / 浮点） */
const JSON_KEYS: ReadonlyArray<keyof Pick2ankiSettings> = ["onlineDictSources", "ankiFieldMap"];

type ZoteroPrefs = {
  get(key: string, global?: boolean): unknown;
  set(key: string, value: unknown, global?: boolean): void;
  clear(key: string, global?: boolean): void;
};

function prefs(): ZoteroPrefs {
  const p = (globalThis as unknown as { Zotero?: { Prefs?: unknown } }).Zotero?.Prefs as ZoteroPrefs | undefined;
  if (!p) throw new Error("Zotero.Prefs 不可用（本模块只能在 Zotero 插件环境内调用）");
  return p;
}

/** 读单个偏好原始值 */
function readRaw(key: string): unknown {
  try {
    return prefs().get(`${PREFIX}.${key}`, true);
  } catch {
    return undefined;
  }
}

/** 写单个偏好原始值（undefined → 清除，回到默认） */
function writeRaw(key: string, value: unknown): void {
  const full = `${PREFIX}.${key}`;
  if (value === undefined || value === null) {
    try { prefs().clear(full, true); } catch { /* 已不存在则忽略 */ }
    return;
  }
  prefs().set(full, value, true);
}

function encode(key: keyof Pick2ankiSettings, value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (JSON_KEYS.includes(key)) return JSON.stringify(value);
  if (typeof value === "number") return Math.round(value); // Zotero 偏好 int
  if (typeof value === "boolean") return value;
  return String(value);
}

function decode<K extends keyof Pick2ankiSettings>(key: K, raw: unknown): Pick2ankiSettings[K] | undefined {
  const def = DEFAULT_SETTINGS[key];
  if (raw === undefined || raw === null) return undefined;
  if (JSON_KEYS.includes(key)) {
    if (typeof raw !== "string" || !raw) return undefined;
    try { return JSON.parse(raw) as Pick2ankiSettings[K]; } catch { return undefined; }
  }
  if (typeof def === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return (Number.isFinite(n) ? n : undefined) as Pick2ankiSettings[K] | undefined;
  }
  if (typeof def === "boolean") {
    if (typeof raw === "boolean") return raw as Pick2ankiSettings[K];
    return (String(raw) === "true") as Pick2ankiSettings[K];
  }
  return String(raw) as Pick2ankiSettings[K];
}

// 说明：这里刻意不缓存设置对象（见 getSettings 的注释）。

/** 规范化：过滤非法词典源/字段映射、补齐空值。
 *  load 与 save 都走这里，保证「写进偏好的就是合法值」，导入非法 JSON 也不会污染设置。 */
function normalize(input: Pick2ankiSettings): Pick2ankiSettings {
  const out: Pick2ankiSettings = { ...DEFAULT_SETTINGS, ...input };
  // 词典源：过滤非法 id；空数组则回落到默认（与 Obsidian 版 loadSettings 一致）
  const srcs = (Array.isArray(out.onlineDictSources) ? out.onlineDictSources : [])
    .filter((s): s is OnlineDictSource => (ONLINE_DICT_SOURCES as string[]).includes(s));
  out.onlineDictSources = srcs.length > 0 ? srcs : [...DEFAULT_SETTINGS.onlineDictSources];
  // 字段映射：只保留合法的内容源键
  const map = (out.ankiFieldMap && typeof out.ankiFieldMap === "object") ? out.ankiFieldMap : {};
  const cleanMap: Partial<Record<AnkiFieldSource, string>> = {};
  for (const src of ANKI_FIELD_SOURCES) {
    const field = map[src];
    if (typeof field === "string" && field.trim()) cleanMap[src] = field.trim();
  }
  out.ankiFieldMap = cleanMap;
  if (!out.ankiConnectUrl) out.ankiConnectUrl = DEFAULT_SETTINGS.ankiConnectUrl;
  if (!out.ankiTags) out.ankiTags = DEFAULT_SETTINGS.ankiTags;
  if (!Number.isFinite(out.popupWidth) || out.popupWidth < 240) {
    out.popupWidth = DEFAULT_SETTINGS.popupWidth;
  } else {
    out.popupWidth = Math.min(720, Math.round(out.popupWidth));
  }
  if (!Number.isFinite(out.popupMaxHeight) || out.popupMaxHeight < 120) {
    out.popupMaxHeight = DEFAULT_SETTINGS.popupMaxHeight;
  }
  if (out.triggerMode !== "ctrl") out.triggerMode = "direct";
  if (out.ankiDup !== "add") out.ankiDup = "skip";
  if (out.ankiDupScope !== "model") out.ankiDupScope = "deck";
  return out;
}

/** 读取全部设置（合并默认值 + 规范化，语义对齐 Obsidian 版 loadSettings） */
export function loadSettings(): Pick2ankiSettings {
  const raw: Pick2ankiSettings = { ...DEFAULT_SETTINGS };
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Pick2ankiSettings>;
  for (const key of keys) {
    const v = decode(key, readRaw(key as string));
    if (v !== undefined) (raw as unknown as Record<string, unknown>)[key as string] = v;
  }
  return normalize(raw);
}

/** 当前设置。
 *  注意：每次都从 Zotero 偏好现读（不缓存）——插件本体与设置面板是两个独立的 bundle，
 *  各自缓存会让面板改完设置后、弹窗仍用旧值（Zotero.Prefs 是内存读取，开销可忽略）。 */
export function getSettings(): Pick2ankiSettings {
  return loadSettings();
}

/** 写回全部设置（先规范化，再逐键落盘） */
export function saveSettings(patch?: Partial<Pick2ankiSettings>): Pick2ankiSettings {
  const next = normalize({ ...getSettings(), ...(patch || {}) });
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Pick2ankiSettings>;
  for (const key of keys) {
    writeRaw(key as string, encode(key, next[key]));
  }
  return next;
}

/** 更新单个设置项并立即持久化（同样先规范化，例如过滤非法的字段映射键） */
export function setSetting<K extends keyof Pick2ankiSettings>(key: K, value: Pick2ankiSettings[K]): void {
  const next = normalize({ ...getSettings(), [key]: value });
  writeRaw(key as string, encode(key, next[key]));
}

/** 恢复默认值：清空所有插件偏好，随即回落到 addon/prefs.js 里声明的默认值 */
export function resetSettings(): Pick2ankiSettings {
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Pick2ankiSettings>;
  for (const key of keys) writeRaw(key as string, undefined);
  return loadSettings();
}

/** 导出为 JSON 字符串（备份 / 排查问题用） */
export function exportSettingsJson(): string {
  return JSON.stringify(getSettings(), null, 2);
}

/**
 * 从 JSON 导入设置。
 * 支持两种来源：本插件导出的 JSON；以及 Obsidian 版 Pick2anki 的
 * `.obsidian/plugins/pick-to-anki/data.json`（键名一致，可直接粘贴导入）。
 */
export function importSettingsJson(json: string): { ok: boolean; message: string; applied: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, message: "JSON 解析失败：" + (e instanceof Error ? e.message : String(e)), applied: 0 };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "JSON 内容不是设置对象", applied: 0 };
  }
  const data = parsed as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Pick2ankiSettings>;
  const patch: Record<string, unknown> = {};
  let applied = 0;
  for (const key of keys) {
    if (!(key in data)) continue;
    const decoded = decode(key, JSON_KEYS.includes(key) ? JSON.stringify(data[key]) : data[key]);
    if (decoded === undefined) continue;
    patch[key as string] = decoded;
    applied++;
  }
  if (applied === 0) return { ok: false, message: "没有识别到任何设置项（请确认粘贴的是 data.json 内容）", applied: 0 };
  const saved = saveSettings(patch as Partial<Pick2ankiSettings>);
  log(`导入设置完成，共应用 ${applied} 项：${saved.onlineDictSources.join(",")}`);
  return { ok: true, message: `已导入 ${applied} 项设置`, applied };
}
