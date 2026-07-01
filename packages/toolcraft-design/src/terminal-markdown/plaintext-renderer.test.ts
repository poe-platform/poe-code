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

describe("block nodes", () => {
  describe("headings", () => {
    it("# Title with default options", () => {
      const result = renderMarkdownPlaintext("# Title");

      expect(result.trim()).toBe("Section: Title");
    });

    it("## Sub with default options", () => {
      const result = renderMarkdownPlaintext("## Sub");

      expect(result.trim()).toBe("Subsection: Sub");
    });

    it("### Deep with default options", () => {
      const result = renderMarkdownPlaintext("### Deep");

      expect(result.trim()).toBe("Topic: Deep");
    });

    it("#### Four with default options", () => {
      const result = renderMarkdownPlaintext("#### Four");

      expect(result.trim()).toBe("Topic: Four");
    });

    it("# Title with announceHeadings disabled", () => {
      const result = renderMarkdownPlaintext("# Title", {
        announceHeadings: false
      });

      expect(result.trim()).toBe("Title");
      expect(result).not.toContain("Section:");
    });

    it("# Code `x` here", () => {
      const result = renderMarkdownPlaintext("# Code `x` here");

      expect(result).toContain("Code x here");
    });

    it("# [link](http://x.com) text with default options", () => {
      const result = renderMarkdownPlaintext("# [link](http://x.com) text");

      expect(result).toContain("link text");
      expect(result).not.toContain("http://x.com");
    });

    it("# **bold** and *italic*", () => {
      const result = renderMarkdownPlaintext("# **bold** and *italic*");

      expect(result).toContain("bold and italic");
    });
  });

  describe("paragraphs", () => {
    it("Hello.", () => {
      const result = renderMarkdownPlaintext("Hello.");

      expect(result).toBe("Hello.");
    });

    it("Line one.\\nLine two. soft wrap", () => {
      const result = renderMarkdownPlaintext("Line one.\nLine two.");

      expect(result).toContain("Line one.");
    });

    it("paragraph output trims to final sentence", () => {
      const result = renderMarkdownPlaintext("Hello.");

      expect(result.trim()).toBe("Hello.");
    });
  });

  describe("blockquotes", () => {
    it("> quoted text", () => {
      const result = renderMarkdownPlaintext("> quoted text");

      expect(result.trim()).toBe("Quote: quoted text");
    });

    it("> > nested", () => {
      const result = renderMarkdownPlaintext("> > nested");

      expect(result.trim()).toBe("Quote: Quote: nested");
    });

    it("> # heading\\n> para", () => {
      const result = renderMarkdownPlaintext("> # heading\n> para");

      expect(result).toContain("Quote: ");
      expect(result).toContain("Section: heading");
    });

    it("> - item a\\n> - item b", () => {
      const result = renderMarkdownPlaintext("> - item a\n> - item b");

      expect(result).toContain("Quote: ");
      expect(result).toContain("item a");
    });
  });

  describe("alerts", () => {
    it("> [!NOTE]\\n> body with default options", () => {
      const result = renderMarkdownPlaintext("> [!NOTE]\n> body");

      expect(result.trim()).toBe("NOTE: body");
    });

    it("> [!TIP]\\n> t", () => {
      const result = renderMarkdownPlaintext("> [!TIP]\n> t");

      expect(result.trim()).toBe("TIP: t");
    });

    it("> [!IMPORTANT]\\n> i", () => {
      const result = renderMarkdownPlaintext("> [!IMPORTANT]\n> i");

      expect(result.trim()).toBe("IMPORTANT: i");
    });

    it("> [!WARNING]\\n> w", () => {
      const result = renderMarkdownPlaintext("> [!WARNING]\n> w");

      expect(result.trim()).toBe("WARNING: w");
    });

    it("> [!CAUTION]\\n> c", () => {
      const result = renderMarkdownPlaintext("> [!CAUTION]\n> c");

      expect(result.trim()).toBe("CAUTION: c");
    });

    it("> [!NOTE]\\n> body with announceAlerts disabled", () => {
      const result = renderMarkdownPlaintext("> [!NOTE]\n> body", {
        announceAlerts: false
      });

      expect(result.trim()).toBe("body");
      expect(result).not.toContain("NOTE:");
    });
  });

  describe("code blocks", () => {
    it("fenced code with default options", () => {
      const result = renderMarkdownPlaintext("```\nfoo\n```");

      expect(result.trim()).toBe("Code: foo");
    });

    it("fenced code with announceCode disabled", () => {
      const result = renderMarkdownPlaintext("```\nfoo\n```", {
        announceCode: false
      });

      expect(result.trim()).toBe("foo");
      expect(result).not.toContain("Code:");
    });

    it("language tag is not spoken", () => {
      const result = renderMarkdownPlaintext("```ts\nconst x = 1;\n```");

      expect(result).not.toContain("ts");
    });

    it("multi-line code", () => {
      const result = renderMarkdownPlaintext("```\nline1\nline2\n```");

      expect(result).toContain("line1");
      expect(result).toContain("line2");
    });

    it("empty code block has no trailing garbage", () => {
      const result = renderMarkdownPlaintext("```\n\n```");

      expect(result).not.toContain("Code: \n");
    });
  });

  describe("thematic breaks", () => {
    it("--- alone", () => {
      const result = renderMarkdownPlaintext("---");

      expect(result.trim()).toBe("");
    });

    it("text, thematic break, and more", () => {
      const result = renderMarkdownPlaintext("text\n\n---\n\nmore");

      expect(result).toContain("text");
      expect(result).toContain("more");
      expect(result).not.toContain("---");
    });
  });

  describe("lists", () => {
    describe("unordered", () => {
      it("- a", () => {
        const result = renderMarkdownPlaintext("- a");

        expect(result).toContain("a");
      });

      it("- a\\n- b", () => {
        const result = renderMarkdownPlaintext("- a\n- b");

        expect(result.trim()).toBe("a, b");
      });

      it("- a\\n- b\\n- c", () => {
        const result = renderMarkdownPlaintext("- a\n- b\n- c");

        expect(result.trim()).toBe("a, b, c");
      });

      it("- a\\n- b\\n- c\\n- d", () => {
        const result = renderMarkdownPlaintext("- a\n- b\n- c\n- d");

        expect(result.trim()).toBe("a; b; c; d");
      });

      it("five items", () => {
        const result = renderMarkdownPlaintext("- a\n- b\n- c\n- d\n- e");

        expect(result.trim()).toBe("a; b; c; d; e");
      });
    });

    describe("ordered", () => {
      it("1. a", () => {
        const result = renderMarkdownPlaintext("1. a");

        expect(result.trim()).toBe("First, a");
      });

      it("1. a\\n2. b", () => {
        const result = renderMarkdownPlaintext("1. a\n2. b");

        expect(result.trim()).toBe("First, a Second, b");
      });

      it("1. a\\n2. b\\n3. c", () => {
        const result = renderMarkdownPlaintext("1. a\n2. b\n3. c");

        expect(result.trim()).toBe("First, a Second, b Third, c");
      });

      it("1. a\\n2. b\\n3. c\\n4. d", () => {
        const result = renderMarkdownPlaintext("1. a\n2. b\n3. c\n4. d");

        expect(result.trim()).toBe("First, a Second, b Third, c Next, d");
      });

      it("ten items", () => {
        const result = renderMarkdownPlaintext(
          "1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j"
        );

        expect(result.trim()).toBe(
          "First, a Second, b Third, c Next, d Next, e Next, f Next, g Next, h Next, i Next, j"
        );
      });
    });

    describe("task lists", () => {
      it("- [ ] todo item", () => {
        const result = renderMarkdownPlaintext("- [ ] todo item");

        expect(result).toContain("to do: todo item");
      });

      it("- [x] done item", () => {
        const result = renderMarkdownPlaintext("- [x] done item");

        expect(result).toContain("done: done item");
      });

      it("- [x] done\\n- [ ] todo", () => {
        const result = renderMarkdownPlaintext("- [x] done\n- [ ] todo");

        expect(result).toContain("done: done");
        expect(result).toContain("to do: todo");
      });

      it("- [ ] a\\n- [x] b\\n- [ ] c", () => {
        const result = renderMarkdownPlaintext("- [ ] a\n- [x] b\n- [ ] c");

        expect(result).toContain("to do: a");
        expect(result).toContain("done: b");
      });
    });

    describe("nested lists", () => {
      it("unordered list with unordered sub-list", () => {
        const result = renderMarkdownPlaintext("- parent\n  - child a\n  - child b");

        expect(result).toContain("parent");
        expect(result).toContain("child a");
        expect(result).toContain("child b");
        expect(result).not.toContain("-");
        expect(result).not.toContain("*");
        expect(result).not.toContain("•");
        expect(result).not.toContain("·");
      });

      it("ordered list with unordered sub-list", () => {
        const result = renderMarkdownPlaintext("1. first\n   - x\n   - y\n2. second");

        expect(result).toContain("First, first");
        expect(result).toContain("x");
        expect(result).toContain("Second, second");
      });
    });

    describe("list items with paragraph children", () => {
      it("- \\n  multi\\n  line\\n  item", () => {
        const result = renderMarkdownPlaintext("- \n  multi\n  line\n  item");

        expect(result).toContain("multi");
        expect(result).toContain("line");
        expect(result).toContain("item");
      });
    });
  });
});

