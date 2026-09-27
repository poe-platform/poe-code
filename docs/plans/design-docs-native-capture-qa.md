# Design docs native capture QA

1. Run the original executable control below independently in a temporary Vitest fixture under `out`, importing `captureTextOutputs`, `stripAnsi` and Vitest helpers from the existing modules. Keep its five-second deadline.
2. Verify one real Node/tsx executable renders heading, table, full and minimal Markdown, and JSON menu. Preserve every assertion below, including absence of npm/tsx banners and terminal borders/escape sequences.
3. Remove temporary evidence after verification.

```ts
  it("captures format-aware demo output through one executable run", () => {
    const [heading, table, markdown, minimalMarkdown, menu] = captureTextOutputs([
      { demoArgs: 'heading "Available Commands"', format: "markdown" },
      { demoArgs: "table", format: "markdown" },
      { demoArgs: "markdown", format: "markdown" },
      { demoArgs: "markdown-minimal", format: "markdown" },
      { demoArgs: "menu", format: "json" }
    ]);

    expect(heading).toContain("Available Commands");
    expect(heading).not.toContain("> toolcraft-design");
    expect(heading).not.toContain("tsx scripts/demo.ts");
    expect(table).toContain("| Model | Context | $/MTok In/Out |");
    expect(table).not.toContain("┌");
    expect(table).not.toContain("\u001b[");

    const strippedMarkdown = stripAnsi(markdown);
    expect(strippedMarkdown).toContain("Design System Markdown");
    expect(strippedMarkdown).toContain("Overview");
    expect(strippedMarkdown).toContain("Renderer Features");
    expect(strippedMarkdown).toContain("Paragraph with bold, italic, strikethrough, code");
    expect(strippedMarkdown).toContain("span, a docs link");
    expect(strippedMarkdown).toContain('const agent = "poe-code";');
    expect(strippedMarkdown).toContain("| Outer quote");
    expect(strippedMarkdown).toContain("| | Nested quote");
    expect(strippedMarkdown).toContain("• unordered item");
    expect(strippedMarkdown).toContain("1. ordered item");
    expect(strippedMarkdown).toContain("completed task");
    expect(strippedMarkdown).toContain("pending task");
    expect(strippedMarkdown).toContain("| Feature  | Alignment | Status |");
    expect(strippedMarkdown).toContain("docs link");
    expect(strippedMarkdown).toContain("(https://example.com/docs)");
    expect(strippedMarkdown).toContain("[image: System diagram]");
    expect(strippedMarkdown).toContain("| Note");
    expect(strippedMarkdown).toContain("reference[1].");
    expect(strippedMarkdown).toContain("Footnote definition for the markdown demo.");

    const strippedMinimalMarkdown = stripAnsi(minimalMarkdown);
    expect(strippedMinimalMarkdown).toContain("Markdown Minimal");
    expect(strippedMinimalMarkdown).toContain("Quick validation");
    expect(strippedMinimalMarkdown).toContain('console.log("demo");');
    expect(strippedMinimalMarkdown).not.toContain("| Feature |");
    expect(strippedMinimalMarkdown).not.toContain("> Note");
    expect(menu).toContain('"type":"menu"');
    expect(menu).toContain('"message":"Pick an agent:"');
    expect(menu).not.toContain("◆");
  });
```
