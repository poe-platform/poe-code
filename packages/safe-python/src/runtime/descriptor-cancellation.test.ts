import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { readInstanceAttribute, writeInstanceAttribute, deleteInstanceAttribute } from "./instance-attributes.js";
import { readClassAttribute, lookupMroAttribute } from "./class-attributes.js";

describe("descriptor callback cancellation", () => {
  it.each(["data-get", "nondata-get", "storage-get", "set", "delete", "storage-set", "storage-delete", "class-get", "class-storage", "mro"])("checks cancellation after %s returns", operation => {
    const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 10000, signal: controller.signal });
    const cancel = () => { controller.abort(); return "value"; }, instance = {}, owner = {};
    const run = () => {
      switch (operation) {
        case "data-get": return readInstanceAttribute(instance, owner, { value: "d", slots: { get: cancel, set() {} } }, () => undefined, meter);
        case "nondata-get": return readInstanceAttribute(instance, owner, { value: "d", slots: { get: cancel } }, () => undefined, meter);
        case "storage-get": return readInstanceAttribute(instance, owner, undefined, () => ({ value: cancel() }), meter);
        case "set": return writeInstanceAttribute(instance, { value: "d", slots: { set: cancel } }, "v", () => {}, meter);
        case "delete": return deleteInstanceAttribute(instance, { value: "d", slots: { delete: cancel } }, () => {}, meter);
        case "storage-set": return writeInstanceAttribute(instance, undefined, "v", cancel, meter);
        case "storage-delete": return deleteInstanceAttribute(instance, undefined, cancel, meter);
        case "class-get": return readClassAttribute(instance, owner, { value: "d", slots: { get: cancel, set() {} } }, () => undefined, meter);
        case "class-storage": return readClassAttribute(instance, owner, undefined, () => ({ value: cancel() }), meter);
        default: return lookupMroAttribute([owner], "x", () => ({ value: cancel() }), meter);
      }
    };
    expect(run).toThrow(ExecutionLimitError);
  });
});
