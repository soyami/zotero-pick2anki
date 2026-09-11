// ============ 运行环境适配（Zotero 插件沙箱 → 主窗口对象） ============
// Zotero 插件的入口脚本运行在特权沙箱中：Zotero / Services 一定可用，但 window、document、
// DOMParser、WebSocket、btoa、crypto、setTimeout 这些“Web 全局对象”不保证存在，
// 需要按需从 Zotero 主窗口借用。本文件把这些差异集中在少数几个函数里，
// 其余模块（词典适配器 / anki.ts / edge-tts.ts）只调用这里的能力，不直接依赖环境。

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Zotero 主窗口（借用 Web 全局对象用；沙箱里没有时返回 null） */
export function getMainWindow(): any {
  const z = (globalThis as any).Zotero;
  try {
    if (z?.getMainWindow) {
      const w = z.getMainWindow();
      if (w) return w;
    }
    if (z?.getMainWindows) {
      const ws = z.getMainWindows();
      if (ws?.length) return ws[0];
    }
    if (typeof Services !== "undefined") {
      const w = (Services as any).wm.getMostRecentWindow("navigator:browser");
      if (w) return w;
    }
  } catch (e) {
    Zotero.debug("[zopick2anki] 获取主窗口失败：" + (e instanceof Error ? e.message : String(e)));
  }
  return null;
}

/** DOMParser：插件沙箱里通常没有全局 DOMParser，从主窗口借用（只用于解析词典页面，不插入文档） */
export function getDOMParser(): { new(): DOMParser } | null {
  if (typeof DOMParser !== "undefined") return DOMParser as unknown as { new(): DOMParser };
  const win = getMainWindow();
  if (win?.DOMParser) return win.DOMParser as { new(): DOMParser };
  return null;
}

/** WebSocket 构造器：Edge TTS 兜底发音用（沙箱里没有 WebSocket，从主窗口借用） */
export function getWebSocketCtor(): any {
  if (typeof WebSocket !== "undefined") return WebSocket;
  const win = getMainWindow();
  if (win?.WebSocket) return win.WebSocket;
  return null;
}

/** setTimeout / clearTimeout：优先用主窗口的版本，保证与 UI 同一事件循环 */
export function setTimer(fn: () => void, ms: number): number {
  const win = getMainWindow();
  if (win?.setTimeout) return win.setTimeout(fn, ms) as number;
  if (typeof setTimeout !== "undefined") return setTimeout(fn, ms) as unknown as number;
  throw new Error("当前环境不支持 setTimeout");
}

export function clearTimer(id: number | null | undefined): void {
  if (id === null || id === undefined) return;
  const win = getMainWindow();
  if (win?.clearTimeout) { win.clearTimeout(id); return; }
  if (typeof clearTimeout !== "undefined") clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

/** crypto.getRandomValues：没有则退回 Math.random（仅用于连接 ID / cookie，非安全用途） */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const win = getMainWindow();
  const c = (globalThis as any).crypto ?? win?.crypto;
  if (c?.getRandomValues) {
    try { c.getRandomValues(out); return out; } catch { /* 继续走 Math.random 兜底 */ }
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** 小写十六进制随机串（uuid4().hex 风格） */
export function randomHex(bytes: number): string {
  return Array.from(randomBytes(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 十六进制随机串（大写，Edge TTS 的 muid / X-RequestId 用） */
export function randomHexUpper(bytes: number): string {
  return randomHex(bytes).toUpperCase();
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Uint8Array → base64（沙箱里不保证有 btoa，这里自己实现） */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : "=";
  }
  return out;
}

/** 是否是 ArrayBuffer（跨 realm 时 instanceof 不可靠，用 toString 判定） */
export function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return Object.prototype.toString.call(v) === "[object ArrayBuffer]";
}

/** 统一日志（Zotero 调试输出；Zotero 未就绪时退回 console） */
export function log(msg: string): void {
  const z = (globalThis as any).Zotero;
  if (z?.debug) z.debug("[zopick2anki] " + msg);
  else (globalThis as any).console?.log("[zopick2anki] " + msg);
}
