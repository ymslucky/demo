/**
 * 构建期主题防闪烁（anti-FOUC）脚本注入器。
 *
 * 背景：站点为纯静态导出（next build -> out/），没有可用的运行时
 * middleware/proxy 来在 HTTP 层改写 HTML。为保证「主题在首次绘制前
 * 生效」且脚本节点不进入 React 组件树（React 19 会对客户端渲染的
 * <script> VDOM 节点告警，见 AGENTS.md §3），改为在 build 之后、
 * 部署之前，直接把自包含的 ES5 主题初始化脚本拼接进 out/ 下每个
 * HTML 文件的 <head> 中。
 *
 * 本文件是 themeInitScript 的唯一权威来源（app/lib/theme.ts 不再
 * 重复实现）；注入必须幂等 —— 重复执行不会产生重复 <script>。
 *
 * 用法：
 *   node scripts/inject-theme.mjs            # 处理 ./out 下全部 HTML
 *   node scripts/inject-theme.mjs <dir>      # 处理指定目录
 */

const THEME_STORAGE_KEY = "theme";

/**
 * 与 app/lib/theme.ts 的 resolveTheme 决策逻辑一致：手动覆盖优先，
 * 否则跟随系统。自包含 ES5，无 import，可在任何浏览器直接执行。
 */
export function themeInitScript() {
  return [
    "(function () {",
    "  try {",
    "    var stored = null;",
    `    try { stored = localStorage.getItem("${THEME_STORAGE_KEY}"); } catch (e) {}`,
    "    var dark = false;",
    '    try { dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}',
    '    var theme = (stored === "light" || stored === "dark") ? stored : (dark ? "dark" : "light");',
    '    document.documentElement.setAttribute("data-theme", theme);',
    "  } catch (e) {}",
    "})();",
  ].join("\n");
}

/**
 * 将主题初始化 <script> 注入 HTML 字符串。注入点优先级：
 * 1. <head> 开标签之后（最早执行，零 FOUC）；
 * 2. <body ...> 开标签之后；
 * 3. 整个文档最前（兜底）。
 * 已包含该脚本时原样返回（幂等）。
 */
export function injectTheme(html) {
  const script = `<script>${themeInitScript()}</script>`;
  if (html.includes(script)) return html;

  const headIdx = html.indexOf("<head>");
  if (headIdx >= 0) {
    const at = headIdx + "<head>".length;
    return html.slice(0, at) + script + html.slice(at);
  }

  const bodyMatch = /<body[^>]*>/.exec(html);
  if (bodyMatch) {
    const at = bodyMatch.index + bodyMatch[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }

  return script + html;
}

/** 递归收集目录下全部 .html 文件的绝对路径。 */
async function collectHtmlFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(full)));
    } else if (entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

/** CLI 入口：遍历 out/ 下全部 HTML，注入并写回，打印统计。 */
async function main() {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const outDir = resolve(process.argv[2] ?? "out");

  const files = await collectHtmlFiles(outDir);
  let injected = 0;
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const next = injectTheme(html);
    if (next !== html) {
      await writeFile(file, next, "utf8");
      injected += 1;
    }
  }
  console.log(`inject-theme: ${injected}/${files.length} HTML files updated in ${outDir}`);
}

// 仅作为 CLI 直接执行时运行（import 供测试使用时不触发）。
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("inject-theme failed:", error);
    process.exitCode = 1;
  });
}
