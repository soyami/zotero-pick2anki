// ============ Edge TTS（微软大声朗读通道） ============
// 协议逐字节对齐 edge-tts 7.2.7（已实测日/韩/俄合成成功）：
// - Sec-MS-GEC 鉴权（Windows ticks 300s 对齐 + SHA256）
// - 请求头：Edge UA + chrome-extension Origin + MUID cookie（缺一则 403）
// - X-Timestamp 用 JS 风格日期，SSML 消息的时间戳尾部追加 Z（微软服务端怪癖）
//
// 【移植说明】鉴权/SSML 逻辑与 Pick2anki 原版完全一致，仅替换了运行环境相关的部分：
//   1) Node 的 ws → 浏览器 WebSocket（on("open") → onopen；二进制帧用 binaryType="arraybuffer" 读取）
//   2) Node 的 crypto（sha256 / randomBytes）→ 纯 TS sha256.ts + env.randomHex
//   3) 返回值由 Blob 改为 Uint8Array（Zotero 插件沙箱不保证存在 Blob 构造函数）
//   4) window.setTimeout → env.setTimer（沙箱里没有全局 window）
import { clearTimer, getWebSocketCtor, randomHex, randomHexUpper, setTimer } from "./env";
import { sha256Hex } from "./sha256";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const WIN_EPOCH = 11644473600; // Unix → Windows file time 纪元差（秒）
const WSS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** 各语言 Edge 神经音色（女/男，全部实测可用） */
export const EDGE_VOICES: Record<string, { female: string; male: string }> = {
  zh: { female: "zh-CN-XiaoxiaoNeural", male: "zh-CN-YunxiNeural" },
  en: { female: "en-US-AriaNeural", male: "en-US-GuyNeural" },
  ja: { female: "ja-JP-NanamiNeural", male: "ja-JP-KeitaNeural" },
  ko: { female: "ko-KR-SunHiNeural", male: "ko-KR-InJoonNeural" },
  ru: { female: "ru-RU-SvetlanaNeural", male: "ru-RU-DmitryNeural" },
  fr: { female: "fr-FR-DeniseNeural", male: "fr-FR-HenriNeural" },
  de: { female: "de-DE-KatjaNeural", male: "de-DE-ConradNeural" },
  es: { female: "es-ES-ElviraNeural", male: "es-ES-AlvaroNeural" },
  pt: { female: "pt-PT-RaquelNeural", male: "pt-PT-DuarteNeural" },
};

