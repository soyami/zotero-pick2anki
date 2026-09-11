import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// 构建配置沿用 windingwind/zotero-plugin-template 的 zotero-plugin.config.ts 结构
// （zotero-plugin-scaffold 官方模板）：拷贝 addon/ → 替换 __占位符__ → 合并 manifest →
// 生成 typings → esbuild 打包 src/index.ts → 打成 .xpi（产物在 .scaffold/build/）。
export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // 固定 .xpi 文件名（默认是 name 的 kebab-case，这里显式指定便于分发）
  xpiName: "zotero-pick2anki",
  // 更新清单地址：Zotero 会定期查它（用于推送新版本、以及不重发 .xpi 就放宽版本兼容区间）。
  // manifest 里必须有 update_url（空串会被 Zotero 判为无效插件）；仓库地址为：
  // https://github.com/soyami/zotero-pick2anki
  updateURL: "https://github.com/soyami/zotero-pick2anki/releases/download/release/update.json",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    fluent: {
      // 界面文案目前直接写在 TS 里（UI 语言固定中文），不使用 Fluent；
      // 但 scaffold 仍会生成 i10n 类型文件，这里把它挪出 tsconfig 的 include 范围，
      // 避免“没有 FTL 时生成空类型”导致 tsc 报错。
      dts: ".scaffold/typings/i10n.d.ts",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV || "production"}"`,
        },
        bundle: true,
        target: "firefox115",
        // 把 addon/content/zopick2anki.css 作为文本打包进插件（reader iframe 里注入 <style>）
        loader: {
          ".css": "text",
        },
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },
});
