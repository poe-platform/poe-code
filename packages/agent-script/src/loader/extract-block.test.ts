import { describe, expect, it } from "vitest";
import { extractBlock } from "./extract-block.js";

describe("extractBlock", () => {
  it("returns the first js fenced block source with its starting line offset", () => {
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

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 3,
      source: "const value = 1;\nreturn value;\n"
    });
  });

  it("accepts ajs info strings and ignores trailing info text", () => {
    const markdown = [
      "Before",
      "",
      "```ajs title=example",
      "await step();",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toEqual({
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

    expect(extractBlock(markdown)).toEqual({
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

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 9,
      source: "await actualStep();\n"
    });
  });

  it("keeps subsequent script fences inert once the first block has been selected", () => {
    const markdown = [
      "```js",
      "const actual = true;",
      "```",
      "",
      "```ajs",
      "throw new Error('ignored');",
      "```"
    ].join("\n");

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 1,
      source: "const actual = true;\n"
    });
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

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 5,
      source: "const actual = true;\n"
    });
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

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 7,
      source: "const answer = 42;\n"
    });
  });

  it("tracks line offsets correctly for CRLF content", () => {
    const markdown = [
      "# Heading",
      "",
      "```js",
      "const answer = 42;",
      "return answer;",
      "```"
    ].join("\r\n");

    expect(extractBlock(markdown)).toEqual({
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

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 5,
      source: "const answer = 42;\r\n"
    });
  });

  it("returns the original markdown when an earlier non-script fence is unclosed", () => {
    const markdown = [
      "```ts",
      "const typed = true;",
      "",
      "```js",
      "const hidden = true;"
    ].join("\n");

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 1,
      source: markdown
    });
  });

  it("returns the original markdown when no js-compatible fence exists", () => {
    const markdown = ["# Heading", "", "Body"].join("\n");

    expect(extractBlock(markdown)).toEqual({
      lineOffset: 1,
      source: markdown
    });
  });
});
