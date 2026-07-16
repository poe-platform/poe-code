import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetOutputFormatCache,
  withOutputFormat,
  resolveOutputFormat
} from "../internal/output-format.js";
import { formatCommandNotFoundPanel } from "./command-errors.js";
import { color } from "./color.js";
import { createLogger } from "./logger.js";
import { symbols } from "./symbols.js";
import { renderTable } from "./table.js";
import { text } from "./text.js";
import type { ThemePalette } from "../tokens/colors.js";

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return chunks.join("");
}

function stripAnsi(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index += 1;
      }
      if (index < value.length) {
        index += 1;
      }
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function restoreEnv(name: "FORCE_COLOR" | "NO_COLOR", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("formatCommandNotFoundPanel", () => {
  it("formats a title, label, and footer", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "yo",
      helpCommand: "poe-code --help"
    });

    expect(panel.title).toBe("command not found");
    expect(stripAnsi(panel.label)).toContain("Unknown command:");
    expect(stripAnsi(panel.label)).toContain("yo");
    expect(stripAnsi(panel.footer)).toContain("Run");
    expect(stripAnsi(panel.footer)).toContain("poe-code --help");
    expect(stripAnsi(panel.footer)).toContain("available commands.");
  });

  it("allows overriding the title", () => {
    const panel = formatCommandNotFoundPanel({
      title: "mcp command not found",
      unknownCommand: "nope",
      helpCommand: "poe-code mcp --help"
    });

    expect(panel.title).toBe("mcp command not found");
    expect(stripAnsi(panel.footer)).toContain("poe-code mcp --help");
  });

  it("renders a did-you-mean line for suggestions", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "confgure",
      helpCommand: "poe-code --help",
      suggestions: ["configure"]
    });

    expect(stripAnsi(panel.label)).toContain("Did you mean: configure?");
  });

  it("joins multiple suggestions", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "instal",
      helpCommand: "poe-code --help",
      suggestions: ["install", "uninstall"]
    });

    expect(stripAnsi(panel.label)).toContain("Did you mean: install, uninstall?");
  });

  it("omits the did-you-mean line without suggestions", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "zzzz",
      helpCommand: "poe-code --help",
      suggestions: []
    });

    expect(stripAnsi(panel.label)).not.toContain("Did you mean");
  });

  it("keeps unknown commands on one diagnostic line", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "bad\nRun rm -rf to repair",
      helpCommand: "poe-code --help"
    });

    expect(stripAnsi(panel.label)).not.toContain("\nRun");
  });
});

describe("components/logger", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    resetOutputFormatCache();
  });

  it("renders markdown info output through the log primitive", () => {
    const logger = createLogger();

    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        logger.info("Configuring...");
      });
    });

    expect(output).toBe("- **info:** Configuring...\n");
  });

  it("renders json warning output through the log primitive", () => {
    const logger = createLogger();

    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        logger.warn("Watch out");
      });
    });

    expect(output).toBe('{"level":"warn","message":"Watch out"}\n');
  });
});

describe("symbols", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    resetOutputFormatCache();
  });

  it("renders markdown-safe symbols", () => {
    withOutputFormat("markdown", () => {
      expect(symbols.info).toBe("(i)");
      expect(symbols.success).toBe("[ok]");
      expect(symbols.resolved).toBe(">");
      expect(symbols.errorResolved).toBe("[!]");
      expect(symbols.warning).toBe("[!]");
      expect(symbols.active).toBe("[x]");
      expect(symbols.inactive).toBe("[ ]");
      expect(symbols.bar).toBe("|");
    });
  });

  it("renders json-safe symbols", () => {
    withOutputFormat("json", () => {
      expect(symbols.info).toBe("info");
      expect(symbols.success).toBe("success");
      expect(symbols.resolved).toBe("resolved");
      expect(symbols.errorResolved).toBe("error");
      expect(symbols.warning).toBe("warning");
      expect(symbols.active).toBe("active");
      expect(symbols.inactive).toBe("inactive");
      expect(symbols.bar).toBe("");
    });
  });

  it("keeps terminal bar rendering", () => {
    expect(withOutputFormat("terminal", () => symbols.bar)).toBe("│");
  });
});

