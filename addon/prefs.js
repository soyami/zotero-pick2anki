/* eslint-disable no-undef */
// 插件默认偏好（Zotero 会在安装/启动时读取本文件）。
// 键名与 Obsidian 版 Pick2anki 的设置键完全一致；构建时由 zotero-plugin-scaffold
// 自动加上包前缀，最终落到 extensions.zotero.zoteropick2anki.<key>。
// 数组/对象类型用 JSON 字符串存放（Zotero 偏好只支持 bool / int / string）。
pref("triggerMode", "direct");          // direct | ctrl
pref("triggerDebounce", 500);           // 保留位：与 Obsidian 版 schema 对齐
pref("onlineDictSources", "[\"youdao\",\"bing\",\"cambridge\",\"collins\",\"oxford\"]");
pref("ankiEnabled", false);
pref("ankiConnectUrl", "http://127.0.0.1:8765");
pref("ankiDeck", "");
pref("ankiNoteType", "");
pref("ankiFieldMap", "{}");
pref("ankiAutoAdd", false);
pref("ankiDup", "skip");                // skip | add
pref("ankiDupScope", "deck");           // deck | model
pref("ankiTags", "pick2anki");
pref("popupWidth", 400);                // Zotero 专属：弹窗宽度(px)
pref("popupMaxHeight", 260);            // Zotero 专属：弹窗整体最大高度(px)
pref("sentenceExpand", true);           // Zotero 专属：原句扩写
pref("showCite", true);                 // Zotero 专属：附带文献条目信息
pref("edgeTtsFallback", false);         // Zotero 专属：Edge TTS 发音兜底（默认关闭，成功率低且慢）
