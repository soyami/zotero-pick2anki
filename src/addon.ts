// ============ 插件实例（挂到 Zotero.<addonInstance>，供面板/调试台访问） ============
import { config } from "../package.json";
import hooks from "./hooks";
import { api } from "./modules/api";
import type { Pick2ankiApi } from "./modules/api";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
  };
  /** 生命周期钩子（bootstrap.js 通过 Zotero.<addonInstance>.hooks.* 调用） */
  public hooks: typeof hooks;
  /** 对外 API：设置面板 onload 里调用 Zotero.<addonInstance>.api.* */
  public api: Pick2ankiApi;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
