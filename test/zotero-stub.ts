// ============ 测试用 Zotero 环境桩（Node 下跑真实查词/写卡链路） ============
// 目的：在不启动 Zotero 的情况下，用真实的网络请求 + 真实的 AnkiConnect 验证
//       「词典适配器 → 聚合 → 字段构建 → 写卡」整条链路（UI 部分只能人工验证）。
// 只实现插件代码实际用到的那部分 Zotero API：HTTP.request / Prefs / getMainWindow。
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");

/** 暴露给测试：用 page 模拟 reader 的 iframe 文档（验证弹窗渲染器用） */
export const jsdom = dom;

const prefsStore = new Map<string, unknown>();

export interface StubRequest {
  method: string;
  url: string;
  status: number;
}

export const stubLog: { requests: StubRequest[] } = { requests: [] };

type XhrLike = { status: number; responseText: string; response: unknown };

/** 等价于 Zotero.HTTP.request：
 *  - responseType text / arraybuffer
 *  - successCodes === false → 任何状态码都 resolve（本插件用的就是这种）
 *  - 其它情况非 2xx 抛错，并把 xhr 挂在 error.xmlHttpRequest 上（Zotero 的行为） */
async function request(method: string, url: string, options: Record<string, any> = {}): Promise<XhrLike> {
  const responseType = options.responseType || "text";
  const res = await fetch(url, {
    method,
    headers: options.headers,
    body: options.body,
    redirect: "follow",
  });
  const xhr: XhrLike = { status: res.status, responseText: "", response: null };
  if (responseType === "arraybuffer") {
    xhr.response = await res.arrayBuffer();
  } else {
    xhr.responseText = await res.text();
    xhr.response = xhr.responseText;
  }
  stubLog.requests.push({ method, url, status: res.status });
  const ok = res.status >= 200 && res.status < 300;
  if (options.successCodes === false || ok) return xhr;
  const err = new Error(`HTTP ${res.status} for ${url}`) as Error & { xmlHttpRequest?: XhrLike };
  err.xmlHttpRequest = xhr;
  throw err;
}

const ZoteroStub = {
  HTTP: {
    request,
    defaultHeaders: {},
  },
  Prefs: {
    get: (key: string) => prefsStore.get(key),
    set: (key: string, value: unknown) => { prefsStore.set(key, value); },
    clear: (key: string) => { prefsStore.delete(key); },
  },
  debug: (...args: unknown[]) => { console.log("[Zotero.debug]", ...args); },
  getMainWindow: () => ({
    DOMParser: dom.window.DOMParser,
    WebSocket: (globalThis as any).WebSocket,
    crypto: (globalThis as any).crypto,
    setTimeout,
    clearTimeout,
  }),
  Utilities: {
    randomString: (len: number, chars = "0123456789abcdef") => {
      let out = "";
      for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    },
  },
  Items: { get: () => null },
  URI: {},
  isMac: false,
};

(globalThis as any).Zotero = ZoteroStub;
// bootstrap 沙箱里注入的全局
(globalThis as any).rootURI = "file:///test/";
(globalThis as any).addon = { data: { config: { addonID: "zoteropick2anki@soyami.github.io", addonRef: "zoteropick2anki" } } };

export function prefsSnapshot(): Record<string, unknown> {
  return Object.fromEntries(prefsStore.entries());
}
