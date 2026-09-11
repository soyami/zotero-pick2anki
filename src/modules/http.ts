// ============ HTTP 适配层：用 Zotero.HTTP 替代 Obsidian 的 requestUrl ============
// Obsidian 版两处直接调用 requestUrl（dict-utils.fetchText 与 anki.ts 的 JSON-RPC / 音频下载）。
// Zotero 插件里没有 requestUrl，这里统一封装 Zotero.HTTP.request（特权 XHR，同样不受 CORS 限制）：
//   1) 默认带上与 Obsidian 版一致的浏览器 UA（有道/必应/剑桥会按 UA 返回不同页面）
//   2) request()：任何 HTTP 状态码都不抛异常，返回 { status, text, json, arrayBuffer }（对齐 requestUrl 的 throw:false）
//   3) 网络层错误（DNS / 连接被拒 / 超时）仍然抛出，与原 requestUrl 行为一致（anki.ts 依赖它给出友好提示）
//   4) fetchText()：语义与原 dict-utils.fetchText 完全一致（非 200 抛错、空响应抛错）
import type { HttpResponse, HttpRequestOptions } from "../types";
import { log } from "./env";

export type { HttpResponse, HttpRequestOptions };

/** 与 Pick2anki 原 dict-utils.HTTP_UA 保持一致 */
export const HTTP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  + " (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

interface XhrLike {
  status?: number;
  responseText?: string;
  response?: unknown;
}

/** Zotero.HTTP 不可用时（例如被单测/非 Zotero 环境调用）给出明确报错 */
function zoteroHttp(): {
  request: (method: string, url: string, options?: Record<string, unknown>) => Promise<unknown>;
} {
  const http = (globalThis as unknown as { Zotero?: { HTTP?: unknown } }).Zotero?.HTTP as
    { request?: unknown } | undefined;
  if (!http || typeof http.request !== "function") {
    throw new Error("Zotero.HTTP 不可用（本模块只能在 Zotero 插件环境内调用）");
  }
  return http as { request: (m: string, u: string, o?: Record<string, unknown>) => Promise<unknown> };
}

/** 从 Zotero.HTTP 抛出的错误对象里取回 XHR。
 *  Zotero 抛的是 Zotero.HTTP.UnexpectedStatusException：属性名是 `xmlhttp`（小写 h），
 *  同时它自己带 `status`；老文档里写的 `xmlHttpRequest` 并不存在，这里两种都兼容。 */
function xhrFromError(e: unknown): XhrLike | null {
  const anyE = e as {
    xmlhttp?: XhrLike;
    xmlHttpRequest?: XhrLike;
    response?: unknown;
    responseText?: string;
    status?: number;
  } | null;
  if (anyE?.xmlhttp && typeof anyE.xmlhttp === "object") return anyE.xmlhttp;
  if (anyE?.xmlHttpRequest && typeof anyE.xmlHttpRequest === "object") return anyE.xmlHttpRequest;
  if (anyE && typeof anyE.status === "number" && (anyE.response !== undefined || anyE.responseText !== undefined)) {
    return anyE as XhrLike;
  }
  return null;
}

function toResponse(xhr: XhrLike | null, responseType: "text" | "arraybuffer"): HttpResponse {
  const status = typeof xhr?.status === "number" ? xhr.status : 0;
  let text = "";
  if (typeof xhr?.responseText === "string") text = xhr.responseText;
  else if (typeof xhr?.response === "string") text = xhr.response;
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  const raw = xhr?.response;
  const arrayBuffer = responseType === "arraybuffer" && Object.prototype.toString.call(raw) === "[object ArrayBuffer]"
    ? raw as ArrayBuffer
    : null;
  return { status, text, json, arrayBuffer };
}

/**
 * 通用请求：不因 HTTP 状态码抛异常（对齐 requestUrl 的 throw:false）；
 * 网络层失败仍然抛错。任何情况下都可以安全地从返回值里读 status 判断结果。
 */
export async function request(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  const method = (opts.method || "GET").toUpperCase();
  const responseType = opts.responseType || "text";
  const headers: Record<string, string> = { "User-Agent": HTTP_UA, ...(opts.headers || {}) };
  const options: Record<string, unknown> = {
    headers,
    body: opts.body,
    responseType,
    timeout: opts.timeout ?? 30000,
    followRedirects: true,
    // 所有状态码都算“成功”，由调用方自己判断（等价于 Obsidian 的 throw:false）
    successCodes: false,
    debug: false,
  };
  let xhr: XhrLike | null = null;
  try {
    xhr = await zoteroHttp().request(method, url, options) as XhrLike;
  } catch (e) {
    xhr = xhrFromError(e);
    if (!xhr) {
      // 真正的网络层错误：DNS 解析失败 / 连接被拒 / 超时
      throw new Error(`${method} ${url} 请求失败：${e instanceof Error ? e.message : String(e)}`);
    }
    log(`${method} ${url} → HTTP ${xhr.status}`);
  }
  return toResponse(xhr, responseType);
}

/** 抓取文本（语义与 Pick2anki 原 dict-utils.fetchText 一致：非 200 抛错、空响应抛错） */
export async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const resp = await request(url, { method: "GET", timeout: timeoutMs });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
  const txt = resp.text;
  if (!txt) throw new Error("空响应");
  return txt;
}

/** 抓取二进制（失败返回 null，不抛异常；对齐原 anki.ts 里 fetchBinary 的用法） */
export async function fetchBinary(url: string, timeoutMs = 30000): Promise<ArrayBuffer | null> {
  try {
    const resp = await request(url, { method: "GET", responseType: "arraybuffer", timeout: timeoutMs });
    if (resp.status !== 200) return null;
    return resp.arrayBuffer;
  } catch {
    return null;
  }
}

/** JSON-RPC / JSON 接口 POST：返回解析后的 JSON（非 2xx 时由调用方按 status 判断） */
export async function postJson(url: string, payload: unknown, timeoutMs = 30000): Promise<HttpResponse> {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    timeout: timeoutMs,
  });
}
