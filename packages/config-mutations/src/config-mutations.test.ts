import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "./types.js";
import {
  getConfigFormat,
  detectFormat,
  jsonFormat,
  tomlFormat,
  yamlFormat
} from "./formats/index.js";
import {
  detectIndent,
  modifyAtPath,
  mergePreservingComments,
  removeAtPath
} from "./formats/json.js";
import { runMutations } from "./execution/run-mutations.js";
import { configMutation } from "./mutations/config-mutation.js";
import { fileMutation } from "./mutations/file-mutation.js";
import { templateMutation } from "./mutations/template-mutation.js";
import { createMockFs } from "./testing/mock-fs.js";
import {
  parseToml,
  serializeToml,
  parseJson,
  serializeJson,
  parseYaml,
  serializeYaml
} from "./testing/format-utils.js";
import { isConfigObject } from "./types.js";

// Helper for removeDirectory tests that need low-level Vol access
function createVolFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

// --- formats/index.test.ts ---

describe("getConfigFormat", () => {
  describe("by file path", () => {
    it("detects JSON from .json extension", () => {
      const format = getConfigFormat("~/.config/settings.json");
      expect(format).toBe(jsonFormat);
    });

    it("detects TOML from .toml extension", () => {
      const format = getConfigFormat("~/.cargo/config.toml");
      expect(format).toBe(tomlFormat);
    });

    it("is case-insensitive for extensions", () => {
      expect(getConfigFormat("file.JSON")).toBe(jsonFormat);
      expect(getConfigFormat("file.TOML")).toBe(tomlFormat);
      expect(getConfigFormat("file.YAML")).toBe(yamlFormat);
    });

    it("throws for unsupported extension", () => {
      expect(() => getConfigFormat("~/.bashrc")).toThrow("Unsupported config format");
    });

    it("throws for files without extension", () => {
      expect(() => getConfigFormat("~/configfile")).toThrow("Unsupported config format");
    });
  });

  describe("by format name", () => {
    it("returns JSON format for 'json'", () => {
      const format = getConfigFormat("json");
      expect(format).toBe(jsonFormat);
    });

    it("returns TOML format for 'toml'", () => {
      const format = getConfigFormat("toml");
      expect(format).toBe(tomlFormat);
    });

    it("returns YAML format for 'yaml'", () => {
      const format = getConfigFormat("yaml");
      expect(format).toBe(yamlFormat);
    });

    it("rejects inherited registry property names", () => {
      expect(() => getConfigFormat("constructor")).toThrow("Unsupported config format");
    });
  });
});

describe("detectFormat", () => {
  it("detects JSON from .json extension", () => {
    expect(detectFormat("file.json")).toBe("json");
  });

  it("detects TOML from .toml extension", () => {
    expect(detectFormat("file.toml")).toBe("toml");
  });

  it("detects YAML from .yaml and .yml extensions", () => {
    expect(detectFormat("file.yaml")).toBe("yaml");
    expect(detectFormat("file.yml")).toBe("yaml");
  });

  it("returns undefined for unknown extensions", () => {
    expect(detectFormat("file")).toBeUndefined();
  });
});

describe.each([
  ["json", jsonFormat],
  ["toml", tomlFormat],
  ["yaml", yamlFormat]
])("%s format safety", (_name, format) => {
  it("preserves proto-named merged entries as data", () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as any;
    const result = format.merge({}, patch);

    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
    expect((result as any).polluted).toBeUndefined();
  });

  it("does not deep merge with inherited base entries", () => {
    Object.defineProperty(Object.prototype, "inheritedMergeTarget", {
      value: { polluted: true },
      configurable: true
    });
    try {
      expect(format.merge({}, { inheritedMergeTarget: { safe: true } })).toEqual({
        inheritedMergeTarget: { safe: true }
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).inheritedMergeTarget;
    }
  });

  it("ignores inherited and incompatible nested prune targets", () => {
    expect(format.prune({ keep: true }, { constructor: {} } as any)).toEqual({
      changed: false,
      result: { keep: true }
    });
    expect(format.prune({ nested: "keep" }, { nested: { child: {} } })).toEqual({
      changed: false,
      result: { nested: "keep" }
    });
  });
});

