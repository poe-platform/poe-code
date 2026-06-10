import { describe, expect, it } from "vitest";
import { deepMergeJson, pruneJsonByShape, type JsonObject } from "./json.js";

describe("json utilities", () => {
  it("preserves __proto__ as an own field when deep merging", () => {
    const source = JSON.parse('{"__proto__":{"visible":true}}') as JsonObject;
    const result = deepMergeJson({}, source);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toEqual({ visible: true });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("does not prune absent inherited prototype fields", () => {
    const shape = JSON.parse('{"__proto__":null}') as JsonObject;
    const { changed, result } = pruneJsonByShape({}, shape);

    expect(changed).toBe(false);
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("prunes own __proto__ fields without mutating the result prototype", () => {
    const target = JSON.parse('{"__proto__":"visible","keep":true}') as JsonObject;
    const shape = JSON.parse('{"__proto__":null}') as JsonObject;
    const { changed, result } = pruneJsonByShape(target, shape);

    expect(changed).toBe(true);
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result).toEqual({ keep: true });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
