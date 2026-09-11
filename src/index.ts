// ============ 入口（bootstrap.js 用 loadSubScript 加载本文件） ============
// 与 zotero-plugin-template 一致：入口只做一件事——把插件实例挂到全局，
// 之后的注册/清理都由 bootstrap.js 调用 Zotero.<addonInstance>.hooks.* 完成。
import Addon from "./addon";
import { config } from "../package.json";

const Z = Zotero as unknown as Record<string, unknown>;

if (!Z[config.addonInstance]) {
  _globalThis.addon = new Addon();
  Z[config.addonInstance] = _globalThis.addon;
}