// --- formats/json.test.ts ---

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

    it("preserves proto-named keys as data", () => {
      const patch = JSON.parse('{"__proto__":{"polluted":true}}') as any;
      const result = jsonFormat.merge({}, patch);

      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
      expect((result as any).polluted).toBeUndefined();
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

    it("does not match inherited constructor properties", () => {
      const { changed, result } = jsonFormat.prune({ keep: true }, { constructor: {} } as any);
      expect(changed).toBe(false);
      expect(result).toEqual({ keep: true });
    });

    it("does not delete a primitive parent for a nested shape", () => {
      const { changed, result } = jsonFormat.prune({ nested: "keep" }, { nested: { child: {} } });
      expect(changed).toBe(false);
      expect(result).toEqual({ nested: "keep" });
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

// --- formats/toml.test.ts ---

describe("tomlFormat", () => {
  describe("parse", () => {
    it("parses valid TOML", () => {
      const result = tomlFormat.parse('key = "value"');
      expect(result).toEqual({ key: "value" });
    });

    it("returns empty object for empty string", () => {
      expect(tomlFormat.parse("")).toEqual({});
    });

    it("returns empty object for whitespace-only string", () => {
      expect(tomlFormat.parse("   ")).toEqual({});
    });

    it("parses TOML tables", () => {
      const result = tomlFormat.parse('[section]\nkey = "value"');
      expect(result).toEqual({ section: { key: "value" } });
    });

    it("throws for invalid TOML", () => {
      expect(() => tomlFormat.parse("not = = valid")).toThrow();
    });
  });

  describe("serialize", () => {
    it("serializes simple key-value pairs", () => {
      const result = tomlFormat.serialize({ key: "value" });
      expect(result).toContain('key = "value"');
    });

    it("ends with newline", () => {
      const result = tomlFormat.serialize({ key: "value" });
      expect(result.endsWith("\n")).toBe(true);
    });

    it("serializes nested tables", () => {
      const result = tomlFormat.serialize({ section: { key: "value" } });
      expect(result).toContain("[section]");
      expect(result).toContain('key = "value"');
    });
  });

  describe("merge", () => {
    it("merges simple objects", () => {
      const result = tomlFormat.merge({ a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("overwrites primitive values", () => {
      const result = tomlFormat.merge({ a: 1 }, { a: 2 });
      expect(result).toEqual({ a: 2 });
    });

    it("deep merges nested tables", () => {
      const result = tomlFormat.merge(
        { section: { a: 1, b: 2 } },
        { section: { b: 3, c: 4 } }
      );
      expect(result).toEqual({ section: { a: 1, b: 3, c: 4 } });
    });

    it("replaces arrays (no array merge)", () => {
      const result = tomlFormat.merge({ arr: [1, 2] }, { arr: [3, 4, 5] });
      expect(result).toEqual({ arr: [3, 4, 5] });
    });
  });

  describe("prune", () => {
    it("removes keys matching shape", () => {
      const { changed, result } = tomlFormat.prune(
        { a: 1, b: 2, c: 3 },
        { a: {}, c: {} }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({ b: 2 });
    });

    it("returns unchanged: false when nothing matches", () => {
      const { changed, result } = tomlFormat.prune({ a: 1 }, { b: {} });
      expect(changed).toBe(false);
      expect(result).toEqual({ a: 1 });
    });

    it("recursively prunes nested tables", () => {
      const { changed, result } = tomlFormat.prune(
        { section: { a: 1, b: 2 }, keep: true },
        { section: { a: {} } }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({ section: { b: 2 }, keep: true });
    });

    it("removes empty parent tables after pruning", () => {
      const { changed, result } = tomlFormat.prune(
        { section: { a: 1 } },
        { section: { a: {} } }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({});
    });
  });
});

describe("yamlFormat", () => {
  describe("parse", () => {
    it("parses valid YAML", () => {
      expect(yamlFormat.parse("key: value\n")).toEqual({ key: "value" });
    });

    it("returns empty object for empty string", () => {
      expect(yamlFormat.parse("")).toEqual({});
    });

    it("throws for YAML arrays", () => {
      expect(() => yamlFormat.parse("- one\n- two\n")).toThrow("Expected YAML object");
    });
  });

  describe("serialize", () => {
    it("serializes YAML with trailing newline", () => {
      expect(yamlFormat.serialize({ key: "value" })).toBe("key: value\n");
    });
  });

  describe("merge", () => {
    it("deep merges nested objects", () => {
      expect(
        yamlFormat.merge(
          { nested: { a: 1, b: 2 } },
          { nested: { b: 3, c: 4 } }
        )
      ).toEqual({ nested: { a: 1, b: 3, c: 4 } });
    });
  });

  describe("prune", () => {
    it("removes keys matching shape", () => {
      const { changed, result } = yamlFormat.prune(
        { keep: true, remove: true },
        { remove: {} }
      );
      expect(changed).toBe(true);
      expect(result).toEqual({ keep: true });
    });
  });
});

// --- execution/remove-directory.test.ts ---

describe("fileMutation.removeDirectory", () => {
  const homeDir = "/home/test";
  let fs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs, vol } = createVolFs());
    vol.mkdirSync(homeDir, { recursive: true });
  });

  it("returns changed false for non-empty dir when force is not set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills" })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(false);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain("a.txt");
  });

  it("removes directory and contents when force is set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills", force: true })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("removes empty directory when force is not set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills" })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });
});

// --- execution/run-mutations.test.ts ---

