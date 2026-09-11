// ============ 跨模块共享的基础类型（HTTP 层） ============
// 单独放一个文件，避免 http.ts 与各适配器之间出现循环依赖。

/** 请求选项（对齐 Pick2anki 原 requestUrl 用到的字段） */
export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 文本（默认）或二进制 */
  responseType?: "text" | "arraybuffer";
  timeout?: number;
}

/** 统一的响应结构：任何状态码都会返回该结构（网络层错误才抛异常） */
export interface HttpResponse {
  status: number;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer | null;
}
