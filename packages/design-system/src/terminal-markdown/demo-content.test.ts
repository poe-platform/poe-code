import { describe, expect, it } from "vitest";
import { getMarkdownDemo } from "./demo-content.js";

describe("terminal markdown demo content", () => {
  it("returns the default markdown demo", () => {
    expect(getMarkdownDemo()).toContain("# Design System Markdown");
  });

  it("returns the minimal markdown demo", () => {
    expect(getMarkdownDemo("minimal")).toBe(
      ["# Markdown Minimal", "", "Quick validation paragraph.", "", "```ts", 'console.log("demo");', "```"].join(
        "\n"
      )
    );
  });

  it("returns a focused code block demo", () => {
    const markdown = getMarkdownDemo("code-blocks");

    expect(markdown).toContain("```ts");
    expect(markdown).toContain('const sample = "**still literal**";');
    expect(markdown).toContain("  return value + 1;");
  });

  it("returns a focused blockquote demo", () => {
    const markdown = getMarkdownDemo("blockquotes");

    expect(markdown).toContain("> Outer quote");
    expect(markdown).toContain("> > Nested quote");
    expect(markdown).toContain("> > > Deep quote");
  });

  it("returns a focused lists demo", () => {
    const markdown = getMarkdownDemo("lists");

    expect(markdown).toContain("- unordered item");
    expect(markdown).toContain("1. ordered item");
    expect(markdown).toContain("- [x] completed task");
    expect(markdown).toContain("  - nested item");
  });

  it("returns a focused tables demo", () => {
    const markdown = getMarkdownDemo("tables");

    expect(markdown).toContain("| Column | Left | Center | Right |");
    expect(markdown).toContain("| :----- | :--- | :----: | ----: |");
    expect(markdown).toContain("| Alignment | alpha | beta | 42 |");
    expect(markdown).toContain("| Separators | left | mid | 9000 |");
  });

  it("returns a focused alerts demo", () => {
    const markdown = getMarkdownDemo("alerts");

    expect(markdown).toContain("> [!NOTE]");
    expect(markdown).toContain("> [!TIP]");
    expect(markdown).toContain("> [!IMPORTANT]");
    expect(markdown).toContain("> [!WARNING]");
    expect(markdown).toContain("> [!CAUTION]");
    expect(markdown).toContain("> Wrapped content stays aligned beneath the bar.");
  });
});