describe("runMutations", () => {
  const homeDir = "/home/test";

  describe("configMutation.merge", () => {
    it("creates new JSON file", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [configMutation.merge({ target: "~/.config/settings.json", value: { key: "value" } })],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config/settings.json`]).toMatchInlineSnapshot(`
        "{
          "key": "value"
        }
        "
      `);
    });

    it("merges into existing JSON file", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"existing": true}'
      }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { new: "value" } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ existing: true, new: "value" });
    });

    it("rejects primitive merge values", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations(
          [
            {
              kind: "configMerge",
              target: "~/.config.json",
              value: "oops"
            } as any
          ],
          { fs, homeDir }
        )
      ).rejects.toThrow("configMerge value must be an object");
      expect(fs.getContent("~/.config.json")).toBeUndefined();
    });

    it("preserves JSONC comments when merging into an existing JSON file", async () => {
      const fs = createMockFs({
        "~/.config.json": [
          "{",
          "  // Keep this user note",
          '  "existing": true',
          "}"
        ].join("\n")
      }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { new: "value" } })],
        { fs, homeDir }
      );

      const content = fs.files[`${homeDir}/.config.json`];
      expect(content).toContain("// Keep this user note");
      expect(jsonFormat.parse(content)).toEqual({ existing: true, new: "value" });
    });

    it("deep merges nested objects", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"nested": {"a": 1}}'
      }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { nested: { b: 2 } } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ nested: { a: 1, b: 2 } });
    });

    it("preserves proto-named merge entries as data when pruning by prefix", async () => {
      const fs = createMockFs({}, homeDir);
      const patch = JSON.parse('{"__proto__":{"polluted":true}}') as any;

      await runMutations(
        [
          configMutation.merge({
            target: "~/.config.json",
            value: patch,
            pruneByPrefix: { __proto__: "old-" }
          })
        ],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(Object.prototype.hasOwnProperty.call(content, "__proto__")).toBe(true);
      expect(content.polluted).toBeUndefined();
    });

    it("preserves nested proto-named merge entries as data when pruning is enabled", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"nested": {"keep": true}}'
      }, homeDir);
      const patch = JSON.parse('{"nested":{"__proto__":{"polluted":true}}}') as any;

      await runMutations(
        [
          configMutation.merge({
            target: "~/.config.json",
            value: patch,
            pruneByPrefix: { unrelated: "old-" }
          })
        ],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content.nested.keep).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(content.nested, "__proto__")).toBe(true);
      expect(content.nested.polluted).toBeUndefined();
    });

    it("creates new TOML file", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [configMutation.merge({ target: "~/.config/settings.toml", value: { key: "value" } })],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config/settings.toml`]).toContain('key = "value"');
    });

    it("creates new YAML file", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [
          configMutation.merge({
            target: "~/.config/settings.yaml",
            format: "yaml",
            value: { key: "value" }
          })
        ],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config/settings.yaml`]).toBe("key: value\n");
    });

    it("does not corrupt an existing document when replacement write fails", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: '{"existing":true}\n' })).promises as unknown as FileSystem;
      let tempPath: string | undefined;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            tempPath = filePath;
            await base.writeFile(filePath, "{", options);
            throw new Error("config disk full");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir })
      ).rejects.toThrow("config disk full");
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe('{"existing":true}\n');
      expect(tempPath).toBeDefined();
      await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    });

    it("cleans partial mutation temp files when write errors only inherit existing-path codes", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: '{"existing":true}\n' })).promises as unknown as FileSystem;
      let tempPath: string | undefined;
      let injected = false;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (!injected && filePath.includes(".mutation-tmp-")) {
            injected = true;
            tempPath = filePath;
            await base.writeFile(filePath, "{", options);
            throw new Error("config temp denied");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
        await expect(
          runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir })
        ).rejects.toThrow("config temp denied");
      });

      await expect(base.readFile(targetPath, "utf8")).resolves.toBe('{"existing":true}\n');
      expect(tempPath).toBeDefined();
      await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    });

    it("does not remove a colliding mutation temp symlink", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const outsidePath = "/outside.tmp";
      const volume = Volume.fromJSON({ [outsidePath]: "outside-state\n" });
      volume.mkdirSync(homeDir, { recursive: true });
      const base = createFsFromVolume(volume).promises as unknown as FileSystem;
      let tempPath: string | undefined;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (tempPath === undefined && filePath.includes(".mutation-tmp-")) {
            tempPath = filePath;
            volume.symlinkSync(outsidePath, filePath);
            expect(options).toEqual({ encoding: "utf8", flag: "wx" });
          }

          await base.writeFile(filePath, data, options);
        }
      };

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { added: true } })],
        { fs, homeDir }
      );

      expect(tempPath).toBeDefined();
      expect(volume.readFileSync(outsidePath, "utf8")).toBe("outside-state\n");
      expect(volume.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe("{\n  \"added\": true\n}\n");
    });

    it("refuses a symlinked config target", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const outsidePath = "/outside/config.json";
      const volume = Volume.fromJSON({ [outsidePath]: '{"outside":true}\n' });
      volume.mkdirSync(homeDir, { recursive: true });
      volume.symlinkSync(outsidePath, targetPath);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await expect(
        runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir })
      ).rejects.toThrow("symbolic link");
      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe('{"outside":true}\n');
    });

    it("refuses configuration writes through a symlinked parent directory", async () => {
      const outsidePath = "/outside/config.toml";
      const volume = Volume.fromJSON({ [outsidePath]: 'user_setting = "keep"\n' });
      volume.mkdirSync(homeDir, { recursive: true });
      volume.symlinkSync("/outside", `${homeDir}/.codex`);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await expect(
        runMutations([configMutation.merge({ target: "~/.codex/config.toml", value: { added: true } })], { fs, homeDir })
      ).rejects.toThrow("symbolic link");
      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe('user_setting = "keep"\n');
      await expect(fs.readdir("/outside")).resolves.toEqual(["config.toml"]);
    });

    it("allows writes when a system ancestor of the home directory is a symlink", async () => {
      // Mirrors macOS, where /tmp -> /private/tmp: ancestors above the managed
      // home are legitimate system symlinks and must not block config writes.
      const volume = new Volume();
      volume.mkdirSync("/private/scratch/home", { recursive: true });
      volume.symlinkSync("/private/scratch", "/scratch");
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { added: true } })],
        { fs, homeDir: "/scratch/home" }
      );

      const written = await fs.readFile("/private/scratch/home/.config.json", "utf8");
      expect(JSON.parse(written)).toEqual({ added: true });
    });

    it("refuses a symlinked invalid-document backup destination", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-26T12:34:56.789Z"));
      const targetPath = `${homeDir}/.config.json`;
      const backupPath = `${targetPath}.invalid-2026-05-26T12-34-56-789Z.json`;
      const outsidePath = "/outside/config.json";
      const volume = Volume.fromJSON({ [targetPath]: "{ broken", [outsidePath]: "external" });
      volume.symlinkSync(outsidePath, backupPath);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await expect(
        runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir })
      ).rejects.toThrow();
      vi.useRealTimers();
      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("external");
    });

    it("does not overwrite invalid-document backups created in the same millisecond", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-26T12:34:56.789Z"));
      const targetPath = `${homeDir}/.config.json`;
      const fs = createMockFs({ "~/.config.json": "{ first" }, homeDir);

      await runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir });
      await fs.writeFile(targetPath, "{ second", { encoding: "utf8" });
      await runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir });
      vi.useRealTimers();

      const backups = Object.keys(fs.files).filter((filePath) => filePath.includes(".invalid-"));
      expect(backups).toHaveLength(2);
      expect(backups.map((filePath) => fs.files[filePath])).toEqual(["{ first", "{ second"]);
    });

    it("cleans a partial invalid-document backup when backup creation fails", async () => {
      const fs = createMockFs({ "~/.config.json": "{ broken" }, homeDir);
      const originalWriteFile = fs.writeFile.bind(fs);
      let backupPath: string | undefined;
      fs.writeFile = async (filePath, content, options) => {
        if (filePath.includes(".invalid-")) {
          backupPath = filePath;
          await originalWriteFile(filePath, "partial backup", options);
          throw new Error("invalid backup disk full");
        }

        await originalWriteFile(filePath, content, options);
      };

      await expect(
        runMutations([configMutation.merge({ target: "~/.config.json", value: { added: true } })], { fs, homeDir })
      ).rejects.toThrow("invalid backup disk full");
      expect(backupPath).toBeDefined();
      expect(fs.getContent(backupPath ?? "")).toBeUndefined();
      expect(fs.getContent("~/.config.json")).toBe("{ broken");
    });
  });

  describe("configMutation.prune", () => {
    it("removes keys matching shape", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"keep": true, "remove": true}'
      }, homeDir);

      await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ keep: true });
    });

    it("preserves JSONC comments when pruning an existing JSON file", async () => {
      const fs = createMockFs({
        "~/.config.json": [
          "{",
          "  // Keep this user note",
          '  "keep": true,',
          '  "remove": true',
          "}"
        ].join("\n")
      }, homeDir);

      await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })],
        { fs, homeDir }
      );

      const content = fs.files[`${homeDir}/.config.json`];
      expect(content).toContain("// Keep this user note");
      expect(content).not.toContain('"remove"');
      expect(jsonFormat.parse(content)).toEqual({ keep: true });
    });

    it("deletes file when result is empty", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"remove": true}'
      }, homeDir);

      await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })],
        { fs, homeDir }
      );

      expect(fs.exists("~/.config.json")).toBe(false);
    });

    it("respects onlyIf guard", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"owner": "other", "key": "value"}'
      }, homeDir);

      await runMutations(
        [
          configMutation.prune({
            target: "~/.config.json",
            shape: { key: {} },
            onlyIf: (doc) => doc.owner === "me"
          })
        ],
        { fs, homeDir }
      );

      // Should not have changed because owner !== "me"
      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ owner: "other", key: "value" });
    });

    it("prunes when onlyIf returns true", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"owner": "me", "key": "value"}'
      }, homeDir);

      await runMutations(
        [
          configMutation.prune({
            target: "~/.config.json",
            shape: { key: {} },
            onlyIf: (doc) => doc.owner === "me"
          })
        ],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ owner: "me" });
    });

    it("does not trust inherited proto values in onlyIf", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"__proto__":{"owner":"me"},"remove":true}\n'
      }, homeDir);

      const result = await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} }, onlyIf: (doc) => (doc as any).owner === "me" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(false);
      expect(fs.exists("~/.config.json")).toBe(true);
    });

    it("does not corrupt an existing document when replacement write fails", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: '{"keep":true,"remove":true}\n' })).promises as unknown as FileSystem;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            await base.writeFile(filePath, "{", options);
            throw new Error("prune interrupted");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        runMutations([configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })], { fs, homeDir })
      ).rejects.toThrow("prune interrupted");
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe('{"keep":true,"remove":true}\n');
    });

    it("prunes YAML files", async () => {
      const fs = createMockFs({
        "~/.config.yaml": "owner: me\nkey: value\n"
      }, homeDir);

      await runMutations(
        [
          configMutation.prune({
            target: "~/.config.yaml",
            format: "yaml",
            shape: { key: {} },
            onlyIf: (doc) => doc.owner === "me"
          })
        ],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config.yaml`]).toBe("owner: me\n");
    });
  });

  describe("fileMutation.ensureDirectory", () => {
    it("does not corrupt transformed config when replacement write fails", async () => {
      const targetPath = `${homeDir}/.config.json`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: '{"keep":true}\n' })).promises as unknown as FileSystem;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            await base.writeFile(filePath, "{", options);
            throw new Error("transform interrupted");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        runMutations([configMutation.transform({ target: "~/.config.json", transform: () => ({ content: { changed: true }, changed: true }) })], { fs, homeDir })
      ).rejects.toThrow("transform interrupted");
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe('{"keep":true}\n');
    });

    it("preserves JSONC comments when transforming an existing JSON file", async () => {
      const fs = createMockFs({
        "~/.config.json": [
          "{",
          "  // Keep this user note",
          '  "key": "old"',
          "}"
        ].join("\n")
      }, homeDir);

      await runMutations(
        [
          configMutation.transform({
            target: "~/.config.json",
            transform: (content) => ({
              content: { ...content, key: "new" },
              changed: true
            })
          })
        ],
        { fs, homeDir }
      );

      const content = fs.files[`${homeDir}/.config.json`];
      expect(content).toContain("// Keep this user note");
      expect(jsonFormat.parse(content)).toEqual({ key: "new" });
    });

    it("does not rewrite when transformed content serializes unchanged", async () => {
      const fs = createMockFs({
        "~/.config.json": '{\n  "enabled": true\n}\n'
      }, homeDir);
      const writeFile = vi.spyOn(fs, "writeFile");
      const rename = vi.spyOn(fs, "rename");

      const result = await runMutations(
        [
          configMutation.transform({
            target: "~/.config.json",
            transform: (content) => ({ content, changed: true })
          })
        ],
        { fs, homeDir }
      );

      expect(result).toEqual({
        changed: false,
        effects: [{ changed: false, effect: "none", detail: "noop" }]
      });
      expect(writeFile).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
    });

    it("creates directory if not exists", async () => {
      const fs = createMockFs({}, homeDir);

      const result = await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config/app" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(true);
      expect(fs.directories.has(`${homeDir}/.config/app`)).toBe(true);
    });

    it("reports no change if directory exists", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      const result = await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(false);
    });

    it("refuses to create directories through a symlinked parent", async () => {
      const volume = Volume.fromJSON({ "/outside/.keep": "" });
      volume.mkdirSync(homeDir, { recursive: true });
      volume.symlinkSync("/outside", `${homeDir}/.codex`);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await expect(
        runMutations([fileMutation.ensureDirectory({ path: "~/.codex/plugins" })], {
          fs,
          homeDir
        })
      ).rejects.toThrow("symbolic link");
      await expect(fs.stat("/outside/plugins")).rejects.toThrow("ENOENT");
    });
  });

  describe("fileMutation.remove", () => {
    it("removes existing file", async () => {
      const fs = createMockFs({
        "~/.config.json": "{}"
      }, homeDir);

      const result = await runMutations(
        [fileMutation.remove({ target: "~/.config.json" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(true);
      expect(fs.exists("~/.config.json")).toBe(false);
    });

    it("respects whenEmpty option", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"content": true}'
      }, homeDir);

      await runMutations(
        [fileMutation.remove({ target: "~/.config.json", whenEmpty: true })],
        { fs, homeDir }
      );

      // File should still exist because it's not empty
      expect(fs.exists("~/.config.json")).toBe(true);
    });

    it("reuses global match guards without leaking regex state", async () => {
      const fs = createMockFs({
        "~/.one": "generated",
        "~/.two": "generated"
      }, homeDir);
      const generated = /generated/g;

      await runMutations(
        [
          fileMutation.remove({ target: "~/.one", whenContentMatches: generated }),
          fileMutation.remove({ target: "~/.two", whenContentMatches: generated })
        ],
        { fs, homeDir }
      );

      expect(fs.exists("~/.one")).toBe(false);
      expect(fs.exists("~/.two")).toBe(false);
    });
  });

  describe("fileMutation.backup", () => {
    it("does not overwrite backups created in the same millisecond", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));
      const fs = createMockFs({ "~/.settings.json": "first" }, homeDir);

      await runMutations([fileMutation.backup({ target: "~/.settings.json" })], { fs, homeDir });
      await fs.writeFile(`${homeDir}/.settings.json`, "second", { encoding: "utf8" });
      await runMutations([fileMutation.backup({ target: "~/.settings.json" })], { fs, homeDir });
      vi.useRealTimers();

      const backups = Object.keys(fs.files).filter((filePath) => filePath.includes(".backup-"));
      expect(backups).toHaveLength(2);
      expect(backups.map((filePath) => fs.files[filePath])).toEqual(["first", "second"]);
    });

    it("cleans a partial generated backup when backup creation fails", async () => {
      const fs = createMockFs({ "~/.settings.json": "original" }, homeDir);
      const originalWriteFile = fs.writeFile.bind(fs);
      let backupPath: string | undefined;
      fs.writeFile = async (filePath, content, options) => {
        if (filePath.includes(".backup-")) {
          backupPath = filePath;
          await originalWriteFile(filePath, "partial backup", options);
          throw new Error("generated backup disk full");
        }

        await originalWriteFile(filePath, content, options);
      };

      await expect(
        runMutations([fileMutation.backup({ target: "~/.settings.json" })], { fs, homeDir })
      ).rejects.toThrow("generated backup disk full");
      expect(backupPath).toBeDefined();
      expect(fs.getContent(backupPath ?? "")).toBeUndefined();
      expect(fs.getContent("~/.settings.json")).toBe("original");
    });

    it("refuses to back up a symlinked target", async () => {
      const outsidePath = "/outside/secret.txt";
      const targetPath = `${homeDir}/.config/secret.txt`;
      const volume = Volume.fromJSON({ [outsidePath]: "outside secret\n" });
      volume.mkdirSync(`${homeDir}/.config`, { recursive: true });
      volume.symlinkSync(outsidePath, targetPath);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

      await expect(
        runMutations([fileMutation.backup({ target: "~/.config/secret.txt" })], {
          fs,
          homeDir
        })
      ).rejects.toThrow("symbolic link");
      expect(await fs.readdir(`${homeDir}/.config`)).toEqual(["secret.txt"]);
    });

    it("restores and consumes the latest generated backup atomically", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));
      const fs = createMockFs({ "~/.settings.json": "original" }, homeDir);

      await runMutations([fileMutation.backup({ target: "~/.settings.json" })], { fs, homeDir });
      await fs.writeFile(`${homeDir}/.settings.json`, "managed", { encoding: "utf8" });
      const result = await runMutations([fileMutation.restoreBackup({ target: "~/.settings.json" })], { fs, homeDir });
      vi.useRealTimers();

      expect(result.changed).toBe(true);
      expect(fs.files[`${homeDir}/.settings.json`]).toBe("original");
      expect(Object.keys(fs.files).filter((filePath) => filePath.includes(".backup-"))).toEqual([]);
      await expect(runMutations([fileMutation.restoreBackup({ target: "~/.settings.json" })], { fs, homeDir })).resolves.toMatchObject({ changed: false });
    });

    it("ignores unrelated backup-prefix siblings during restoration", async () => {
      const fs = createMockFs({
        "~/.settings.json": "managed",
        "~/.settings.json.backup-not-generated": "poison"
      }, homeDir);

      await runMutations([fileMutation.restoreBackup({ target: "~/.settings.json" })], { fs, homeDir });

      expect(fs.files[`${homeDir}/.settings.json`]).toBe("managed");
    });

    it("keeps the first backup baseline across repeated managed writes", async () => {
      const fs = createMockFs({ "~/.settings.json": "original" }, homeDir);

      await runMutations([fileMutation.backup({ target: "~/.settings.json", once: true })], { fs, homeDir });
      await fs.writeFile(`${homeDir}/.settings.json`, "managed one", { encoding: "utf8" });
      await runMutations([fileMutation.backup({ target: "~/.settings.json", once: true })], { fs, homeDir });
      await fs.writeFile(`${homeDir}/.settings.json`, "managed two", { encoding: "utf8" });
      await runMutations([fileMutation.restoreBackup({ target: "~/.settings.json" })], { fs, homeDir });

      expect(fs.files[`${homeDir}/.settings.json`]).toBe("original");
    });

    it("restores an originally absent target by removing the generated file", async () => {
      const fs = createMockFs({}, homeDir);

      await runMutations([fileMutation.backup({ target: "~/.settings.json", once: true })], { fs, homeDir });
      await fs.writeFile(`${homeDir}/.settings.json`, "managed", { encoding: "utf8" });
      await runMutations([fileMutation.restoreBackup({ target: "~/.settings.json" })], { fs, homeDir });

      await expect(fs.readFile(`${homeDir}/.settings.json`, "utf8")).rejects.toThrow();
    });
  });

  describe("templateMutation.write", () => {
    it("writes rendered template", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [
          templateMutation.write({
            target: "~/.config/app.sh",
            templateId: "app.sh",
            context: { name: "myapp" }
          })
        ],
        {
          fs,
          homeDir,
          templates: async () => "#!/bin/bash\necho {{name}}"
        }
      );

      expect(fs.files[`${homeDir}/.config/app.sh`]).toBe("#!/bin/bash\necho myapp");
    });

    it("throws when templates loader not provided", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations(
          [templateMutation.write({ target: "~/.config/app.sh", templateId: "app.sh" })],
          { fs, homeDir }
        )
      ).rejects.toThrow("Template mutations require a templates loader");
    });

    it("does not rewrite identical rendered output", async () => {
      const fs = createMockFs({ "~/.config/app.sh": "same" }, homeDir);
      const writeFile = vi.spyOn(fs, "writeFile");

      const result = await runMutations(
        [templateMutation.write({ target: "~/.config/app.sh", templateId: "app.sh" })],
        { fs, homeDir, templates: async () => "same" }
      );

      expect(result.changed).toBe(false);
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("does not corrupt existing output when replacement write fails", async () => {
      const targetPath = `${homeDir}/app.sh`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: "existing" })).promises as unknown as FileSystem;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            await base.writeFile(filePath, "partial", options);
            throw new Error("template write interrupted");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        runMutations([templateMutation.write({ target: "~/app.sh", templateId: "app.sh" })], { fs, homeDir, templates: async () => "changed" })
      ).rejects.toThrow("template write interrupted");
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe("existing");
    });

    it("does not corrupt template-merged output when replacement write fails", async () => {
      const targetPath = `${homeDir}/settings.json`;
      const base = createFsFromVolume(Volume.fromJSON({ [targetPath]: '{"keep":true}\n' })).promises as unknown as FileSystem;
      const fs: FileSystem = {
        ...base,
        async writeFile(filePath, data, options) {
          if (filePath.includes(".mutation-tmp-")) {
            await base.writeFile(filePath, "{", options);
            throw new Error("template merge interrupted");
          }
          await base.writeFile(filePath, data, options);
        }
      };

      await expect(
        runMutations([templateMutation.mergeJson({ target: "~/settings.json", templateId: "patch" })], { fs, homeDir, templates: async () => '{"added":true}\n' })
      ).rejects.toThrow("template merge interrupted");
      await expect(base.readFile(targetPath, "utf8")).resolves.toBe('{"keep":true}\n');
    });
  });

  describe("observers", () => {
    it("calls onStart for each mutation", async () => {
      const fs = createMockFs({}, homeDir);
      const onStart = vi.fn();

      await runMutations(
        [
          fileMutation.ensureDirectory({ path: "~/.config" }),
          fileMutation.ensureDirectory({ path: "~/.local" })
        ],
        { fs, homeDir, observers: { onStart } }
      );

      expect(onStart).toHaveBeenCalledTimes(2);
    });

    it("includes resolved target details on start", async () => {
      const fs = createMockFs({}, homeDir);
      const onStart = vi.fn();

      await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config" })],
        { fs, homeDir, observers: { onStart } }
      );

      expect(onStart).toHaveBeenCalledWith({
        kind: "ensureDirectory",
        label: `Create ${homeDir}/.config`,
        targetPath: `${homeDir}/.config`
      });
    });

    it("calls onComplete with outcome", async () => {
      const fs = createMockFs({}, homeDir);
      const onComplete = vi.fn();

      await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config" })],
        { fs, homeDir, observers: { onComplete } }
      );

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "ensureDirectory" }),
        expect.objectContaining({ changed: true, effect: "mkdir" })
      );
    });

    it("calls onError when mutation fails", async () => {
      const fs = createMockFs({}, homeDir);
      const onError = vi.fn();

      await expect(
        runMutations(
          [configMutation.merge({ target: "/absolute/path.json", value: {} })],
          { fs, homeDir, observers: { onError } }
        )
      ).rejects.toThrow("home-relative");

      expect(onError).toHaveBeenCalledWith(
        {
          kind: "configMerge",
          label: "Update /absolute/path.json",
          targetPath: undefined
        },
        expect.any(Error)
      );
    });
  });

  describe("dryRun mode", () => {
    it("does not write files in dryRun mode", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"old": true}'
      }, homeDir);

      const result = await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { new: true } })],
        { fs, homeDir, dryRun: true }
      );

      expect(result.changed).toBe(true);
      // But file should not have been modified
      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ old: true });
    });

    it("does not back up invalid documents during merge previews", async () => {
      const fs = createMockFs({ "~/.config.json": "{ broken" }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { repaired: true } })],
        { fs, homeDir, dryRun: true }
      );

      expect(Object.keys(fs.files)).toEqual([`${homeDir}/.config.json`]);
    });

    it("does not back up invalid documents during transform previews", async () => {
      const fs = createMockFs({ "~/.config.json": "{ broken" }, homeDir);

      await runMutations(
        [configMutation.transform({ target: "~/.config.json", transform: () => ({ content: {}, changed: true }) })],
        { fs, homeDir, dryRun: true }
      );

      expect(Object.keys(fs.files)).toEqual([`${homeDir}/.config.json`]);
    });

    it("does not back up invalid documents during template merge previews", async () => {
      const fs = createMockFs({ "~/.config.json": "{ broken" }, homeDir);

      await runMutations(
        [templateMutation.mergeJson({ target: "~/.config.json", templateId: "patch" })],
        { fs, homeDir, dryRun: true, templates: async () => '{"fixed":true}' }
      );

      expect(Object.keys(fs.files)).toEqual([`${homeDir}/.config.json`]);
    });
  });

  describe("path validation", () => {
    it("throws for non-home-relative paths", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations(
          [configMutation.merge({ target: "/etc/config.json", value: {} })],
          { fs, homeDir }
        )
      ).rejects.toThrow("home-relative");
    });

    it("throws for home-relative traversal outside home", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations([fileMutation.ensureDirectory({ path: "~/../../outside" })], { fs, homeDir })
      ).rejects.toThrow("outside home");
    });
  });
});

