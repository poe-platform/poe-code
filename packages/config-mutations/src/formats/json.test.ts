import { describe, it, expect } from "vitest";
import {
  jsonFormat,
  detectIndent,
  modifyAtPath,
  mergePreservingComments,
  removeAtPath
} from "./json.js";

describe("jsonFormat", () => {
  describe("parse", () => {
    it("parses valid JSON", () => {
      const result = jsonFormat.parse('{"key": "value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("returns empty object for empty string", () => {
      expect(jsonFormat.parse("")).toEqual({});
    });

    it("returns empty object for whitespace-only string", () => {
      expect(jsonFormat.parse("   ")).toEqual({});
    });

    it("returns empty object for null JSON value", () => {
      expect(jsonFormat.parse("null")).toEqual({});
    });

    it("throws for invalid JSON", () => {
      expect(() => jsonFormat.parse("not json")).toThrow();
    });

    it("throws for JSON array", () => {
      expect(() => jsonFormat.parse("[1, 2, 3]")).toThrow("Expected JSON object");
    });

    it("throws for JSON primitive", () => {
      expect(() => jsonFormat.parse("123")).toThrow("Expected JSON object");
    });

    it("parses JSON with line comments", () => {
      const content = `{
        // This is a comment
        "key": "value"
      }`;
      const result = jsonFormat.parse(content);
      expect(result).toEqual({ key: "value" });
    });

    it("parses JSON with block comments", () => {
      const content = `{
        /* This is a block comment */
        "key": "value"
      }`;
      const result = jsonFormat.parse(content);
      expect(result).toEqual({ key: "value" });
    });

    it("parses JSON with trailing commas", () => {
      const content = `{
        "key": "value",
      }`;
      const result = jsonFormat.parse(content);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("detectIndent", () => {
    it("detects 2-space indentation", () => {
      const content = `{
  "key": "value"
}`;
      expect(detectIndent(content)).toBe("  ");
    });

    it("detects 4-space indentation", () => {
      const content = `{
    "key": "value"
}`;
      expect(detectIndent(content)).toBe("    ");
    });

    it("detects tab indentation", () => {
      const content = `{
\t"key": "value"
}`;
      expect(detectIndent(content)).toBe("\t");
    });

    it("defaults to 2 spaces when no indentation found", () => {
      const content = `{"key": "value"}`;
      expect(detectIndent(content)).toBe("  ");
    });
  });

  describe("serialize", () => {
    it("serializes with 2-space indentation", () => {
      const result = jsonFormat.serialize({ key: "value" });
      expect(result).toBe('{\n  "key": "value"\n}\n');
    });

    it("ends with newline", () => {
      const result = jsonFormat.serialize({});
      expect(result.endsWith("\n")).toBe(true);
    });

    it("handles nested objects", () => {
      const result = jsonFormat.serialize({ a: { b: { c: "value" } } });
      expect(result).toMatchInlineSnapshot(`
        "{
          "a": {
            "b": {
              "c": "value"
            }
          }
        }
        "
      `);
    });
  });

  describe("merge", () => {
    it("merges simple objects", () => {
      const result = jsonFormat.merge({ a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("overwrites primitive values", () => {
      const result = jsonFormat.merge({ a: 1 }, { a: 2 });
      expect(result).toEqual({ a: 2 });
    });

    it("deep merges nested objects", () => {
      const result = jsonFormat.merge(
        { nested: { a: 1, b: 2 } },
        { nested: { b: 3, c: 4 } }
      );
      expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
    });

    it("replaces arrays (no array merge)", () => {
      const result = jsonFormat.merge({ arr: [1, 2] }, { arr: [3, 4, 5] });
      expect(result).toEqual({ arr: [3, 4, 5] });
    });

    it("ignores undefined values in source", () => {
      const result = jsonFormat.merge({ a: 1 }, { b: undefined } as any);
      expect(result).toEqual({ a: 1 });
    });

    it("does not mutate original objects", () => {
      const base = { a: 1 };
      const patch = { b: 2 };
      jsonFormat.merge(base, patch);
      expect(base).toEqual({ a: 1 });
      expect(patch).toEqual({ b: 2 });
    });
  });

  describe("prune", () => {
    it("removes keys matching shape", () => {
      const { changed, result } = jsonFormat.prune(
        { a: 1, b: 2, c: 3 },
        { a: {}, c: {} }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({ b: 2 });
    });

    it("returns unchanged: false when nothing matches", () => {
      const { changed, result } = jsonFormat.prune({ a: 1 }, { b: {} });
      expect(changed).toBe(false);
      expect(result).toEqual({ a: 1 });
    });

    it("recursively prunes nested objects", () => {
      const { changed, result } = jsonFormat.prune(
        { nested: { a: 1, b: 2 }, keep: true },
        { nested: { a: {} } }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({ nested: { b: 2 }, keep: true });
    });

    it("removes empty parent objects after pruning", () => {
      const { changed, result } = jsonFormat.prune(
        { nested: { a: 1 } },
        { nested: { a: {} } }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({});
    });

    it("handles deeply nested pruning", () => {
      const { changed, result } = jsonFormat.prune(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { d: {} } } } }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({});
    });

    it("does not mutate original object", () => {
      const original = { a: 1, b: 2 };
      jsonFormat.prune(original, { a: {} });
      expect(original).toEqual({ a: 1, b: 2 });
    });
  });
});

describe("modifyAtPath", () => {
  it("sets a value at a path", () => {
    const content = `{
  "existing": "value"
}`;
    const result = modifyAtPath(content, ["newKey"], "newValue");
    expect(jsonFormat.parse(result)).toEqual({
      existing: "value",
      newKey: "newValue"
    });
  });

  it("sets a nested value", () => {
    const content = `{
  "servers": {}
}`;
    const result = modifyAtPath(content, ["servers", "my-server"], {
      command: "npx",
      args: ["test"]
    });
    expect(jsonFormat.parse(result)).toEqual({
      servers: {
        "my-server": {
          command: "npx",
          args: ["test"]
        }
      }
    });
  });

  it("preserves comments in JSON", () => {
    const content = `{
  // This is a comment that should be preserved
  "existing": "value"
}`;
    const result = modifyAtPath(content, ["newKey"], "newValue");
    expect(result).toContain("// This is a comment");
  });

  it("preserves indentation style", () => {
    const content = `{
    "existing": "value"
}`;
    const result = modifyAtPath(content, ["newKey"], "newValue");
    expect(result).toContain('    "existing"');
  });

  it("removes a value when set to undefined", () => {
    const content = `{
  "keep": "value",
  "remove": "this"
}`;
    const result = modifyAtPath(content, ["remove"], undefined);
    expect(jsonFormat.parse(result)).toEqual({ keep: "value" });
  });

  it("ends with newline", () => {
    const content = `{"key": "value"}`;
    const result = modifyAtPath(content, ["newKey"], "newValue");
    expect(result.endsWith("\n")).toBe(true);
  });
});

describe("mergePreservingComments", () => {
  it("merges patch into content", () => {
    const content = `{
  "existing": "value"
}`;
    const result = mergePreservingComments(content, { newKey: "newValue" });
    expect(jsonFormat.parse(result)).toEqual({
      existing: "value",
      newKey: "newValue"
    });
  });

  it("preserves comments when merging", () => {
    const content = `{
  // Important comment
  "existing": "value"
}`;
    const result = mergePreservingComments(content, { newKey: "newValue" });
    expect(result).toContain("// Important comment");
  });

  it("handles empty content", () => {
    const result = mergePreservingComments("", { key: "value" });
    expect(jsonFormat.parse(result)).toEqual({ key: "value" });
  });

  it("ignores undefined values in patch", () => {
    const content = `{
  "existing": "value"
}`;
    const result = mergePreservingComments(content, {
      newKey: "newValue",
      ignored: undefined as unknown as string
    });
    expect(jsonFormat.parse(result)).toEqual({
      existing: "value",
      newKey: "newValue"
    });
  });
});

describe("removeAtPath", () => {
  it("removes a key at path", () => {
    const content = `{
  "keep": "value",
  "remove": "this"
}`;
    const result = removeAtPath(content, ["remove"]);
    expect(jsonFormat.parse(result)).toEqual({ keep: "value" });
  });

  it("removes a nested key", () => {
    const content = `{
  "servers": {
    "server1": {},
    "server2": {}
  }
}`;
    const result = removeAtPath(content, ["servers", "server1"]);
    expect(jsonFormat.parse(result)).toEqual({
      servers: { server2: {} }
    });
  });

  it("preserves comments when removing", () => {
    const content = `{
  // Keep this comment
  "keep": "value",
  "remove": "this"
}`;
    const result = removeAtPath(content, ["remove"]);
    expect(result).toContain("// Keep this comment");
  });
});
