import { describe, expect, it } from "vitest";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { createSandboxBox } from "./boxed.js";

describe("Symbol resource accounting", () => {
  it("counts a boxed symbol description once across boxes and primitive aliases", () => {
    const key = Symbol("x".repeat(100));
    const box = createSandboxBox(key);
    expect(measureSandboxData([box])).toBe(102);
    expect(measureSandboxData([box, key])).toBe(102);
    expect(measureSandboxData([box, createSandboxBox(key), key])).toBe(103);
  });
  it("charges for symbol identity and retained descriptions only once per identity", () => {
    const key = Symbol("retained");
    expect(measureSandboxData([key])).toBe(9);
    expect(measureSandboxData([key, key])).toBe(9);
    expect(measureSandboxData([key, Symbol("retained")])).toBe(18);
    expect(measureSandboxData([Symbol()])).toBe(1);
  });

  it.each(["object", "array"])("counts non-enumerable symbol-keyed %s values", kind => {
    const target = kind === "array" ? [] : {};
    const baseline = measureSandboxData([target]);
    const key = Symbol("key");
    Object.defineProperty(target, key, { value: "payload" });
    expect(measureSandboxData([target]) - baseline).toBe(12);
  });

  it("measures accessor keys without invoking their getters", () => {
    let reads = 0;
    const target = {};
    Object.defineProperty(target, Symbol("key"), { get() { reads++; throw new Error("must not execute"); } });
    expect(measureSandboxData([target])).toBe(6);
    expect(reads).toBe(0);
  });

  it("traverses symbol-keyed cycles without double-counting the retained graph", () => {
    const key = Symbol("key");
    const target = {};
    Object.defineProperty(target, key, { value: target });
    expect(measureSandboxData([target, key])).toBe(6);
  });

  it("captures symbol descriptors before retained-value callbacks mutate siblings", () => {
    const first = Symbol("a");
    const second = Symbol("b");
    const target = {
      [first]: createSandboxClosure({ call: () => undefined, retainedValues: () => {
        target[second] = "changed-value";
        return [];
      } }),
      [second]: "initial"
    };
    expect(measureSandboxData([target])).toBe(15);
    expect(target[second]).toBe("changed-value");
  });
});