// --- testing/format-utils.test.ts ---

describe("format utils", () => {
  it("parses TOML into a config object", () => {
    expect(parseToml('key = "value"')).toEqual({ key: "value" });
  });

  it("serializes TOML with trailing newline", () => {
    const output = serializeToml({ key: "value" });
    expect(output).toContain('key = "value"');
    expect(output.endsWith("\n")).toBe(true);
  });

  it("parses JSON into a config object", () => {
    expect(parseJson('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("serializes JSON with 2-space indentation", () => {
    expect(serializeJson({ key: "value" })).toBe('{\n  "key": "value"\n}\n');
  });

  it("parses YAML into a config object", () => {
    expect(parseYaml("key: value\n")).toEqual({ key: "value" });
  });

  it("serializes YAML with trailing newline", () => {
    expect(serializeYaml({ key: "value" })).toBe("key: value\n");
  });
});

// --- testing/mock-fs.test.ts ---

describe("createMockFs", () => {
  describe("initialization", () => {
    it("creates empty filesystem", () => {
      const fs = createMockFs();
      expect(fs.files).toEqual({});
    });

    it("initializes with provided files", () => {
      const fs = createMockFs({
        "~/.config.json": '{"key": "value"}'
      });
      expect(fs.files["/home/test/.config.json"]).toBe('{"key": "value"}');
    });

    it("expands ~ paths in initial files", () => {
      const fs = createMockFs({
        "~/.config/app/settings.json": "{}"
      });
      expect(fs.exists("~/.config/app/settings.json")).toBe(true);
    });

    it("creates parent directories for initial files", () => {
      const fs = createMockFs({
        "~/.config/app/deep/settings.json": "{}"
      });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app/deep")).toBe(true);
    });

    it("uses custom homeDir", () => {
      const fs = createMockFs({ "~/.config": "{}" }, "/custom/home");
      expect(fs.files["/custom/home/.config"]).toBe("{}");
    });
  });

  describe("exists", () => {
    it("returns true for existing file", () => {
      const fs = createMockFs({ "~/.config": "{}" });
      expect(fs.exists("~/.config")).toBe(true);
    });

    it("returns false for non-existing file", () => {
      const fs = createMockFs();
      expect(fs.exists("~/.config")).toBe(false);
    });

    it("returns true for existing directory", () => {
      const fs = createMockFs();
      expect(fs.exists("/home/test")).toBe(true);
    });
  });

  describe("getContent", () => {
    it("returns file content", () => {
      const fs = createMockFs({ "~/.config": '{"key": "value"}' });
      expect(fs.getContent("~/.config")).toBe('{"key": "value"}');
    });

    it("returns undefined for non-existing file", () => {
      const fs = createMockFs();
      expect(fs.getContent("~/.config")).toBeUndefined();
    });
  });

  describe("readFile", () => {
    it("reads existing file", async () => {
      const fs = createMockFs({ "~/.config": "content" });
      const content = await fs.readFile("/home/test/.config", "utf8");
      expect(content).toBe("content");
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.readFile("/home/test/.missing", "utf8")).rejects.toThrow("ENOENT");
    });
  });

  describe("writeFile", () => {
    it("writes to existing directory", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config", { recursive: true });
      await fs.writeFile("/home/test/.config/settings.json", "{}");
      expect(fs.files["/home/test/.config/settings.json"]).toBe("{}");
    });

    it("throws ENOENT when parent directory missing", async () => {
      const fs = createMockFs();
      await expect(
        fs.writeFile("/home/test/.missing/file", "content")
      ).rejects.toThrow("ENOENT");
    });

    it("overwrites existing file", async () => {
      const fs = createMockFs({ "~/.config": "old" });
      await fs.writeFile("/home/test/.config", "new");
      expect(fs.files["/home/test/.config"]).toBe("new");
    });
  });

  describe("mkdir", () => {
    it("creates directory", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config", { recursive: true });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
    });

    it("creates nested directories with recursive option", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config/app/deep", { recursive: true });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app/deep")).toBe(true);
    });

    it("throws ENOENT without recursive when parent missing", async () => {
      const fs = createMockFs();
      await expect(
        fs.mkdir("/home/test/.missing/dir")
      ).rejects.toThrow("ENOENT");
    });
  });

  describe("unlink", () => {
    it("deletes existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      await fs.unlink("/home/test/.config");
      expect(fs.exists("~/.config")).toBe(false);
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.unlink("/home/test/.missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("stat", () => {
    it("returns mode for existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      const stat = await fs.stat("/home/test/.config");
      expect(stat.mode).toBe(0o644);
    });

    it("returns mode for existing directory", async () => {
      const fs = createMockFs();
      const stat = await fs.stat("/home/test");
      expect(stat.mode).toBe(0o755);
    });

    it("throws ENOENT for missing path", async () => {
      const fs = createMockFs();
      await expect(fs.stat("/home/test/.missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("chmod", () => {
    it("does not throw for existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      await expect(fs.chmod("/home/test/.config", 0o755)).resolves.not.toThrow();
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.chmod("/home/test/.missing", 0o755)).rejects.toThrow("ENOENT");
    });

    it("refuses to chmod through a symlinked target", async () => {
      const homeDir = "/home/test";
      const outsidePath = "/outside/secret.txt";
      const targetPath = `${homeDir}/.config/secret.txt`;
      const volume = Volume.fromJSON({ [outsidePath]: "secret\n" });
      volume.mkdirSync(`${homeDir}/.config`, { recursive: true });
      volume.symlinkSync(outsidePath, targetPath);
      const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
      const originalMode = (await fs.stat(outsidePath)).mode;

      await expect(
        runMutations([fileMutation.chmod({ target: "~/.config/secret.txt", mode: 0o600 })], {
          fs,
          homeDir
        })
      ).rejects.toThrow("symbolic link");
      expect((await fs.stat(outsidePath)).mode).toBe(originalMode);
    });
  });
});

// --- types.test.ts ---

describe("isConfigObject", () => {
  it("returns true for plain objects", () => {
    expect(isConfigObject({ key: "value" })).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isConfigObject(["value"])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isConfigObject(null)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isConfigObject("value")).toBe(false);
    expect(isConfigObject(42)).toBe(false);
    expect(isConfigObject(true)).toBe(false);
  });
});
