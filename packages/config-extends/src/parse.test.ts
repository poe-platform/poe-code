import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse.js";

describe("parseDocument", () => {
  it("parses markdown frontmatter and body into data.prompt", () => {
    expect(
      parseDocument("---\ntitle: Hello\ncount: 2\n---\nWrite something", "/tmp/config.md")
    ).toEqual({
      data: {
        title: "Hello",
        count: 2,
        prompt: "Write something"
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it("parses yaml and keeps prompt in data", () => {
    expect(parseDocument("title: Hello\nprompt: Write something", "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello",
        prompt: "Write something"
      },
      format: "yaml",
      extends: false,
      hasExtendsField: false
    });
  });

  it("parses comment-only yaml as an empty object", () => {
    expect(parseDocument("# no project overrides\n", "/tmp/config.yaml")).toEqual({
      data: {},
      format: "yaml",
      extends: false,
      hasExtendsField: false
    });
  });

  it("parses json and keeps prompt in data", () => {
    expect(
      parseDocument('{"title":"Hello","prompt":"Write something"}', "/tmp/config.json")
    ).toEqual({
      data: {
        title: "Hello",
        prompt: "Write something"
      },
      format: "json",
      extends: false,
      hasExtendsField: false
    });
  });

  it("returns an empty string prompt for markdown without a body", () => {
    expect(parseDocument("---\ntitle: Hello\n---\n", "/tmp/config.md")).toEqual({
      data: {
        title: "Hello",
        prompt: ""
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it("preserves a frontmatter prompt when markdown body is empty", () => {
    expect(parseDocument("---\nprompt: From frontmatter\ntitle: Demo\n---\n", "/tmp/config.md")).toEqual({
      data: {
        prompt: "From frontmatter",
        title: "Demo"
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it("treats markdown starting with a horizontal rule as prompt body", () => {
    const content = "---\n# Prompt\n\nBody\n";

    expect(parseDocument(content, "/tmp/config.md")).toEqual({
      data: {
        prompt: content
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it.each([
    ["yaml", "title: Hello", "/tmp/config.yaml"],
    ["json", '{"title":"Hello"}', "/tmp/config.json"]
  ])("does not add data.prompt for %s without a prompt key", (_format, content, filePath) => {
    const result = parseDocument(content, filePath);

    expect(result.data).toEqual({ title: "Hello" });
    expect(result.data).not.toHaveProperty("prompt");
  });

  it("extracts extends: true and strips it from data", () => {
    expect(parseDocument("extends: true\ntitle: Hello", "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: true,
      hasExtendsField: true
    });
  });

  it("extracts path-valued extends and strips it from data", () => {
    expect(parseDocument("extends: ./_bases/coding.md\ntitle: Hello", "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: "./_bases/coding.md",
      hasExtendsField: true
    });
  });

  it("trims path-valued extends before returning it", () => {
    expect(parseDocument('extends: " ./base.yaml "\ntitle: Hello', "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: "./base.yaml",
      hasExtendsField: true
    });
  });

  it("rejects invalid extends values", () => {
    expect(() => parseDocument("extends: 42\ntitle: Hello", "/tmp/config.yaml")).toThrow(
      'Invalid extends value in /tmp/config.yaml: expected a boolean or relative string path.'
    );
  });

  it("rejects empty path-valued extends", () => {
    expect(() => parseDocument('extends: ""\ntitle: Hello', "/tmp/config.yaml")).toThrow(
      'Invalid extends value in /tmp/config.yaml: expected a non-empty relative path.'
    );
  });

  it("rejects absolute path-valued extends", () => {
    expect(() => parseDocument("extends: /tmp/base.yaml\ntitle: Hello", "/tmp/config.yaml")).toThrow(
      'Invalid extends value in /tmp/config.yaml: expected a relative path.'
    );
  });

  it("returns extends false when the field is missing", () => {
    expect(parseDocument("title: Hello", "/tmp/config.yaml").extends).toBe(false);
  });

  it("ignores inherited extends values when the field is missing", () => {
    Object.defineProperty(Object.prototype, "extends", {
      configurable: true,
      value: true
    });

    try {
      expect(parseDocument("title: Hello", "/tmp/config.yaml")).toEqual({
        data: {
          title: "Hello"
        },
        format: "yaml",
        extends: false,
        hasExtendsField: false
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).extends;
    }
  });

  it("marks extends as missing when the field is absent", () => {
    expect(parseDocument("title: Hello", "/tmp/config.yaml").hasExtendsField).toBe(false);
  });

  it("marks extends as explicitly configured when false", () => {
    expect(parseDocument("extends: false\ntitle: Hello", "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: false,
      hasExtendsField: true
    });
  });

  it("supports a BOM when detecting markdown by content", () => {
    expect(
      parseDocument("\uFEFF---\ntitle: Hello\n---\nWrite something", "/tmp/config.txt")
    ).toEqual({
      data: {
        title: "Hello",
        prompt: "Write something"
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it("detects extensionless markdown frontmatter with CR-only line endings", () => {
    expect(parseDocument("---\rtitle: Hello\r---\rWrite something", "/tmp/config")).toEqual({
      data: {
        title: "Hello",
        prompt: "Write something"
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it.each([
    ["yaml scalar", "hello", "/tmp/config.yaml"],
    ["json array", "[1]", "/tmp/config.json"]
  ])("rejects a non-object %s root", (_format, content, filePath) => {
    expect(() => parseDocument(content, filePath)).toThrow(
      `Invalid configuration in ${filePath}: expected an object root.`
    );
  });

  it("supports a BOM for markdown files detected by extension", () => {
    expect(parseDocument("\uFEFF---\ntitle: Hello\n---\nWrite something", "/tmp/config.md")).toEqual({
      data: {
        title: "Hello",
        prompt: "Write something"
      },
      format: "markdown",
      extends: false,
      hasExtendsField: false
    });
  });

  it("throws for invalid yaml", () => {
    expect(() => parseDocument("title: [", "/tmp/config.yaml")).toThrow();
  });

  it("throws for invalid json", () => {
    expect(() => parseDocument('{"title":', "/tmp/config.json")).toThrow("/tmp/config.json");
  });

  it.each([
    ["markdown", "/tmp/config.md", "---\ntitle: Hello\n---\nWrite something"],
    ["yaml", "/tmp/config.yaml", "title: Hello"],
    ["yaml", "/tmp/config.yml", "title: Hello"],
    ["json", "/tmp/config.json", '{"title":"Hello"}']
  ])("detects %s by file extension", (format, filePath, content) => {
    expect(parseDocument(content, filePath).format).toBe(format);
  });

  it.each([
    ["json", "/tmp/config.txt", '{"title":"Hello"}'],
    ["markdown", "/tmp/config.txt", "---\ntitle: Hello\n---\nWrite something"],
    ["yaml", "/tmp/config.txt", "title: Hello"]
  ])("detects %s by content fallback when extension is not recognized", (format, filePath, content) => {
    expect(parseDocument(content, filePath).format).toBe(format);
  });

  it("prefers the file extension over content fallback detection", () => {
    expect(parseDocument('{"title":"Hello"}', "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: false,
      hasExtendsField: false
    });
  });
});
