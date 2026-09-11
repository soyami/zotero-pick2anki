// ============ 生命周期钩子（bootstrap.js 调用的入口） ============
// onStartup  ：注册设置面板 + reader 划词监听
// onShutdown ：注销监听、清掉 Zotero.<addonInstance>
// onMainWindowLoad/Unload：本项目不需要往主窗口插 UI，留空即可（保留钩子便于后续扩展）
import { config } from "../package.json";
import { log } from "./modules/env";
import { loadSettings } from "./modules/settings-store";
import { registerReaderHandlers } from "./modules/reader";

let unregisterReader: (() => void) | null = null;

async function onStartup(): Promise<void> {
  // 与模板一致：等 Zotero 初始化/解锁/UI 就绪后再注册，避免早期 API 不可用
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // 读取一次设置：把默认值落到偏好里（about:config 中 extensions.zotero.zoteropick2anki.* 可见可改）
  const settings = loadSettings();
  log(`设置已加载：词典源 [${settings.onlineDictSources.join(", ")}]，Anki 写卡 ${settings.ankiEnabled ? "已启用" : "未启用"}`);

  registerPrefsPane();
  unregisterReader = registerReaderHandlers();

  addon.data.initialized = true;
  log(`${config.addonName} 已加载（插件 ID ${config.addonID}）`);
}

/** 注册偏好面板（中文界面；stylesheets 复用弹窗同一份 CSS） */
function registerPrefsPane(): void {
  try {
    Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: "Pick2anki",
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      stylesheets: [rootURI + "content/zopick2anki.css"],
    });
    log("设置面板已注册：Zotero 设置 → Pick2anki");
  } catch (e) {
    log("设置面板注册失败：" + (e instanceof Error ? e.message : String(e)));
  }
}

function onShutdown(): void {
  try {
    unregisterReader?.();
  } catch (e) {
    log("注销 reader 监听失败：" + (e instanceof Error ? e.message : String(e)));
  }
  unregisterReader = null;
  addon.data.alive = false;
  try {
    // 摘掉挂在 Zotero 上的插件实例（与模板 onShutdown 一致）
    delete (Zotero as unknown as Record<string, unknown>)[config.addonInstance];
  } catch { /* 忽略 */ }
  log("已卸载");
}

async function onMainWindowLoad(_win: unknown): Promise<void> {
  // 本项目不往主窗口注入 UI（弹窗挂在 reader 内，设置面板由 PreferencePanes 托管）
}

async function onMainWindowUnload(_win: unknown): Promise<void> {
  // 同上，无需要清理的主窗口资源
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
