// ============ 文献条目信息（Anki“原句/来源”字段的上下文，Zotero 版新增） ============
// Obsidian 版用“当前笔记名 + obsidian:// 链接”；Zotero 里对应的概念是
// “文献条目标题 + zotero:// 条目链接 + 作者/年份等引用信息”。
// 全部按 any 防御访问：不同 Zotero 版本/条目类型（期刊论文、书籍章节、预印本）字段并不统一。
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ItemContext {
  itemID?: number;   // 顶层条目 ID
  title: string;     // 条目标题
  cite: string;      // 引用信息：《标题》· 作者 · (年份)
  uri?: string;      // zotero://select/library/items/…
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** 作者列表 → 一行字符串（最多 3 位，余者用“等”/“et al.”） */
function authorsLine(top: any): string {
  const creators: any[] = safe(() => top.getCreators?.() ?? [], []);
  const names = creators
    .map((c) => c?.lastName || c?.name || c?.firstName || "")
    .map((s: string) => String(s).trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 3) return names.join(", ");
  return names.slice(0, 3).join(", ") + " et al.";
}

/** 从 date 字段里取 4 位年份 */
function yearOf(dateStr: string): string {
  const m = /(1[5-9]\d{2}|20\d{2}|21\d{2})/.exec(dateStr || "");
  return m ? m[1] : "";
}

/** 由条目 ID（附件或顶层条目皆可）构造上下文 */
export function getItemContext(itemID: number | undefined): ItemContext | null {
  if (!itemID) return null;
  const Z = (globalThis as any).Zotero;
  if (!Z?.Items?.get) return null;
  const item = safe(() => Z.Items.get(itemID), null);
  if (!item) return null;
  // reader 给的是附件条目；这里取顶层文献条目（topLevelItem 在 7/10 都有，
  // 注释/附件逐级向上兜底，避免不同条目类型取不到元数据）
  const top = safe(() => item.topLevelItem ?? item.parentItem ?? item, item);

  const title = safe(() => String(top.getField?.("title") || ""), "").trim()
    || safe(() => String(top.getDisplayTitle?.() || ""), "").trim();
  const year = yearOf(safe(() => String(top.getField?.("date") || ""), ""));
  const authors = authorsLine(top);
  const journal = safe(() => String(top.getField?.("publicationTitle")
    || top.getField?.("bookTitle")
    || top.getField?.("proceedingsTitle")
    || top.getField?.("publisher")
    || ""), "").trim();

  const citeParts: string[] = [];
  if (title) citeParts.push(`《${title}》`);
  if (authors) citeParts.push(authors);
  if (year) citeParts.push(`(${year})`);
  if (journal) citeParts.push(quote(journal));
  const uri = safe(() => (Z.URI?.getItemURI ? String(Z.URI.getItemURI(top)) : ""), "");

  return {
    itemID: safe(() => Number(top.id), undefined as unknown as number),
    title,
    cite: citeParts.join(" · "),
    uri: uri || undefined,
  };
}

/** 期刊/出版社名用《》包起来（中文排版习惯），为空则返回空串 */
function quote(s: string): string {
  return s ? `《${s}》` : "";
}

/** 由 reader 对象取条目上下文（附件条目 → 顶层文献条目） */
export function getReaderItemContext(reader: any): ItemContext | null {
  const itemID = safe(() => Number(reader?.itemID), 0);
  return getItemContext(itemID);
}
