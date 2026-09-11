// ============ 最小 Zotero 全局类型声明 ============
// 为什么不直接用 zotero-types：
//   1) 它会拉两个 git 依赖（zotero/epub.js、zotero-plugin-dev/zotero-pdfjs-types），
//      `npm install` 需要能执行 git clone，内网/受限环境常失败；
//   2) 它自带的 Gecko DOM 类型会覆盖 lib.dom.d.ts（querySelectorAll 的元素类型退化为 unknown），
//      使从 Pick2anki 原样移植的页面解析代码无法通过类型检查，而那部分代码要求“一字不改”。
// 这里只声明本插件实际用到的 API，签名对照 Zotero 官方文档 / Zotero 源码与 zotero-types 的声明。

/** Zotero.HTTP.request 的选项（本插件只用到这几个） */
interface ZoteroHTTPOptions {
  body?: string;
  headers?: Record<string, string>;
  responseType?: "text" | "json" | "arraybuffer" | "document";
  timeout?: number;
  followRedirects?: boolean;
  /** false = 任何状态码都算成功（等价于 Obsidian requestUrl 的 throw:false） */
  successCodes?: number[] | false;
  compression?: boolean;
  debug?: boolean;
}

interface ZoteroXHR {
  status: number;
  responseText: string;
  response: unknown;
  getResponseHeader(name: string): string | null;
}

interface ZoteroPrefs {
  get(pref: string, global?: boolean): boolean | string | number | undefined;
  set(pref: string, value: boolean | string | number, global?: boolean): void;
  clear(pref: string, global?: boolean): void;
  registerObserver(pref: string, handler: (value: unknown) => void, global?: boolean): symbol;
  unregisterObserver(observerID: symbol): void;
}

/** Zotero.Reader 划词弹窗事件（renderTextSelectionPopup 等） */
interface ZoteroReaderEvent {
  reader: unknown;
  doc: Document;
  params: { annotation: { text: string; [key: string]: unknown } };
  append: (...nodes: Array<Node | string>) => void;
  type: string;
}

interface ZoteroReader {
  registerEventListener(
    type: string,
    handler: (event: ZoteroReaderEvent) => void | Promise<void>,
    pluginID?: string,
  ): void;
  unregisterEventListener(type: string, handler: (event: ZoteroReaderEvent) => void | Promise<void>): void;
}

interface ZoteroPreferencePaneOption {
  pluginID: string;
  /** 面板 XHTML fragment 的 URI（可为插件根目录相对路径） */
  src: string;
  label?: string;
  image?: string;
  id?: string;
  parent?: string;
  helpURL?: string;
  scripts?: string[];
  stylesheets?: string[];
  defaultXUL?: boolean;
}

interface ZoteroPreferencePanes {
  register(options: ZoteroPreferencePaneOption): Promise<string>;
  unregister(id: string): void;
}

interface ZoteroProgressWindow {
  changeHeadline(text?: string, icon?: string): void;
  addDescription(text: string): void;
  createLine(line: { text: string; type?: string; progress?: number; icon?: string }): ZoteroProgressWindow;
  changeLine(line: { text?: string; type?: string; progress?: number }): void;
  show(): void;
  startCloseTimer(ms?: number): void;
  close(): void;
}

interface ZoteroAPI {
  initializationPromise: Promise<void>;
  unlockPromise: Promise<void>;
  uiReadyPromise: Promise<void>;
  isMac: boolean;
  debug(message: string, level?: number): void;
  getMainWindow(): Window;
  getMainWindows(): Window[];
  HTTP: {
    request(method: string, url: string, options?: ZoteroHTTPOptions): Promise<ZoteroXHR>;
    defaultHeaders: Record<string, string>;
  };
  Prefs: ZoteroPrefs;
  Reader: ZoteroReader;
  PreferencePanes: ZoteroPreferencePanes;
  Items: { get(id: number): any };
  URI: { getItemURI(item: any): string; getURIItem(uri: string): any };
  Utilities: { randomString(length: number, chars?: string): string };
  ProgressWindow: new (options?: { closeOnClick?: boolean; closeTime?: number }) => ZoteroProgressWindow;
}

declare const Zotero: ZoteroAPI;

/** 插件沙箱里可用的 XPCOM 相关全局 */
declare const Services: any;
declare const Components: any;
declare const Cu: any;
declare const Cc: any;
declare const Ci: any;
declare const ChromeUtils: any;
