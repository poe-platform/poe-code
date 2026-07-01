import { describe, expect, it } from "vitest";
import type { MdNode } from "./ast.js";
import { parse } from "./parser.js";
import { renderMarkdownPlaintext, renderPlaintext } from "./plaintext-renderer.js";

describe("inline nodes", () => {
  it("Hello world", () => {
    const result = renderMarkdownPlaintext("Hello world");

    expect(result).toBe("Hello world");
  });

  it("*italic*", () => {
    const result = renderMarkdownPlaintext("*italic*");

    expect(result).toBe("italic");
  });

  it("**bold**", () => {
    const result = renderMarkdownPlaintext("**bold**");

    expect(result).toBe("bold");
  });

  it("***both***", () => {
    const result = renderMarkdownPlaintext("***both***");

    expect(result).toBe("both");
  });

  it("~~strike~~", () => {
    const result = renderMarkdownPlaintext("~~strike~~");

    expect(result).toBe("");
  });

  it("*outer **inner** end*", () => {
    const result = renderMarkdownPlaintext("*outer **inner** end*");

    expect(result).toBe("outer inner end");
  });

  it("`foo`", () => {
    const result = renderMarkdownPlaintext("`foo`");

    expect(result).toBe("foo");
  });

  it("` spaces `", () => {
    const result = renderMarkdownPlaintext("` spaces `");

    expect(result).toBe(" spaces ");
  });

  it("`<div>&\"'`", () => {
    const result = renderMarkdownPlaintext("`<div>&\"'`");

    expect(result).toBe("<div>&\"'");
  });

  it("line one  \\nline two", () => {
    const result = renderMarkdownPlaintext("line one  \nline two");

    expect(result).toContain("line one line two");
  });

  it("[Click here](https://example.com)", () => {
    const result = renderMarkdownPlaintext("[Click here](https://example.com)");

    expect(result).toBe("Click here");
  });

  it("[Click here](https://example.com) showLinks", () => {
    const result = renderMarkdownPlaintext("[Click here](https://example.com)", {
      showLinks: true
    });

    expect(result).toBe("Click here (link)");
  });

  it("[Click here](https://example.com) expandLinks", () => {
    const result = renderMarkdownPlaintext("[Click here](https://example.com)", {
      expandLinks: true
    });

    expect(result).toBe("Click here https://example.com");
  });

  it("[foo](https://x.com) expandLinks and showLinks", () => {
    const result = renderMarkdownPlaintext("[foo](https://x.com)", {
      expandLinks: true,
      showLinks: true
    });

    expect(result).toBe("foo https://x.com");
  });

  it("[](https://x.com)", () => {
    const result = renderMarkdownPlaintext("[](https://x.com)");

    expect(result).toBe("https://x.com");
  });

  it("[**bold link**](https://x.com)", () => {
    const result = renderMarkdownPlaintext("[**bold link**](https://x.com)");

    expect(result).toBe("bold link");
  });

  it("[email me](mailto:foo@bar.com)", () => {
    const result = renderMarkdownPlaintext("[email me](mailto:foo@bar.com)", {
      expandLinks: true
    });

    expect(result).toBe("email me mailto:foo@bar.com");
  });

  it("![a cat](cat.png)", () => {
    const result = renderMarkdownPlaintext("![a cat](cat.png)");

    expect(result).toBe("a cat");
  });

  it("![](cat.png)", () => {
    const result = renderMarkdownPlaintext("![](cat.png)");

    expect(result).toBe("");
  });

  it("text ![dog](d.png) more", () => {
    const result = renderMarkdownPlaintext("text ![dog](d.png) more");

    expect(result).toBe("text dog more");
  });

  it("<em>hi</em>", () => {
    const result = renderMarkdownPlaintext("<em>hi</em>");

    expect(result).not.toContain("<em>");
    expect(result).not.toContain("hi");
  });
});

describe("terminal markdown plaintext renderer", () => {
  it("matches parsed markdown rendering", () => {
    const markdown = "Hello **world**";
    const { ast } = parse(markdown);

    expect(renderPlaintext(ast)).toBe(renderMarkdownPlaintext(markdown));
  });

  it("renders table body cells as header-labelled sentences", () => {
    const markdown = [
      "| Name | Age | Status |",
      "| ---- | --- | ------ |",
      "| Alice | 30 | ready |",
      "| Bob |  | busy |"
    ].join("\n");

    expect(renderMarkdownPlaintext(markdown)).toBe(
      "Name is Alice. Age is 30. Status is ready. Name is Bob. Status is busy."
    );
  });

  it("omits standalone table rows and cells", () => {
    const tableCellNode: MdNode = {
      type: "tableCell",
      children: [{ type: "text", value: "orphan" }]
    };
    const tableRowNode: MdNode = { type: "tableRow", children: [tableCellNode] };

    expect(renderPlaintext(tableRowNode)).toBe("");
    expect(renderPlaintext(tableCellNode)).toBe("");
  });
});
