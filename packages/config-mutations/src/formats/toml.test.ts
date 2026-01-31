import { describe, it, expect } from "vitest";
import { tomlFormat } from "./toml.js";

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
