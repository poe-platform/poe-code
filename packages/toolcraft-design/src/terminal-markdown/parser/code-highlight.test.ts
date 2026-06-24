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

  it("returns no tokens for unknown, plain-text, and empty languages", () => {
    expect(highlightCodeBlock({ type: "code", value: "const x = 1;" })).toBeUndefined();
    expect(highlightCodeBlock({ type: "code", lang: "text", value: "const x = 1;" })).toBeUndefined();
    expect(highlightCodeBlock({ type: "code", lang: "unknown-language", value: "const x = 1;" })).toBeUndefined();
  });

  it("resolves language aliases case-insensitively", () => {
    const tokens = highlightCodeBlock({ type: "code", lang: "TypeScript", value: "const x = true;" });

    expect(tokens?.map((token) => token.kind)).toContain("keyword");
    expect(tokens?.map((token) => token.kind)).toContain("boolean");
  });

  it("highlights Python comments, decorators, keywords, strings, booleans, and None", () => {
    const value = [
      "# comment",
      "@dataclass",
      "async def run(path: str) -> None:",
      "    text = \"<safe>\"",
      "    enabled = True",
      "    return None"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "python", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "decorator", "keyword", "type", "string", "boolean", "null"])
    );
  });

  it("preserves malformed Python triple-quoted strings without throwing", () => {
    const value = [
      "def run():",
      "    text = \"\"\"unterminated",
      "    return True"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "py", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.some((token) => token.kind === "string")).toBe(true);
  });

  it("highlights shell comments, commands, strings, flags, and variables", () => {
    const value = [
      "# comment",
      "export PATH=\"$HOME/bin:$PATH\"",
      "if test -f ./script.sh; then",
      "  printf $HOME",
      "  echo \"ready\"",
      "fi"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "bash", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "command", "string", "flag", "variable", "keyword"])
    );
  });

  it("highlights SQL comments, keywords, strings, numbers, and nulls case-insensitively", () => {
    const value = [
      "-- comment",
      "SELECT id, 'admin' FROM users WHERE active = TRUE AND deleted_at IS NULL LIMIT 10;"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "sql", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "keyword", "string", "number", "boolean", "null"])
    );
  });

  it("highlights Go comments, keywords, strings, numbers, booleans, and nil", () => {
    const value = [
      "// comment",
      "func main() {",
      "  value := \"ready\"",
      "  enabled := true",
      "  var next *int = nil",
      "  _ = 42",
      "}"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "go", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "keyword", "string", "number", "boolean", "null"])
    );
  });

  it("highlights Rust comments, attributes, keywords, strings, numbers, booleans, and types", () => {
    const value = [
      "// comment",
      "#[derive(Debug)]",
      "fn main() -> Option<String> {",
      "  let enabled: bool = true;",
      "  Some(\"ready\".to_string())",
      "}"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "rust", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "decorator", "keyword", "string", "boolean", "type"])
    );
  });

  it("highlights Ruby comments, keywords, strings, numbers, booleans, and nil", () => {
    const value = [
      "# comment",
      "class Runner",
      "  def call(path)",
      "    enabled = true",
      "    value = nil",
      "    puts \"ready #{path}\"",
      "  end",
      "end"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "ruby", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "keyword", "string", "boolean", "null"])
    );
  });

  it("highlights TOML comments, keys, strings, numbers, booleans, and dates enough for config examples", () => {
    const value = [
      "# comment",
      "[tool.runner]",
      "enabled = true",
      "name = \"demo\"",
      "count = 42",
      "released = 2026-06-24"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "toml", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "key", "string", "number", "boolean"])
    );
  });

  it("highlights Java comments, annotations, keywords, strings, numbers, booleans, nulls, and types", () => {
    const value = [
      "// comment",
      "@Deprecated",
      "public final class Runner {",
      "  String name = \"ready\";",
      "  boolean enabled = true;",
      "  Object next = null;",
      "  int count = 42;",
      "}"
    ].join("\n");
    const tokens = highlightCodeBlock({ type: "code", lang: "java", value });

    expect(tokens?.map((token) => token.value).join("")).toBe(value);
    expect(tokens?.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["comment", "decorator", "keyword", "string", "number", "boolean", "null", "type"])
    );
  });
});
