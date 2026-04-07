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

  it("ignores non-boolean extends values, strips them, and marks extends as explicitly configured", () => {
    expect(parseDocument('extends: "something"\ntitle: Hello', "/tmp/config.yaml")).toEqual({
      data: {
        title: "Hello"
      },
      format: "yaml",
      extends: false,
      hasExtendsField: true
    });
  });

  it("returns extends false when the field is missing", () => {
    expect(parseDocument("title: Hello", "/tmp/config.yaml").extends).toBe(false);
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
    expect(() => parseDocument('{"title":', "/tmp/config.json")).toThrow();
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
