import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";
import { getTheme, resetThemeCache } from "../internal/theme-detect.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { renderMarkdown } from "../terminal-markdown/index.js";
import { renderCatalog } from "./catalog.js";

const options = {
  theme: getTheme({ POE_CODE_THEME: "dark", NO_COLOR: "1" }),
  title: "Northstar API",
  subtitle: "v1.0.0",
  metrics: [
    { label: "operations", value: 3 },
    { label: "supported", value: 2, tone: "success" as const },
    { label: "unsupported", value: 1, tone: "warning" as const }
  ],
  groups: [
    {
      title: "widgets",
      items: [
        { label: "GET", value: "/widgets", detail: "widgets list", tone: "success" as const },
        {
          label: "POST",
          value: "/widgets",
          detail: "Nested objects are not supported.",
          tone: "warning" as const
        }
      ]
    },
    {
      title: "health",
      items: [{ label: "GET", value: "/health", detail: "health get", tone: "success" as const }]
    }
  ]
};

describe("renderCatalog", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
    resetThemeCache();
    resetOutputFormatCache();
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
    resetThemeCache();
    resetOutputFormatCache();
  });

  it("renders a grouped terminal catalog with summary metrics", () => {
    expect(stripAnsi(renderCatalog(options))).toBe(
      [
        "Northstar API  v1.0.0",
        "3 operations · 2 supported · 1 unsupported",
        "",
        "widgets  2",
        "GET   /widgets  widgets list",
        "POST  /widgets  Nested objects are not supported.",
        "",
        "health  1",
        "GET  /health  health get"
      ].join("\n")
    );
  });

  it("renders markdown with stable group headings", () => {
    expect(withOutputFormat("markdown", () => renderCatalog(options))).toBe(
      [
        "# Northstar API",
        "",
        "v1.0.0",
        "",
        "**3 operations · 2 supported · 1 unsupported**",
        "",
        "## widgets (2)",
        "",
        "- `GET` `/widgets` — widgets list",
        "- `POST` `/widgets` — Nested objects are not supported.",
        "",
        "## health (1)",
        "",
        "- `GET` `/health` — health get"
      ].join("\n")
    );
  });

  it("renders markdown code spans that preserve backticks in labels and values", () => {
    const markdown = withOutputFormat("markdown", () =>
      renderCatalog({
        theme: options.theme,
        title: "API",
        groups: [
          {
            title: "routes",
            items: [{ label: "GET", value: "/bots/`id`", detail: "path contains backticks" }]
          }
        ]
      })
    );

    expect(markdown).toContain("- `GET` `` /bots/`id` `` — path contains backticks");
    expect(stripAnsi(renderMarkdown(markdown))).toContain(
      "GET /bots/`id` — path contains backticks"
    );
  });

  it("renders json as the component input model", () => {
    expect(JSON.parse(withOutputFormat("json", () => renderCatalog(options)))).toEqual({
      title: "Northstar API",
      subtitle: "v1.0.0",
      metrics: options.metrics,
      groups: options.groups
    });
  });
});
