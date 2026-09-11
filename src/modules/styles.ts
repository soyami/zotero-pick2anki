// ============ 弹窗样式文本 ============
// reader 是独立的 iframe 文档，与其在 chrome 包之间来回拼路径，不如把同一份 CSS
// 作为文本注入 <style>（esbuild 的 .css → text loader，见 zotero-plugin.config.ts）。
// 同一份文件也被 PreferencePanes 以 stylesheets 方式引用（见 src/hooks.ts 的 registerPrefsPane）。
import cssText from "../../addon/content/zopick2anki.css";

export const READER_CSS_ID = "zopick2anki-reader-style";

export function readerCssText(): string {
  return String(cssText);
}