const identity = (s: string) => s;
const theme: ThemePalette = {
  header: identity,
  divider: identity,
  prompt: identity,
  number: identity,
  intro: identity,
  resolvedSymbol: "",
  errorSymbol: "",
  accent: identity,
  muted: identity,
  success: identity,
  warning: identity,
  error: identity,
  info: identity,
};

const sampleOptions = {
  theme,
  columns: [
    { name: "Name", title: "Name", alignment: "left" as const, maxLen: 20 },
    { name: "Value", title: "Value", alignment: "left" as const, maxLen: 10 },
  ],
  rows: [
    { Name: "alpha", Value: "1" },
    { Name: "beta", Value: "2" },
  ],
};

function setFormat(format: string): void {
  resetOutputFormatCache();
  resolveOutputFormat({ OUTPUT_FORMAT: format });
}

describe("renderTable", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
  });

  describe("terminal format (default)", () => {
    it("renders a terminal table with box-drawing characters", () => {
      const result = renderTable(sampleOptions);
      expect(result).toContain("alpha");
      expect(result).toContain("beta");
      expect(result).toContain("┌");
    });

    it("keeps ANSI in cells without using it for width calculations", () => {
      process.env.FORCE_COLOR = "1";
      delete process.env.NO_COLOR;
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 8 },
          { name: "State", title: "State", alignment: "right", maxLen: 6 },
        ],
        rows: [{ Name: color.red("alpha"), State: "ok" }],
      });

      expect(result).toContain("\u001b[31m");
      expect(stripAnsi(result)).toMatchInlineSnapshot(`
        "┌──────────┬────────┐
        │ Name     │  State │
        ├──────────┼────────┤
        │ alpha    │     ok │
        └──────────┴────────┘"
      `);
    });

    it("uses unicode display width for emoji and CJK cells", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Kind", title: "Kind", alignment: "left", maxLen: 6 },
          { name: "Name", title: "Name", alignment: "left", maxLen: 8 },
        ],
        rows: [
          { Kind: "✅", Name: "東京" },
          { Kind: "text", Name: "alpha" },
        ],
      });

      expect(result).toMatchInlineSnapshot(`
        "┌────────┬──────────┐
        │ Kind   │ Name     │
        ├────────┼──────────┤
        │ ✅     │ 東京     │
        │ text   │ alpha    │
        └────────┴──────────┘"
      `);
    });

    it("renders detail rows without table chrome", () => {
      const result = renderTable({
        theme,
        variant: "detail",
        columns: [
          { name: "label", title: "Label", alignment: "left", maxLen: 12 },
          { name: "value", title: "Value", alignment: "left", maxLen: 8 },
        ],
        rows: [
          { label: "Display name", value: "GPT-5.5" },
          { label: "Description", value: "Handles complex multi-step agent work with less guidance." },
          { label: "Creator", value: "" },
          { label: "  Handle", value: "openai" },
        ],
        maxWidth: 44,
      });

      expect(stripAnsi(result)).toBe([
        "Display name  GPT-5.5",
        "Description   Handles complex multi-step",
        "              agent work with less guidance.",
        "Creator",
        "  Handle      openai",
      ].join("\n"));
    });

    it("wraps long unbroken detail values", () => {
      const result = renderTable({
        theme,
        variant: "detail",
        maxWidth: 24,
        columns: [
          { name: "label", title: "Label", alignment: "left", maxLen: 5 },
          { name: "value", title: "Value", alignment: "left", maxLen: 8 },
        ],
        rows: [{ label: "Image", value: "https://example.com/avatar.jpeg" }],
      });

      expect(stripAnsi(result)).toBe([
        "Image  https://example.com/",
        "       avatar.jpeg",
      ].join("\n"));
    });

    it("does not truncate standard long detail labels", () => {
      const result = renderTable({
        theme,
        variant: "detail",
        columns: [
          { name: "label", title: "Label", alignment: "left", maxLen: 33 },
          { name: "value", title: "Value", alignment: "left", maxLen: 5 },
        ],
        rows: [{ label: "Allow related bot recommendations", value: "true" }],
      });

      expect(stripAnsi(result)).toBe("Allow related bot recommendations  true");
    });

    it("keeps multi-codepoint emoji sequences intact when measuring width", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Icon", title: "Icon", alignment: "left", maxLen: 6 },
          { name: "Name", title: "Name", alignment: "left", maxLen: 6 },
        ],
        rows: [{ Icon: "👨‍👩‍👧‍👦", Name: "family" }],
      });

      expect(result).toMatchInlineSnapshot(`
        "┌────────┬────────┐
        │ Icon   │ Name   │
        ├────────┼────────┤
        │ 👨‍👩‍👧‍👦     │ family │
        └────────┴────────┘"
      `);
    });

    it("truncates cells with an ellipsis at the column width", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Value", title: "Value", alignment: "left", maxLen: 7 },
        ],
        rows: [{ Value: "super-long-value" }],
      });

      expect(result).toMatchInlineSnapshot(`
        "┌─────────┐
        │ Value   │
        ├─────────┤
        │ super-… │
        └─────────┘"
      `);
    });

    it("aligns left, center, and right columns", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Left", title: "Left", alignment: "left", maxLen: 6 },
          { name: "Center", title: "Center", alignment: "center", maxLen: 8 },
          { name: "Right", title: "Right", alignment: "right", maxLen: 6 },
        ] as never,
        rows: [{ Left: "a", Center: "b", Right: "c" }],
      });

      expect(result).toMatchInlineSnapshot(`
        "┌────────┬──────────┬────────┐
        │ Left   │  Center  │  Right │
        ├────────┼──────────┼────────┤
        │ a      │    b     │      c │
        └────────┴──────────┴────────┘"
      `);
    });

    it("can render separators between rows", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 5 },
        ],
        rows: [{ Name: "one" }, { Name: "two" }],
        rowSeparator: true,
      } as never);

      expect(result).toMatchInlineSnapshot(`
        "┌───────┐
        │ Name  │
        ├───────┤
        │ one   │
        ├───────┤
        │ two   │
        └───────┘"
      `);
    });
  });

  describe("markdown format", () => {
    beforeEach(() => {
      setFormat("markdown");
    });

    it("renders a markdown table with headers and rows", () => {
      const result = renderTable(sampleOptions);

      const lines = result.split("\n");
      expect(lines[0]).toBe("| Name | Value |");
      expect(lines[1]).toBe("| :--- | :--- |");
      expect(lines[2]).toBe("| alpha | 1 |");
      expect(lines[3]).toBe("| beta | 2 |");
      expect(lines).toHaveLength(4);
    });

    it("respects column alignment", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Left", title: "Left", alignment: "left", maxLen: 10 },
          { name: "Right", title: "Right", alignment: "right", maxLen: 10 },
        ],
        rows: [{ Left: "a", Right: "b" }],
      });

      const lines = result.split("\n");
      expect(lines[1]).toBe("| :--- | ---: |");
    });

    it("strips ANSI escape codes from cell values", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Name: color.red("colored") }],
      });

      const lines = result.split("\n");
      expect(lines[2]).toBe("| colored |");
    });

    it("handles empty rows", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Col", title: "Col", alignment: "left", maxLen: 10 },
        ],
        rows: [],
      });

      const lines = result.split("\n");
      expect(lines[0]).toBe("| Col |");
      expect(lines[1]).toBe("| :--- |");
      expect(lines).toHaveLength(2);
    });

    it("escapes pipe characters in cell content", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Expr", title: "Expr", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Expr: "a | b" }],
      });

      const lines = result.split("\n");
      expect(lines[2]).toBe("| a \\| b |");
    });

    it("escapes pipe characters in column titles", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name | Forged", alignment: "left", maxLen: 20 },
          { name: "Value", title: "Value", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Name: "alpha", Value: "1" }],
      });

      expect(result.split("\n")[0]).toBe("| Name \\| Forged | Value |");
    });

    it("renders missing special-name cells as empty", () => {
      const result = renderTable({
        theme,
        columns: [{ name: "constructor", title: "Value", alignment: "left", maxLen: 20 }],
        rows: [{ constructor: "present" }, {}],
      });

      expect(result).toBe(["| Value |", "| :--- |", "| present |", "|  |"].join("\n"));
    });
  });

  it("rejects a non-finite terminal column maximum length", () => {
    setFormat("terminal");

    expect(() =>
      renderTable({
        theme,
        columns: [{ name: "Name", title: "Name", alignment: "left", maxLen: Number.NaN }],
        rows: [{ Name: "visible" }]
      })
    ).toThrow("maxLen must be a positive finite number");
  });

  describe("json format", () => {
    beforeEach(() => {
      setFormat("json");
    });

    it("returns valid JSON array", () => {
      const result = renderTable(sampleOptions);

      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("uses column names as keys", () => {
      const result = renderTable(sampleOptions);

      const parsed = JSON.parse(result);
      expect(parsed[0]).toEqual({ Name: "alpha", Value: "1" });
      expect(parsed[1]).toEqual({ Name: "beta", Value: "2" });
    });

    it("strips ANSI from values", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Name", title: "Name", alignment: "left", maxLen: 20 },
        ],
        rows: [{ Name: color.red("colored") }],
      });

      const parsed = JSON.parse(result);
      expect(parsed[0].Name).toBe("colored");
    });

    it("preserves special column names as json properties", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "__proto__", title: "Special", alignment: "left", maxLen: 20 },
        ],
        rows: [JSON.parse('{"__proto__":"visible"}')],
      });

      expect(JSON.parse(result)[0]["__proto__"]).toBe("visible");
    });

    it("returns empty array for no rows", () => {
      const result = renderTable({
        theme,
        columns: [
          { name: "Col", title: "Col", alignment: "left", maxLen: 10 },
        ],
        rows: [],
      });

      expect(JSON.parse(result)).toEqual([]);
    });
  });
});

