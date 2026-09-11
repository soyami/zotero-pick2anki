// ============ 插件对外 API（供设置面板 onload 调用） ============
// 设置面板（addon/content/preferences.xhtml）以 fragment 形式插入偏好窗口，
// 通过 Zotero.<addonInstance>.api.* 回到插件本体，避开了“面板脚本与插件沙箱互相不可见”的问题
// （架构参考 zotero-pdf-translate：面板 onload 里调用 Zotero.__addonInstance__.hooks.onPrefsLoad）。
import { renderPrefsPane } from "./prefs-ui";
import { getSettings } from "./settings-store";
import type { Pick2ankiSettings } from "./settings";
import { canUseOnlineDict, dictHasContent, lookupWordOnline } from "./online-dict";
import { log } from "./env";

/** 已经渲染过的面板根节点（避免 onload 多次触发时重复渲染） */
const rendered = new WeakSet<Element>();

export interface Pick2ankiApi {
  /** 渲染设置面板（由 preferences.xhtml 的 onload 调用） */
  renderPrefs(doc: Document, root?: Element | null): void;
  /** 当前设置（面板自测用） */
  getSettings(): Pick2ankiSettings;
  /** 查词自测：返回每个源的成败摘要 */
  testLookup(word: string): Promise<string[]>;
  /** 只查英文单词/短语的判断（面板提示用） */
  canLookup(text: string): boolean;
}

function findHost(doc: Document, root?: Element | null): HTMLElement | null {
  const byId = doc.getElementById("zopick2anki-prefs-host");
  if (byId) return byId as HTMLElement;
  const scope = root || doc;
  return (scope.querySelector?.("#zopick2anki-prefs-host") as HTMLElement | null) ?? null;
}

export const api: Pick2ankiApi = {
  renderPrefs(doc: Document, root?: Element | null): void {
    try {
      const host = findHost(doc, root);
      if (!host) {
        // 面板 fragment 可能还没插入完成，稍后重试（最多 ~2 秒）
        retryRender(doc, root, 0);
        return;
      }
      if (rendered.has(host)) return;
      rendered.add(host);
      renderPrefsPane(doc, host);
    } catch (e) {
      log("设置面板渲染失败：" + (e instanceof Error ? e.message : String(e)));
    }
  },

  getSettings(): Pick2ankiSettings {
    return getSettings();
  },

  canLookup(text: string): boolean {
    return canUseOnlineDict(text);
  },

  async testLookup(word: string): Promise<string[]> {
    const bundle = await lookupWordOnline(word, getSettings().onlineDictSources);
    const lines = bundle.sources.map((s) => `${s.name}：${s.ok ? "✅" : "❌ " + (s.error || "无结果")}`);
    if (!dictHasContent(bundle)) lines.push("（全部词典源都没有结果）");
    return lines;
  },
};

function retryRender(doc: Document, root: Element | null | undefined, attempt: number): void {
  if (attempt > 20) {
    log("设置面板容器 #zopick2anki-prefs-host 未找到，放弃渲染");
    return;
  }
  const win = doc.defaultView as unknown as { setTimeout?: (fn: () => void, ms: number) => number } | null;
  const again = () => api.renderPrefs(doc, root);
  if (win?.setTimeout) win.setTimeout(again, 100);
  else setTimeout(again, 100);
}
