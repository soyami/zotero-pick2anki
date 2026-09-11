// ============ 自测运行脚本 ============
// 1) 用 esbuild 把 test/integration.ts 打成一个 Node ESM 文件（可复用插件的 TS 源码）
// 2) 用 node 执行，输出各项自测结果
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "test/dist/integration.mjs");

await build({
  entryPoints: [resolve(root, "test/integration.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  // jsdom 作为外部依赖，由 Node 从 node_modules 解析
  external: ["jsdom"],
  // 插件源码里把 CSS 当文本导入（reader 弹窗样式注入），这里要用同样的 loader
  loader: { ".css": "text" },
  logLevel: "warning",
});

const child = spawn(process.execPath, [outfile], { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 1));