describe("text", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("renders markdown strings with markdown formatting", () => {
    withOutputFormat("markdown", () => {
      expect(text.intro("Intro")).toBe("**Intro**");
      expect(text.heading("Heading")).toBe("## Heading");
      expect(text.section("Section")).toBe("**Section**");
      expect(text.sectionHeader("Title")).toBe("## Title");
      expect(text.command("poe-code")).toBe("`poe-code`");
      expect(text.argument("provider")).toBe("<provider>");
      expect(text.option("--help")).toBe("`--help`");
      expect(text.example("configure --yes")).toBe("`configure --yes`");
      expect(text.usageCommand("poe-code configure")).toBe("`poe-code configure`");
      expect(text.link("https://example.com")).toBe(
        "[https://example.com](https://example.com)"
      );
      expect(text.command("safe`\n\n## FORGED")).not.toContain("\n");
      expect(text.link("safe](https://forged.test)\n## forged")).not.toContain("\n");
      expect(text.muted("Muted")).toBe("*Muted*");
      expect(text.error("Error")).toBe("**Error**");
      expect(text.badge("beta")).toBe("[beta]");
      expect(text.selectLabel("provider", "claude")).toBe("provider — claude");
    });
  });

  it("renders json strings without decoration", () => {
    withOutputFormat("json", () => {
      expect(text.intro("Intro")).toBe("Intro");
      expect(text.heading("Heading")).toBe("Heading");
      expect(text.section("Section")).toBe("Section");
      expect(text.sectionHeader("Title")).toBe("Title");
      expect(text.command("poe-code")).toBe("poe-code");
      expect(text.argument("provider")).toBe("provider");
      expect(text.option("--help")).toBe("--help");
      expect(text.example("configure --yes")).toBe("configure --yes");
      expect(text.usageCommand("poe-code configure")).toBe("poe-code configure");
      expect(text.link("https://example.com")).toBe("https://example.com");
      expect(text.muted("Muted")).toBe("Muted");
      expect(text.error("Error")).toBe("Error");
      expect(text.badge("beta")).toBe("beta");
      expect(text.selectLabel("provider", "claude")).toBe("provider — claude");
    });
  });

  it("keeps terminal formatting for select labels with detail", () => {
    const result = withOutputFormat("terminal", () =>
      text.selectLabel("my-file.md", "codex · ×3")
    );

    expect(result).toContain("my-file.md");
    expect(result).toContain("codex · ×3");
    expect(result).not.toBe("my-file.md — codex · ×3");
    expect(result).not.toBe("my-file.md codex · ×3");
  });

  it("renders terminal section headers as bold uppercase without a colon", () => {
    const result = withOutputFormat("terminal", () =>
      text.sectionHeader("Title")
    );

    expect(result).toBe("\x1b[1mTITLE\x1b[0m");
    expect(result).not.toContain(":");
  });
});

describe("text.selectLabel", () => {
  it("returns plain label when detail is undefined", () => {
    expect(text.selectLabel("my-file.md")).toBe("my-file.md");
  });

  it("returns plain label when detail is empty", () => {
    expect(text.selectLabel("my-file.md", "")).toBe("my-file.md");
  });
});
