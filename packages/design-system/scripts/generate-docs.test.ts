import { describe, expect, it } from "vitest";
import {
  captureTextOutput,
  renderTextDocument,
  sections
} from "./generate-docs.js";

describe("generate-docs", () => {
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

  it("captures format-aware json menu output", () => {
    const output = captureTextOutput("menu", "json");

    expect(output).toContain('"type":"menu"');
    expect(output).toContain('"message":"Pick an agent:"');
    expect(output).not.toContain("◆");
  });
});
