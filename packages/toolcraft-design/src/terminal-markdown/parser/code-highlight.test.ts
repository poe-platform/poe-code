import { describe, expect, it } from "vitest";
import { highlightCodeBlock } from "./code-highlight.js";

describe("code highlighting tokenizer", () => {
  it("preserves source exactly across highlighted language families", () => {
    const examples = [
      { lang: "ts", value: 'const value: string = "hello";\n// comment' },
      { lang: "json", value: '{"ok": true, "count": 2, "items": null}' },
      { lang: "yaml", value: "name: demo\nitems:\n  - one\n# note" },
      { lang: "css", value: "@media screen {\n  .item { color: #fff !important; }\n}" }
    ];

    for (const example of examples) {
      const tokens = highlightCodeBlock({ type: "code", lang: example.lang, value: example.value });

      expect(tokens?.map((token) => token.value).join("")).toBe(example.value);
      expect(tokens?.some((token) => token.kind !== "plain")).toBe(true);
    }
  });

  it("does not throw or loop on malformed quoted input", () => {
    const value = 'const value = "unterminated\n/* also unterminated';
    const tokens = highlightCodeBlock({ type: "code", lang: "js", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
  });

  it("returns no tokens for unknown, plain-text, empty, and known unhighlighted languages", () => {
    expect(highlightCodeBlock({ type: "code", value: "const x = 1;" })).toBeUndefined();
    expect(highlightCodeBlock({ type: "code", lang: "text", value: "const x = 1;" })).toBeUndefined();
    expect(highlightCodeBlock({ type: "code", lang: "unknown-language", value: "const x = 1;" })).toBeUndefined();
    expect(highlightCodeBlock({ type: "code", lang: "ruby", value: "puts 'x'" })).toBeUndefined();
  });

  it("resolves language aliases case-insensitively", () => {
    const tokens = highlightCodeBlock({ type: "code", lang: "TypeScript", value: "const x = true;" });

    expect(tokens?.map((token) => token.kind)).toContain("keyword");
    expect(tokens?.map((token) => token.kind)).toContain("boolean");
  });
});
