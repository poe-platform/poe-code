import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const entrypoints=JSON.parse(readFileSync(new URL("./package.json",import.meta.url),"utf8")).exports;
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
export default defineConfig({
  plugins: [
    {
      name: "rust-design-color-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (!importer) return;
        if ([path("../toolcraft-design/src/index.test.ts"),path("../toolcraft-design/src/subpath-exports.test.ts")].includes(importer)) {
          const key=name==="./index.js"?".":name.endsWith(".js")?name.slice(0,-3):name;
          if(entrypoints[key]?.import)return path(entrypoints[key].import);
        }
        if(importer===path("../toolcraft-design/src/components/template.test.ts")&&name==="./template.js")return path("dist/template.js");
        if (importer === path("../toolcraft-design/src/dashboard/compact-layout.test.ts")) {
          if (name === "./snapshot.js") return path("dist/dashboard-snapshot.js");
          if (name === "./layout.js") return path("dist/dashboard-layout.js");
          if (name === "./buffer.js") return path("dist/dashboard-buffer.js");
          if (name === "./components/stats-pane.js") return path("dist/dashboard-stats.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/components/run-view.test.ts")) {
          if (name === "./run-view.js") return path("dist/dashboard-run-view.js");
          if (name === "../buffer.js") return path("dist/dashboard-buffer.js");
          if (name === "../composer.js") return path("dist/composer.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/components/stats-context.test.ts")) {
          if (name === "./stats-pane.js") return path("dist/dashboard-stats.js");
          if (name === "../buffer.js") return path("dist/dashboard-buffer.js");
          if (name === "../terminal-width.js") return path("dist/terminal.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/components/context-pane.test.ts")) {
          if (name === "./context-pane.js") return path("dist/dashboard-context.js");
          if (name === "../buffer.js") return path("dist/dashboard-buffer.js");
        }
        if (["output-wrapping","output-viewport","conversation-output"].some(test => importer === path(`../toolcraft-design/src/dashboard/components/${test}.test.ts`))) {
          if (name === "./output-pane.js") return path("dist/dashboard-output.js");
          if (name === "../buffer.js") return path("dist/dashboard-buffer.js");
          if (name === "../terminal-width.js") return path("dist/terminal.js");
          if (name === "../../terminal-markdown/index.js") return path("dist/markdown.js");
          if (name === "../../internal/theme-detect.js") return path("dist/theme.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/components/footer.test.ts")) {
          if (name === "./footer.js") return path("dist/dashboard-footer.js");
          if (name === "../buffer.js") return path("dist/dashboard-buffer.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/terminal.test.ts")) {
          if (name === "./terminal.js") return path("dist/dashboard-terminal.js");
          if (name === "./buffer.js") return path("dist/dashboard-buffer.js");
        }
        if (importer === path("../toolcraft-design/src/dashboard/ansi.test.ts") && name === "./ansi.js") return path("dist/dashboard-ansi.js");
        if (["store-retention", "store-streaming"].some(name => importer === path(`../toolcraft-design/src/dashboard/${name}.test.ts`)) && name === "./store.js") return path("dist/dashboard-store.js");
        if (importer.startsWith(path("../toolcraft-design/src/prompts/interactive/"))) {
          if (name === "./multiselect.js") return path("dist/prompt-multiselect.js");
          if (name === "./select.js") return path("dist/prompt-select.js");
          if (name === "./pagination.js") return path("dist/prompt-pagination.js");
          if (name === "./text.js") return path("dist/prompt-text.js");
          if (name === "./password.js") return path("dist/prompt-password.js");
          if (name === "./glyphs.js") return path("dist/prompt-glyphs.js");
          if (name === "./confirm.js") return path("dist/prompt-confirm.js");
          if (name === "./core.js") return path("dist/prompt-core.js");
          if (name === "./keys.js") return path("dist/prompt-keys.js");
          if (name === "./wrap.js") return path("dist/prompt-wrap.js");
        }
        if (importer === path("../toolcraft-design/src/prompts/theme.test.ts")) {
          if (name === "./theme.js") return path("dist/prompt-theme.js");
          if (name === "../internal/theme-state.js") return path("dist/theme-state.js");
        }
        if (importer === path("../toolcraft-design/src/prompts/primitives/primitives.test.ts")) {
          if (["./intro.js", "./outro.js", "./cancel.js", "./log.js"].includes(name)) return path("dist/prompt-output.js");
          if (name === "./spinner.js") return path("dist/spinner.js");
        }
        if (importer === path("../toolcraft-design/src/prompts/interactive/cancel-symbol.test.ts") && name === "./cancel-symbol.js")
          return path("dist/cancel-symbol.js");
        if (importer === path("../toolcraft-design/src/components/browser.test.ts") && name === "./browser.js")
          return path("dist/browser.js");
        if (importer === path("../toolcraft-design/src/prompts/primitives/primitives.test.ts") && name === "./note.js")
          return path("dist/note.js");
        if (importer === path("../toolcraft-design/src/terminal/driver.test.ts") && name === "./driver.js")
          return path("dist/terminal-driver.js");
        if (importer === path("../toolcraft-design/src/terminal/input.test.ts") && name === "./input.js")
          return path("dist/terminal-input.js");
        if (importer === path("../toolcraft-design/src/terminal/output.test.ts") && name === "./output.js")
          return path("dist/frame-writer.js");
        if (importer === path("../toolcraft-design/src/screen/ansi-text.test.ts") && name === "./ansi-text.js")
          return path("dist/ansi-text.js");
        if (importer === path("../toolcraft-design/src/screen/screen.test.ts") && name === "./screen.js")
          return path("dist/screen.js");
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
      path("../toolcraft-design/src/index.test.ts"),
      path("../toolcraft-design/src/subpath-exports.test.ts"),
      path("../toolcraft-design/src/components/template.test.ts"),
      path("../toolcraft-design/src/dashboard/compact-layout.test.ts"),
      path("../toolcraft-design/src/dashboard/components/footer.test.ts"),
      path("../toolcraft-design/src/dashboard/terminal.test.ts"),
      path("../toolcraft-design/src/dashboard/ansi.test.ts"),
      path("../toolcraft-design/src/dashboard/store-retention.test.ts"),
      path("../toolcraft-design/src/dashboard/store-streaming.test.ts"),
      path("../toolcraft-design/src/prompts/interactive/*.test.ts"),
      path("../toolcraft-design/src/prompts/theme.test.ts"),
      path("../toolcraft-design/src/components/browser.test.ts"),
      path("../toolcraft-design/src/prompts/primitives/primitives.test.ts"),
      path("../toolcraft-design/src/terminal/driver.test.ts"),
      path("../toolcraft-design/src/terminal/input.test.ts"),
      path("../toolcraft-design/src/terminal/output.test.ts"),
      path("../toolcraft-design/src/screen/ansi-text.test.ts"),
      path("../toolcraft-design/src/screen/screen.test.ts"),
      path("../toolcraft-design/src/screen/style.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/html-renderer.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts"),
      path("../toolcraft-design/src/terminal-markdown/parser/code-highlight.test.ts"),
      path("../toolcraft-design/src/escape-terminal-text.test.ts"),
      path("../toolcraft-design/src/static/static.test.ts"),
      path("../toolcraft-design/src/dashboard/components/output-wrapping.test.ts"),
      path("../toolcraft-design/src/dashboard/components/context-pane.test.ts"),
      path("../toolcraft-design/src/dashboard/components/stats-context.test.ts"),
      path("../toolcraft-design/src/dashboard/components/run-view.test.ts"),
      path("../toolcraft-design/src/dashboard/components/output-viewport.test.ts"),
      path("../toolcraft-design/src/dashboard/components/conversation-output.test.ts"),
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
