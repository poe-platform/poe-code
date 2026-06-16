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

  it("accepts an opening fence with trailing spaces or tabs", () => {
    expect(parseFrontmatter(["--- \t", "title: Example", "---", "Body"].join("\n"))).toEqual({
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

  it("reports diagnostic positions as original source offsets", () => {
    const source = ["---", "title: ok", "items: [broken", "---", "Body"].join("\n");
    const result = parseFrontmatterDocument(source);
    const position = result.errors[0]?.pos?.[0];

    expect(position).toBeDefined();
    expect(position).toBe(source.indexOf("items"));
    expect(result.lineCounter.linePos(position!)).toEqual({ line: 3, col: 1 });
  });

  it("preserves CRLF positions for line-aware diagnostics", () => {
    const source = ["---", "title: ok", "items: [broken", "---"].join("\r\n");
    const result = parseFrontmatterDocument(source);
    const position = result.errors[0]?.pos?.[0];

    expect(position).toBe(source.indexOf("items"));
    expect(result.lineCounter.linePos(position!)).toEqual({ line: 3, col: 1 });
  });

  it("returns duplicate key diagnostics in strict mode", () => {
    const result = parseFrontmatterDocument(
      ["---", "title: First", "title: Second", "---"].join("\n"),
      { uniqueKeys: true }
    );

    expect(result.errors[0]?.message).toContain("Map keys must be unique");
  });

  it("returns delimiter diagnostics without throwing when the closing fence is missing", () => {
    const source = ["---", "title: Example", "Body"].join("\n");
    const result = parseFrontmatterDocument(source);

    expect(result).toMatchObject({
      frontmatter: {},
      body: "",
      errors: [{ message: "Missing YAML frontmatter end delimiter (---)." }]
    });
    expect(result.errors[0]?.pos).toEqual([source.length, source.length]);
  });

  it("returns diagnostics without throwing for non-object yaml roots", () => {
    for (const yaml of ["- alpha", "42"]) {
      const result = parseFrontmatterDocument(["---", yaml, "---", "Body"].join("\n"));

      expect(result).toMatchObject({
        frontmatter: {},
        body: "Body",
        errors: [{ message: "YAML frontmatter must parse to an object." }]
      });
    }
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

  it("rejects non-object yaml roots before writing frontmatter", () => {
    for (const value of [["alpha"], "title", new Date("2026-01-01T00:00:00.000Z")]) {
      expect(() => stringifyFrontmatter(value as Record<string, unknown>, "Body")).toThrow(
        new FrontmatterParseError("YAML frontmatter must parse to an object.")
      );
    }
  });
});