/** Sec-MS-GEC：SHA256((unix+WIN_EPOCH 对齐300s)×10^7 + token) 大写 hex */
function secMsGec(): string {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return sha256Hex(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`).toUpperCase();
}

/** JS Date#toString 风格 UTC 时间串 */
function jsDateUtc(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()}`
    + ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pct(v: number): string {
  const p = Math.round((v - 1) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}

function buildUrl(): string {
  // 原版用 crypto.randomBytes(16).toString("hex")
  return `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
    + `&ConnectionId=${randomHex(16)}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
}

/**
 * 浏览器的 WebSocket 不能自定义请求头，而 Edge TTS 要求带 muid cookie
 * （Node 版通过 ws 的 { headers } 设置）。这里改用 Cookie 服务把 muid 写进
 * speech.platform.bing.com 的 cookie 罐，握手时由浏览器自动带上。
 * 注意：Origin / User-Agent 无法伪装，服务端若因此拒绝，Edge TTS 兜底会失败——
 * 此时 anki.ts 还有一层 HTTP 兜底发音，见 storeAudio()。
 */
function ensureMuidCookie(): void {
  try {
    const Services = (globalThis as any).Services;
    const Ci = (globalThis as any).Ci || Components?.interfaces;
    if (!Services?.cookies?.add) return;
    const host = "speech.platform.bing.com";
    const value = randomHexUpper(16);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    try {
      // Firefox 115+ 签名：add(host, path, name, value, isSecure, isHttpOnly, isSession, expiry, originAttributes, sameSite, scheme)
      Services.cookies.add(host, "/", "muid", value, true, false, false, expiry, {}, Ci.nsICookie.SAMESITE_NONE, Ci.nsICookie.SCHEME_HTTPS);
    } catch {
      Services.cookies.add(host, "/", "muid", value, true, false, false, expiry, {});
    }
  } catch {
    // cookie 注入失败不致命：继续尝试连接，由服务端 403 决定
  }
}

/** 请求头里能设置的都保留（UA/Origin/Cookie 由浏览器接管，见 ensureMuidCookie 注释） */
function buildHeaders(): Record<string, string> {
  return {
    "Accept-Language": "en-US,en;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  };
}

function configMsg(): string {
  return `X-Timestamp:${jsDateUtc()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
    + `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},`
    + `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`;
}

function ssmlMsg(text: string, voice: string, rate: number, pitch: number): string {
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
    + `<voice name='${voice}'><prosody pitch='${pct(pitch)}' rate='${pct(rate)}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
  // 注意：SSML 消息的时间戳尾部必须追加 Z（微软服务端怪癖，config 消息不要加）
  return `X-RequestId:${randomHexUpper(16)}\r\nContent-Type:application/ssml+xml\r\n`
    + `X-Timestamp:${jsDateUtc()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
}

/** ASCII 解码（协议头都是 ASCII，避免依赖 TextDecoder） */
function asciiDecode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** 二进制帧 → Uint8Array（ArrayBuffer / TypedArray / Blob 三种可能都处理） */
async function toBytes(data: unknown): Promise<Uint8Array | null> {
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") return new Uint8Array(data as ArrayBuffer);
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  const anyData = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyData?.arrayBuffer === "function") return new Uint8Array(await anyData.arrayBuffer());
  return null;
}

/**
 * 调用 Edge TTS 合成整段文本，返回 mp3 字节；失败抛错（网络/超时/服务端错误）
 * （原版返回 Blob，这里返回 Uint8Array，见文件头移植说明）
 */
export function edgeSynth(text: string, voice: string, rate: number, pitch: number, timeoutMs = 20000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const WS = getWebSocketCtor();
    if (!WS) { reject(new Error("当前环境不支持 WebSocket，无法使用 Edge TTS 发音")); return; }

    const chunks: Uint8Array[] = [];
    let settled = false;
    let queue: Promise<void> = Promise.resolve(); // 保证二进制帧按顺序入队
    const ws = new WS(buildUrl());
    const timer = setTimer(() => {
      if (!settled) { settled = true; try { ws.close(); } catch { /* Expected */ } reject(new Error("多语言语音超时")); }
    }, timeoutMs);

    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { ws.close(); } catch { /* Expected */ }
      if (ok && chunks.length > 0) {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        resolve(out);
      } else {
        reject(new Error(err || "多语言语音无音频返回"));
      }
    };

    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      try {
        ws.send(configMsg());
        ws.send(ssmlMsg(text, voice, rate, pitch));
      } catch (e) {
        finish(false, `多语言语音发送失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    ws.onmessage = (ev: { data?: unknown }) => {
      const data = ev?.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) finish(true);
        return;
      }
      // 二进制帧：先解析头，再取音频负载（异步读取时用队列保序）
      queue = queue.then(async () => {
        const bytes = await toBytes(data);
        if (!bytes || bytes.length < 2) return;
        const headerLen = (bytes[0] << 8) | bytes[1];
        const header = asciiDecode(bytes.subarray(2, 2 + headerLen));
        if (/Path:audio\r\n/.test(header) && !/Path:audio\.metadata/.test(header)) {
          const payload = bytes.subarray(2 + headerLen);
          if (payload.length > 0) chunks.push(payload.slice());
        }
      }).catch(() => { /* 单帧解析失败忽略 */ });
    };
    ws.onerror = (e: unknown) => {
      const msg = (e as { message?: string })?.message || "未知错误";
      finish(false, `多语言语音连接失败: ${msg}`);
    };
    ws.onclose = (ev: { code?: number }) => { if (chunks.length === 0) finish(false, `多语言语音连接关闭 (${ev?.code ?? 0})`); };
  });
}
