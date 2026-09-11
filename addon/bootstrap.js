/**
 * Zotero 插件引导脚本（bootstrap.js）
 * 与 windingwind/zotero-plugin-template（AGPL-3.0）的 bootstrap.js 结构一致，
 * 该结构本身来自 Zotero 官方 "Make It Red" 示例（https://github.com/zotero/make-it-red）。
 * 职责：注册 chrome:// 资源包 → 用 loadSubScript 加载打包后的插件入口 → 调用生命周期钩子。
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  /**
   * 插件沙箱的全局根对象：挂在上面的变量对所有子模块可见，
   * 同时把 rootURI 传给插件代码（见 src/index.ts 与 typings/global.d.ts）。
   */
  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
