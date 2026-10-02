import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
export default defineConfig({
  plugins: [
    {
      name: "rust-design-color-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (!importer) return;
        if (importer === path("../toolcraft-design/src/screen/style.test.ts") && name === "./style.js")
          return path("dist/screen-style.js");
        if (["terminal-markdown", "html-renderer", "plaintext-renderer"].some((name) => importer === path(`../toolcraft-design/src/terminal-markdown/${name}.test.ts`))) {
          const modules = {
            "./index.js": "markdown", "./parser.js": "markdown-parser", "./demo-content.js": "markdown-demo",
            "./parser/block.js": "markdown-block", "./parser/frontmatter.js": "markdown-frontmatter",
            "./parser/inline.js": "markdown-parse-inline", "./plaintext-renderer.js": "plaintext",
            "../components/symbols.js": "symbols", "../internal/strip-ansi.js": "logging",
            "../internal/theme-detect.js": "theme", "../tokens/typography.js": "typography"
          };
          if (modules[name]) return path(`dist/${modules[name]}.js`);
        }
        if (importer === path("../toolcraft-design/src/terminal-markdown/parser/code-highlight.test.ts") && name === "./code-highlight.js")
          return path("dist/code-highlight.js");
        if (importer === path("../toolcraft-design/src/static/static.test.ts")) {
          if (name === "./menu.js" || name === "./spinner.js") return path("dist/static.js");
        }
        if (importer === path("../toolcraft-design/src/explorer/render/text.test.ts") && name === "./text.js")
          return path("dist/explorer-text.js");
        for (const module of ["command-registry", "overlay-manager", "viewport", "inline-notice", "metric", "progress-group", "event-groups", "task-tree", "render-performance", "escape-terminal-text"]) {
          if (importer === path(`../toolcraft-design/src/${module}.test.ts`) && name === `./${module}.js`)
            return path(`dist/${module}.js`);
        }
        if (importer === path("../toolcraft-design/src/components/detail-card.test.ts") && name === "./detail-card.js")
          return path("dist/detail-card.js");
        if (importer === path("../toolcraft-design/src/components/inspector-card.test.ts") && name === "./inspector-card.js")
          return path("dist/inspector-card.js");
        if (importer === path("../toolcraft-design/src/components/catalog.test.ts") && name === "./catalog.js")
          return path("dist/catalog.js");
        if (importer === path("../toolcraft-design/src/components/resource-browser.test.ts") && name === "./resource-browser.js")
          return path("dist/resource-browser.js");
        if (importer === path("../toolcraft-design/src/components/help-formatter.test.ts") && name === "./help-formatter.js")
          return path("dist/help-formatter.js");
        if (importer === path("../toolcraft-design/src/components/help-formatter-plain.test.ts") && name === "./help-formatter-plain.js")
          return path("dist/help-formatter-plain.js");
        if (importer === path("../toolcraft-design/src/components/file-changes.test.ts") && name === "./file-changes.js")
          return path("dist/file-changes.js");
        if (
          importer.startsWith(path("../toolcraft-design/src/")) &&
          name.endsWith("/internal/output-format.js")
        ) return path("dist/logging.js");
        if (importer === path("../toolcraft-design/src/components/components.test.ts")) {
          if (name === "./symbols.js") return path("dist/symbols.js");
          if (name === "./command-errors.js") return path("dist/command-errors.js");
          if (name === "./table.js") return path("dist/table.js");
          if (name === "./logger.js") return path("dist/logging.js");
          if (name === "./text.js") return path("dist/text.js");
          if (name === "./color.js") return path("dist/color.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/streaming-line-buffer.test.ts")) {
          if (name === "./line-buffer.js") return path("dist/line-buffer.js");
          if (name === "./output-preview.js") return path("dist/index.js");
        }
        if (
          importer === path("../toolcraft-design/src/dashboard/terminal-width.test.ts") &&
          name === "./terminal-width.js"
        )
          return path("dist/terminal.js");
        if (importer === path("../toolcraft-design/src/acp/plan.test.ts")) {
          if (name === "./plan.js" || name === "./writer.js") return path("dist/acp.js");
          if (name === "../internal/output-format.js") return path("dist/logging.js");
          if (name === "../dashboard/ansi.js") return path("dist/terminal.js");
        }
        if (
          importer === path("../toolcraft-design/src/components/color.test.ts") &&
          name === "./color.js"
        )
          return path("dist/color.js");
        if (importer === path("../toolcraft-design/src/tokens/colors.test.ts")) {
          if (name === "../internal/color-support.js") return path("dist/color-support.js");
          if (name === "../internal/theme-state.js") return path("dist/theme-state.js");
          if (name === "./brand.js" || name === "./colors.js") return path("dist/theme.js");
        }
        if (
          importer === path("../toolcraft-design/src/internal/theme-state.test.ts") &&
          name === "./theme-state.js"
        )
          return path("dist/theme-state.js");
      }
    }
  ],
  test: {
    env: { FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
    include: [
      path("../toolcraft-design/src/screen/style.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/html-renderer.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/parser/code-highlight.test.ts"),
      path("../toolcraft-design/src/escape-terminal-text.test.ts"),
      path("../toolcraft-design/src/static/static.test.ts"),
      path("../toolcraft-design/src/render-performance.test.ts"),
      path("../toolcraft-design/src/task-tree.test.ts"),
      path("../toolcraft-design/src/event-groups.test.ts"),
      path("../toolcraft-design/src/inline-notice.test.ts"),
      path("../toolcraft-design/src/metric.test.ts"),
      path("../toolcraft-design/src/progress-group.test.ts"),

      path("../toolcraft-design/src/explorer/render/text.test.ts"),
      path("../toolcraft-design/src/command-registry.test.ts"),
      path("../toolcraft-design/src/overlay-manager.test.ts"),
      path("../toolcraft-design/src/viewport.test.ts"),
      path("../toolcraft-design/src/components/detail-card.test.ts"),
      path("../toolcraft-design/src/components/inspector-card.test.ts"),
      path("../toolcraft-design/src/components/catalog.test.ts"),
      path("../toolcraft-design/src/components/resource-browser.test.ts"),
      path("../toolcraft-design/src/components/help-formatter.test.ts"),
      path("../toolcraft-design/src/components/help-formatter-plain.test.ts"),
      path("../toolcraft-design/src/dashboard/streaming-line-buffer.test.ts"),
      path("../toolcraft-design/src/dashboard/terminal-width.test.ts"),
      path("../toolcraft-design/src/acp/plan.test.ts"),
      path("../toolcraft-design/src/components/color.test.ts"),
      path("../toolcraft-design/src/components/components.test.ts"),
      path("../toolcraft-design/src/components/file-changes.test.ts"),
      path("../toolcraft-design/src/tokens/colors.test.ts"),
      path("../toolcraft-design/src/internal/theme-state.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
