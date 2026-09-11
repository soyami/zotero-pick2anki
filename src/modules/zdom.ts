// ============ DOM 构造小工具 ============
// Obsidian 版直接使用其 DOM 扩展（createDiv / createEl / addClass）；Zotero 插件里没有这些扩展，
// 而且要往 reader 的 iframe 文档里渲染，必须显式传入目标 document，所以这里提供一组等价的小工具。
// 命名与用法尽量贴近原代码（createDiv(cls, text) 风格），便于对照阅读。

export interface ElOptions {
  cls?: string;
  text?: string;
  html?: string;
  attr?: Record<string, string>;
  style?: Record<string, string>;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * 创建 HTML 元素。
 * 注意：Zotero 偏好面板是 XUL/XHTML 文档（pane XHTML 以 fragment 形式插入，默认命名空间是 XUL），
 * 在这里 createElement("div") 会得到“无名空间/XUL 元素”→ 渲染成 inline 且样式异常，
 * 因此非 text/html 文档统一用 XHTML 命名空间创建（等价于模板里写 <html:div> 的写法）。
 * reader 的 iframe 文档是 text/html，走普通 createElement。
 */
export function createElement(doc: Document, tag: string): HTMLElement {
  if (doc.contentType === "text/html") return doc.createElement(tag) as HTMLElement;
  return doc.createElementNS(XHTML_NS, tag) as HTMLElement;
}

/** 创建元素（tag 为小写标签名） */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  opts?: ElOptions,
): HTMLElementTagNameMap[K] {
  const node = createElement(doc, tag);
  applyOptions(node, opts);
  return node as HTMLElementTagNameMap[K];
}

function applyOptions(node: HTMLElement, opts?: ElOptions): void {
  if (!opts) return;
  if (opts.cls) node.className = opts.cls;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) node.setAttribute(k, v);
  if (opts.style) for (const [k, v] of Object.entries(opts.style)) node.style.setProperty(k, v);
}

/** 等价于 Obsidian 的 container.createDiv(cls, text) */
export function div(doc: Document, cls?: string, text?: string): HTMLDivElement {
  return el(doc, "div", { cls, text });
}

/** 等价于 Obsidian 的 container.createSpan({ cls, text }) */
export function span(doc: Document, cls?: string, text?: string): HTMLSpanElement {
  return el(doc, "span", { cls, text });
}

export function addClass(node: Element | null | undefined, cls: string): void {
  node?.classList.add(cls);
}

export function removeClass(node: Element | null | undefined, cls: string): void {
  node?.classList.remove(cls);
}

/** 清空子节点 */
export function empty(node: Element | null | undefined): void {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 绑定事件，返回解绑函数（便于插件卸载时统一清理） */
export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K | string,
  handler: (ev: Event) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type as string, handler, options);
  return () => target.removeEventListener(type as string, handler, options);
}