describe("terminal markdown plaintext renderer", () => {
  it("matches parsed markdown rendering", () => {
    const markdown = "Hello **world**";
    const { ast } = parse(markdown);

    expect(renderPlaintext(ast)).toBe(renderMarkdownPlaintext(markdown));
  });

  describe("tables", () => {
    it("renders two columns with one body row", () => {
      const result = renderMarkdownPlaintext("| Name | Age |\n|------|-----|\n| Alice | 30 |");

      expect(result.trim()).toContain("Name is Alice. Age is 30.");
    });

    it("renders two columns with two body rows", () => {
      const result = renderMarkdownPlaintext(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |"
      );

      expect(result.trim()).toContain("Name is Alice. Age is 30. Name is Bob. Age is 25.");
    });

    it("skips empty cell values", () => {
      const result = renderMarkdownPlaintext("| A | B |\n|---|---|\n| foo |  |");

      expect(result.trim()).toContain("A is foo.");
      expect(result.trim()).not.toContain("B is .");
    });

    it("ignores alignment annotations", () => {
      const result = renderMarkdownPlaintext("| Name | Age | Status |\n|:---:|---:|:---|\n| Alice | 30 | ready |");

      expect(result.trim()).toContain("Name is Alice. Age is 30. Status is ready.");
    });

    it("renders formatted cell text without markdown markers", () => {
      const result = renderMarkdownPlaintext("| Name |\n|------|\n| **Alice** |");

      expect(result.trim()).toContain("Name is Alice.");
    });

    it("renders link text in cells without the URL by default", () => {
      const result = renderMarkdownPlaintext("| Url |\n|-----|\n| [site](https://x.com) |");

      expect(result.trim()).toContain("Url is site.");
      expect(result.trim()).not.toContain("https://x.com");
    });

    it("renders a single-column table", () => {
      const result = renderMarkdownPlaintext("| Item |\n|------|\n| Foo |");

      expect(result.trim()).toContain("Item is Foo.");
    });

    it("skips empty header cells", () => {
      const result = renderMarkdownPlaintext("| | B |\n|---|---|\n| 1 | 2 |");

      expect(result.trim()).toContain("B is 2.");
      expect(result.trim()).not.toContain(" is 1.");
    });
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
