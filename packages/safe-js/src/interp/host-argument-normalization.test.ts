import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { digestHostCallArguments } from "./host-call.js";

describe("host argument array normalization", () => {
  it("retains established dense, sparse and undefined digest representations", () => {
    const sparse = new Array<unknown>(5);
    sparse[1] = undefined;
    sparse[2] = null;
    sparse[4] = [Infinity, NaN, -Infinity];
    const encoded =
      '[[null,{"$type":"undefined"},null,null,[{"$type":"number","value":"Infinity"},{"$type":"number","value":"NaN"},{"$type":"number","value":"-Infinity"}]]]';
    expect(digestHostCallArguments([sparse])).toBe(
      createHash("sha256").update(encoded).digest("hex")
    );
    expect(digestHostCallArguments([[1, 2]])).toBe(
      createHash("sha256").update("[[1,2]]").digest("hex")
    );
    expect(digestHostCallArguments([[undefined]])).not.toBe(
      digestHostCallArguments([new Array(1)])
    );
    expect(Object.keys(sparse)).toStrictEqual(["1", "2", "4"]);
    expect(sparse.length).toBe(5);
  });

  it("ignores callable map data without invocation or input mutation", () => {
    const map = vi.fn(() => {
      throw new Error("Input map must not execute");
    });
    const values = Object.assign([1], { map, metadata: 7 });
    const before = Object.getOwnPropertyDescriptors(values);
    expect(digestHostCallArguments([values])).toBe(digestHostCallArguments([[1]]));
    expect(Object.getOwnPropertyDescriptors(values)).toStrictEqual(before);
    expect(map).not.toHaveBeenCalled();
  });

  it.each(["map", "metadata"])("does not evaluate an ignored named %s accessor", (key) => {
    const getter = vi.fn(() => {
      throw new Error("Named getter must not execute");
    });
    const values = [1];
    Object.defineProperty(values, key, { enumerable: true, get: getter });
    expect(digestHostCallArguments([values])).toBe(digestHostCallArguments([[1]]));
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects an indexed accessor without evaluation", () => {
    const getter = vi.fn(() => 7);
    const values: unknown[] = [];
    Object.defineProperty(values, "0", { enumerable: true, get: getter });
    expect(() => digestHostCallArguments([values])).toThrow("accessor");
    expect(getter).not.toHaveBeenCalled();
  });

  it("retains hidden numeric data and ignores hidden named data", () => {
    const values: unknown[] = [];
    Object.defineProperty(values, "2", { value: undefined, enumerable: false });
    Object.defineProperty(values, "metadata", { value: 7, enumerable: false });
    const expected = new Array<unknown>(3);
    expected[2] = undefined;
    expect(digestHostCallArguments([values])).toBe(digestHostCallArguments([expected]));
    expect(Object.keys(values)).toStrictEqual([]);
  });

  it("handles repeated aliases while retaining the indexed-cycle rejection", () => {
    const shared = Object.assign([1], { map: 0 });
    expect(digestHostCallArguments([shared, shared])).toBe(digestHostCallArguments([[1], [1]]));
    expect(shared.map).toBe(0);
    const cyclic: unknown[] = [];
    cyclic[0] = cyclic;
    expect(() => digestHostCallArguments([cyclic])).toThrow("cannot contain cycles");
  });

  it("retains the established named-cycle exclusion without changing digest identity", () => {
    const values = Object.assign([1], { raw: {} });
    values.raw = values;
    expect(digestHostCallArguments([values])).toBe(digestHostCallArguments([[1]]));
    expect(values.raw).toBe(values);
  });
});
