export type MarkdownDemoName =
  | "default"
  | "minimal"
  | "code-blocks"
  | "blockquotes"
  | "lists"
  | "tables"
  | "alerts";

export function getMarkdownDemo(name: MarkdownDemoName = "default"): string {
  switch (name) {
    case "minimal":
      return [
        "# Markdown Minimal",
        "",
        "Quick validation paragraph.",
        "",
        "```ts",
        'console.log("demo");',
        "```"
      ].join("\n");
    case "code-blocks":
      return [
        "# Code Blocks",
        "",
        "```ts",
        'const sample = "**still literal**";',
        "",
        "function increment(value: number): number {",
        "  return value + 1;",
        "}",
        "",
        'console.log("``` also literal inside code");',
        "```"
      ].join("\n");
    case "blockquotes":
      return [
        "# Blockquotes",
        "",
        "> Outer quote",
        "> with a second line for spacing.",
        ">",
        "> > Nested quote",
        "> > keeps its own bar prefix.",
        "> >",
        "> > > Deep quote",
        "> > > stays indented."
      ].join("\n");
    case "lists":
      return [
        "# Lists",
        "",
        "- unordered item",
        "  - nested item",
        "  - another nested item",
        "- another unordered item",
        "",
        "1. ordered item",
        "2. ordered item",
        "   1. nested ordered item",
        "   2. another nested ordered item",
        "",
        "- [x] completed task",
        "- [ ] pending task",
        "  - [x] nested done task",
        "  - [ ] nested pending task"
      ].join("\n");
    case "tables":
      return [
        "# Tables",
        "",
        "| Column | Left | Center | Right |",
        "| :----- | :--- | :----: | ----: |",
        "| Alignment | alpha | beta | 42 |",
        "| Separators | left | mid | 9000 |",
        "| Header | visible | x | 7 |"
      ].join("\n");
    case "alerts":
      return [
        "# Alerts",
        "",
        "> [!NOTE]",
        "> Note labels use info styling.",
        ">",
        "> Wrapped content stays aligned beneath the bar.",
        "",
        "> [!TIP]",
        "> Tip labels use success styling.",
        ">",
        "> Multi-line content keeps its indentation.",
        "",
        "> [!IMPORTANT]",
        "> Important labels reuse the info color.",
        ">",
        "> The follow-up line stays under the same prefix.",
        "",
        "> [!WARNING]",
        "> Warning labels use warning styling.",
        ">",
        "> Additional detail remains aligned.",
        "",
        "> [!CAUTION]",
        "> Caution labels use error styling.",
        ">",
        "> The final alert confirms the red variant."
      ].join("\n");
    case "default":
      return [
        "# Design System Markdown",
        "",
        "## Overview",
        "",
        "### Renderer Features",
        "",
        "Paragraph with **bold**, *italic*, ~~strikethrough~~, `code span`, a [docs link](https://example.com/docs), an image ![System diagram](https://example.com/system.png), and a footnote reference[^demo].",
        "",
        "```ts",
        'const agent = "poe-code";',
        "console.log(agent);",
        "```",
        "",
        "> Outer quote",
        ">",
        "> > Nested quote",
        "",
        "- unordered item",
        "- another unordered item",
        "",
        "1. ordered item",
        "2. another ordered item",
        "",
        "- [x] completed task",
        "- [ ] pending task",
        "",
        "| Feature | Alignment | Status |",
        "| :------ | :-------: | -----: |",
        "| Headings | center | Ready |",
        "| Tables | aligned | 100% |",
        "",
        "> [!NOTE]",
        "> Alerts are rendered as styled notes.",
        "",
        "---",
        "",
        "[^demo]: Footnote definition for the markdown demo."
      ].join("\n");
  }
}
