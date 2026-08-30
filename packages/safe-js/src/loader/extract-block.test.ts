import { describe, expect, it } from "vitest";
import { extractBlock } from "./extract-block.js";

describe("extractBlock", () => {
  it("combines js fenced blocks with their original source offsets", () => {
    const markdown = [
      "# Plan",
      "",
      "```js",
      "const value = 1;",
      "return value;",
      "```",
      "",
      "```js",
      "throw new Error('ignored');",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: expect.stringContaining("const value = 1;\nreturn value;\n")
    });
    expect(extractBlock(markdown).source).toContain("throw new Error('ignored');");
  });

  it("accepts ajs info strings and ignores trailing info text", () => {
    const markdown = ["Before", "", "```ajs title=example", "await step();", "```"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "await step();\n"
    });
  });

  it("skips non-script fenced blocks before the first js-compatible block", () => {
    const markdown = [
      "```ts",
      "const typed = true;",
      "```",
      "",
      "```js",
      "const actual = true;",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 5,
      source: "const actual = true;\n"
    });
  });

  it("does not treat fences inside an earlier non-script block as markdown fences", () => {
    const markdown = [
      "````ts",
      "const example = String.raw`",
      "```js",
      "throw new Error('not markdown');",
      "```",
      "`;",
      "````",
      "",
      "```ajs",
      "await actualStep();",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 9,
      source: "await actualStep();\n"
    });
  });

  it("includes subsequent executable fences in source order", () => {
    const markdown = [
      "```js",
      "const actual = true;",
      "```",
      "",
      "```ajs",
      "throw new Error('ignored');",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: expect.stringContaining("const actual = true;\n")
    });
    expect(extractBlock(markdown).source).toContain("throw new Error('ignored');");
  });

  it("does not match info strings that only share a prefix like json", () => {
    const markdown = [
      "```json",
      '{ "ignored": true }',
      "```",
      "",
      "```js",
      "const actual = true;",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 5,
      source: "const actual = true;\n"
    });
  });

  it("ignores fenced blocks with no language tag", () => {
    const markdown = [
      "```",
      "const ignored = true;",
      "```",
      "",
      "```ajs",
      "const actual = true;",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 5,
      source: "const actual = true;\n"
    });
  });

  it("accepts javascript as a js-compatible info string", () => {
    const markdown = ["Intro", "", "```javascript", "const actual = true;", "```"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "const actual = true;\n"
    });
  });

  it("allows closing fences longer than the opening marker", () => {
    const markdown = ["```js", "const value = 1;", "````"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: "const value = 1;\n"
    });
  });

  it("does not close on a shorter fence marker", () => {
    const markdown = ["````js", "const nested = `", "```", "`;"].join("\n");

    expect(() => extractBlock(markdown)).toThrowError("Unclosed js fenced block opened at line 1.");
  });

  it("extracts tilde-fenced JavaScript blocks", () => {
    const markdown = ["# Plan", "", "~~~js", "return 1;", "~~~"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "return 1;\n"
    });
  });

  it("does not close a tilde fence with backticks", () => {
    const markdown = ["~~~js", "return 1;", "```", "return 2;", "~~~"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: "return 1;\n```\nreturn 2;\n"
    });
  });

  it("does not close on a fence marker embedded in a string", () => {
    const markdown = ["```js", "const marker = '```';", "const actual = true;", "```"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: "const marker = '```';\nconst actual = true;\n"
    });
  });

  it("extracts a fenced block indented under a list item", () => {
    const markdown = ["- Run this:", "    ```js", "    const actual = true;", "    ```"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 2,
      source: "    const actual = true;\n"
    });
  });

  it("extracts a block at the start of the file", () => {
    const markdown = ["```js", "const actual = true;", "```", "", "Tail"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: "const actual = true;\n"
    });
  });

  it("extracts a block at the end of the file with no closing newline", () => {
    const markdown = ["Intro", "", "```js", "const actual = true;", "```"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "const actual = true;\n"
    });
  });

  it("throws a clear error for an unclosed script block at EOF", () => {
    const markdown = ["Intro", "", "```js", "const actual = true;"].join("\n");

    expect(() => extractBlock(markdown)).toThrowError("Unclosed js fenced block opened at line 3.");
  });

  it("preserves mixed CRLF and LF line endings inside a block", () => {
    const markdown = "Intro\r\n\r\n```js\r\nconst first = true;\nconst second = true;\r\n```";

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "const first = true;\nconst second = true;\r\n"
    });
  });

  it("reports the offset needed to map the first code line back to markdown", () => {
    const markdown = ["# Heading", "", "Intro", "", "```js", "const actual = true;", "```"].join(
      "\n"
    );

    const result = extractBlock(markdown);

    expect(result).toMatchObject({
      lineOffset: 5,
      source: "const actual = true;\n"
    });
    expect(result.lineOffset + 1).toBe(6);
  });

  it("tracks line offsets correctly when frontmatter precedes the fence", () => {
    const markdown = [
      "---",
      "title: Example",
      "---",
      "",
      "Intro",
      "",
      "```js",
      "const answer = 42;",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 7,
      source: "const answer = 42;\n"
    });
  });

  it("tracks line offsets correctly for CRLF content", () => {
    const markdown = ["# Heading", "", "```js", "const answer = 42;", "return answer;", "```"].join(
      "\r\n"
    );

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 3,
      source: "const answer = 42;\r\nreturn answer;\r\n"
    });
  });

  it("tracks line offsets through skipped CRLF fenced blocks", () => {
    const markdown = [
      "```ts",
      "const typed = true;",
      "```",
      "",
      "```js",
      "const answer = 42;",
      "```"
    ].join("\r\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 5,
      source: "const answer = 42;\r\n"
    });
  });

  it("returns the original markdown when an earlier non-script fence is unclosed", () => {
    const markdown = ["```ts", "const typed = true;", "", "```js", "const hidden = true;"].join(
      "\n"
    );

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: markdown
    });
  });

  it("returns the original markdown when no js-compatible fence exists", () => {
    const markdown = ["# Heading", "", "Body"].join("\n");

    expect(extractBlock(markdown)).toMatchObject({
      lineOffset: 1,
      source: markdown
    });
  });
});
