// ============ 全局声明（bootstrap.js 的沙箱变量 + 非 TS 资源模块） ============

declare const _globalThis: {
  [key: string]: any;
  Zotero: typeof Zotero;
  addon: import("../src/addon").default;
};

/** bootstrap.js 里 ctx.rootURI（插件的 chrome:// 根路径） */
declare const rootURI: string;

declare const addon: import("../src/addon").default;

/** esbuild define 注入的构建环境 */
declare const __env__: "production" | "development";

/** esbuild 以 text loader 加载的 CSS 文本（见 zotero-plugin.config.ts） */
declare module "*.css" {
  const content: string;
  export default content;
}
