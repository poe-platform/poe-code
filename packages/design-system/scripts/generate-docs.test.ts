import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/internal/strip-ansi.js";
import { captureTextOutput, renderTextDocument, sections } from "./generate-docs.js";

describe("generate-docs", () => {
  it("lists the current demo types in the no-argument usage output", () => {
    let output = "";

    try {
      captureTextOutput("", "markdown");
    } catch (error) {
      output = String(error);
    }

    expect(output).toContain("Usage: demo <type> [value...]");
    expect(output).toContain("layout");
    expect(output).toContain("layout-expanded");
    expect(output).toContain("table");
    expect(output).toContain("table-markdown");
    expect(output).toContain("markdown");
    expect(output).toContain("markdown-minimal");
  });

  it("renders markdown docs with fenced markdown output blocks", () => {
    const output = renderTextDocument("markdown", (demoArgs, format) => {
      expect(format).toBe("markdown");
      return `captured ${format}: ${demoArgs}\n`;
    });

    expect(output).toContain("# Design Language Markdown");
    expect(output).toContain(
      "This document is auto-generated. Run `npm run generate:design-docs:markdown` to regenerate."
    );
    expect(output).toContain("```markdown");
    expect(output).toContain("captured markdown: layout");
    expect(output).not.toContain("![layout-basic](design-language/layout-basic.png)");
  });

  it("renders json docs with fenced json output blocks", () => {
    const output = renderTextDocument("json", (demoArgs, format) => {
      expect(format).toBe("json");
      return `{"demo":"${demoArgs}","format":"${format}"}\n`;
    });

    expect(output).toContain("# Design Language JSON");
    expect(output).toContain(
      "This document is auto-generated. Run `npm run generate:design-docs:json` to regenerate."
    );
    expect(output).toContain("```json");
    expect(output).toContain('{"demo":"layout","format":"json"}');
  });

  it("keeps generated text docs aligned with the design elements list", () => {
    const output = renderTextDocument("markdown", () => "demo output\n");
    const elementCount = sections.flatMap((section) => section.elements).length;

    expect(output.match(/^### /gm)).toHaveLength(elementCount);
    expect(output.match(/^```typescript$/gm)).toHaveLength(elementCount + 2);
    expect(output.match(/^```markdown$/gm)).toHaveLength(elementCount);
  });

  it("captures only demo output for text variants", () => {
    const output = captureTextOutput('heading "Available Commands"', "markdown");

    expect(output).toContain("Available Commands");
    expect(output).not.toContain("> @poe-code/design-system");
    expect(output).not.toContain("tsx scripts/demo.ts");
  });

  it("captures format-aware markdown table output", () => {
    const output = captureTextOutput("table", "markdown");

    expect(output).toContain("| Model | Context | $/MTok In/Out |");
    expect(output).not.toContain("┌");
    expect(output).not.toContain("\u001b[");
  });

  it("captures the full markdown renderer demo output", () => {
    const output = stripAnsi(captureTextOutput("markdown", "markdown"));

    expect(output).toContain("Design System Markdown");
    expect(output).toContain("Overview");
    expect(output).toContain("Renderer Features");
    expect(output).toContain("Paragraph with bold, italic, strikethrough, code");
    expect(output).toContain("span, a docs link");
    expect(output).toContain('const agent = "poe-code";');
    expect(output).toContain("| Outer quote");
    expect(output).toContain("| | Nested quote");
    expect(output).toContain("• unordered item");
    expect(output).toContain("1. ordered item");
    expect(output).toContain("completed task");
    expect(output).toContain("pending task");
    expect(output).toContain("| Feature  | Alignment | Status |");
    expect(output).toContain("docs link");
    expect(output).toContain("(https://example.com/docs)");
    expect(output).toContain("[image: System diagram]");
    expect(output).toContain("| Note");
    expect(output).toContain("reference[1].");
    expect(output).toContain("Footnote definition for the markdown demo.");
  });

  it("captures the minimal markdown renderer demo output", () => {
    const output = stripAnsi(captureTextOutput("markdown-minimal", "markdown"));

    expect(output).toContain("Markdown Minimal");
    expect(output).toContain("Quick validation");
    expect(output).toContain('console.log("demo");');
    expect(output).not.toContain("| Feature |");
    expect(output).not.toContain("> Note");
  });

  it("captures format-aware json menu output", () => {
    const output = captureTextOutput("menu", "json");

    expect(output).toContain('"type":"menu"');
    expect(output).toContain('"message":"Pick an agent:"');
    expect(output).not.toContain("◆");
  });
});
