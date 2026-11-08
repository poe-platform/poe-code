import { describe, expect, it } from "vitest";
import { expectLegacyDumpGraph } from "./legacy-dump-graph.js";

describe.each(["parseInt", "parseFloat"])("legacy %s intrinsic alias", name => {
  function fixture() {
    const parser = { kind: "ref", id: 2 };
    return {
      legacy: { bindings: { Number: { kind: "fn", name: "Number" }, [name]: { kind: "fn", name } }, heap: {} },
      actual: {
        bindings: { Number: { kind: "ref", id: 1 }, [name]: parser },
        heap: {
          1: { kind: "intrinsic", id: '["Number"]', state: {
            properties: { properties: [[name, { kind: "data", value: parser }]] }
          } },
          2: { kind: "intrinsic", id: JSON.stringify(["Number", name]) }
        }
      }
    };
  }

  it("accepts the shared Number and global parser", () => {
    const { actual, legacy } = fixture();
    expect(() => expectLegacyDumpGraph(actual, legacy)).not.toThrow();
  });

  it("rejects split global and Number parser references", () => {
    const { actual, legacy } = fixture();
    actual.bindings[name] = { kind: "ref", id: 3 };
    Object.assign(actual.heap, { 3: { ...actual.heap[2] } });
    expect(() => expectLegacyDumpGraph(actual, legacy)).toThrow();
  });

  it("rejects an unrelated canonical path", () => {
    const { actual, legacy } = fixture();
    actual.heap[2].id = '["Math","random"]';
    expect(() => expectLegacyDumpGraph(actual, legacy)).toThrow();
  });

  it("rejects a missing Number parser property", () => {
    const { actual, legacy } = fixture();
    actual.heap[1].state.properties.properties = [];
    expect(() => expectLegacyDumpGraph(actual, legacy)).toThrow();
  });
});
