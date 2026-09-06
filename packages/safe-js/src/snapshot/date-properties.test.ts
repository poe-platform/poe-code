import { describe, expect, it } from "vitest";
import { createSandboxDate } from "../interp/date.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { run } from "../core.js";
import { restore as restoreDump } from "../restore.js";
import { hashSource } from "../parse/hash.js";
import { EXECUTION_SEMANTICS } from "./dump-format.js";

describe("Date property replay", () => {
  it.each([
    { extensible: "false" },
    { properties: [] },
    { properties: { label: { value: 7, enumerable: true, configurable: true, writable: "yes" } } },
    { unexpected: true }
  ])("rejects malformed Date metadata %j", fields => {
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ kind: "date", time: 7, ...fields }] })).toThrow();
    const source = "await 0;";
    expect(() => restoreDump({ version: 1, sourceHash: hashSource(source), executionSemantics: EXECUTION_SEMANTICS,
      bindings: { date: { kind: "ref", id: 1 } }, heap: { "1": { kind: "date", time: 7, ...fields } }
    }, { source })).toThrow();
  });
  it("preserves descriptors created by guest Object.defineProperty", async () => {
    const result = await run("const date=new Date(7);Object.defineProperty(date,'label',{value:9});return date;");
    if (!result.ok) throw new Error("Expected guest Date");
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(result.returnValue))));
    expect(Object.getOwnPropertyDescriptor(restored, "label")).toEqual({ value: 9, enumerable: false, configurable: false, writable: false });
  });
  it("preserves data descriptors, symbol cycles, time and extensibility", () => {
    const date = createSandboxDate(7);
    const key = Symbol("self");
    Object.defineProperty(date, "label", { value: { text: "epoch" } });
    Object.defineProperty(date, key, { value: date, enumerable: true });
    Object.preventExtensions(date);
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([date, key]))));
    if (!Array.isArray(restored) || typeof restored[1] !== "symbol") throw new Error("Expected Date and symbol");
    const value = restored[0];
    expect(Date.prototype.getTime.call(value)).toBe(7);
    expect(Object.getOwnPropertyDescriptor(value, "label")).toEqual({ value: { text: "epoch" }, enumerable: false, writable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(value, restored[1])?.value).toBe(value);
    expect(Object.isExtensible(value)).toBe(false);
  });
});
