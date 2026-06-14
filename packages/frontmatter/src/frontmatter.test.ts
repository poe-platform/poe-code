import { describe, expect, it } from "vitest";
import {
  FrontmatterParseError,
  parseFrontmatter,
  parseFrontmatterDocument,
  stringifyFrontmatter
} from "./index.js";

describe("parseFrontmatter", () => {
  it("returns empty frontmatter and the original body when no block exists", () => {
    const source = "\uFEFF# Heading\r\n\r\nBody";

    expect(parseFrontmatter(source)).toEqual({
      frontmatter: {},
      body: source
    });
  });

  it("parses scalars, nested mappings, arrays, quotes, and escapes", () => {
    const source = [
      "---",
      'title: "Hello: world"',
      "views: 42",
      "published: true",
      "summary: null",
      "meta:",
      "  tags:",
      "    - cli",
      "    - markdown",
      '  message: "line 1\\nline 2"',
      "---",
      "Body"
    ].join("\n");

    expect(parseFrontmatter(source)).toEqual({
      frontmatter: {
        title: "Hello: world",
        views: 42,
        published: true,
        summary: null,
        meta: {
          tags: ["cli", "markdown"],
          message: "line 1\nline 2"
        }
      },
      body: "Body"
    });
  });

  it("parses literal and folded block scalars", () => {
    expect(
      parseFrontmatter(
        [
          "---",
          "literal: |",
          "  line one",
          "",
          "  line two",
          "folded: >",
          "  alpha",
          "  beta",
          "---",
          "Body"
        ].join("\n")
      )
    ).toEqual({
      frontmatter: {
        literal: "line one\n\nline two\n",
        folded: "alpha beta\n"
      },
      body: "Body"
    });

    expect(parseFrontmatter(["---", "strip: |-", "  alpha", "  beta", "---"].join("\n"))).toEqual({
      frontmatter: { strip: "alpha\nbeta" },
      body: ""
    });

    expect(
      parseFrontmatter(["---", "keep: |+", "  alpha", "", "", "---", "Body"].join("\n"))
    ).toEqual({
      frontmatter: { keep: "alpha\n\n\n" },
      body: "Body"
    });
  });

  it("preserves body line endings and supports CR-only fences", () => {
    expect(parseFrontmatter("---\rtitle: Example\r---\r```js\rreturn true;\r```")).toEqual({
      frontmatter: { title: "Example" },
      body: "```js\rreturn true;\r```"
    });
  });

  it("accepts a closing fence with trailing spaces or tabs", () => {
    expect(parseFrontmatter(["---", "title: Example", "--- \t", "Body"].join("\n"))).toEqual({
      frontmatter: { title: "Example" },
      body: "Body"
    });
  });

  it("keeps __proto__ as an own property without prototype mutation", () => {
    const { frontmatter } = parseFrontmatter(
      ["---", "__proto__:", "  owner: attacker", "---", "Body"].join("\n")
    );

    expect(Object.hasOwn(frontmatter, "__proto__")).toBe(true);
    expect((frontmatter as { owner?: string }).owner).toBeUndefined();
    expect(frontmatter.__proto__).toEqual({ owner: "attacker" });
    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
  });

  it("throws a typed error for malformed or non-object frontmatter", () => {
    expect(() => parseFrontmatter(["---", "items: [broken", "---"].join("\n"))).toThrow(
      FrontmatterParseError
    );
    expect(() => parseFrontmatter(["---", "- alpha", "---"].join("\n"))).toThrow(
      "YAML frontmatter must parse to an object."
    );
    expect(() => parseFrontmatter(["---", "title: Example"].join("\n"))).toThrow(
      "Missing YAML frontmatter end delimiter (---)."
    );
  });

  it("can reject duplicate keys when a caller needs strict YAML mappings", () => {
    const source = ["---", "title: First", "title: Second", "---"].join("\n");

    expect(parseFrontmatter(source).frontmatter).toEqual({ title: "Second" });
    expect(() => parseFrontmatter(source, { uniqueKeys: true })).toThrow(FrontmatterParseError);
  });
});

describe("parseFrontmatterDocument", () => {
  it("returns yaml errors and line-aware data without throwing for parser diagnostics", () => {
    const result = parseFrontmatterDocument(
      ["---", "title: ok", "items: [broken", "---"].join("\n")
    );

    expect(result.errors[0]?.message).toContain("Flow sequence");
    expect(result.body).toBe("");
  });

  it("preserves CRLF positions for line-aware diagnostics", () => {
    const result = parseFrontmatterDocument(
      ["---", "title: ok", "items: [broken", "---"].join("\r\n")
    );
    const position = result.errors[0]?.pos?.[0];

    expect(position).toBeDefined();
    expect(result.lineCounter.linePos(position!).line).toBe(3);
  });

  it("returns duplicate key diagnostics in strict mode", () => {
    const result = parseFrontmatterDocument(
      ["---", "title: First", "title: Second", "---"].join("\n"),
      { uniqueKeys: true }
    );

    expect(result.errors[0]?.message).toContain("Map keys must be unique");
  });
});

describe("stringifyFrontmatter", () => {
  it("roundtrips parsed frontmatter and body", () => {
    const frontmatter = {
      title: "Hello",
      tags: ["alpha", "beta"],
      prompt: "line one\n\nline two\n"
    };
    const body = "# Body\r\n\r\nText";

    expect(parseFrontmatter(stringifyFrontmatter(frontmatter, body))).toEqual({
      frontmatter,
      body
    });
  });

  it("wraps stringify failures in FrontmatterParseError", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => stringifyFrontmatter(cyclic, "Body")).toThrow(FrontmatterParseError);
  });
});
