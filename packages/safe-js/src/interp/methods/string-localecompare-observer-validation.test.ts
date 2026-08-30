import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import { deepCopyFromSandbox, deepCopyToSandbox, run } from "../../index.js";

function captureGraph(root: unknown) {
  const seen = new Map<object, number>();
  const nodes: Array<{
    id: number;
    kind: string;
    prototype: string;
    extensible: boolean;
    properties: Array<{
      key: string;
      enumerable: boolean;
      configurable: boolean;
      writable: boolean;
      value: unknown;
    }>;
  }> = [];
  function visit(value: unknown): unknown {
    if (value === null) return { type: "null" };
    if (typeof value === "undefined") return { type: "undefined" };
    if (typeof value === "number") {
      return { type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return { type: typeof value, value };
    }
    if (typeof value !== "object") throw new TypeError("Outside finite data graph domain");
    const existing = seen.get(value);
    if (existing !== undefined) return { ref: existing };
    const prototype = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    if (
      isArray ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype
    ) {
      throw new TypeError("Outside finite prototype domain");
    }
    const id = nodes.length;
    const node = {
      id,
      kind: isArray ? "array" : "record",
      prototype: prototype === null ? "null" : isArray ? "Array.prototype" : "Object.prototype",
      extensible: Object.isExtensible(value),
      properties: [] as (typeof nodes)[number]["properties"]
    };
    seen.set(value, id);
    nodes.push(node);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Symbol key is outside this finite oracle");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new TypeError("Data descriptors required");
      node.properties.push({
        key,
        enumerable: descriptor.enumerable === true,
        configurable: descriptor.configurable === true,
        writable: descriptor.writable === true,
        value: visit(descriptor.value)
      });
    }
    return { ref: id };
  }
  return { root: visit(root), nodes };
}

function mixedFixture() {
  const shared: Record<string, unknown> = Object.assign(Object.create(null), {
    id: "a",
    attempt: 1
  });
  const acknowledgement = { label: "planner-0", accepted: true };
  const root = Object.assign(Object.create(null) as Record<string, unknown>, {
    left: shared,
    right: shared,
    attempts: [shared],
    acknowledgement,
    error: Object.assign(Object.create(null), {
      name: "Error",
      message: "data",
      stack: "kept",
      code: "DATA"
    })
  });
  root.self = root;
  return { root, shared, acknowledgement };
}

describe("independent O15 observer domain", () => {
  it("compares only the native final-attempts expectation in the public input domain", async () => {
    const expected = [
      { id: "a", attempt: 1 },
      { id: "b", attempt: 2 },
      { id: "c", attempt: 3 }
    ];
    const result = await run('return [{id:"a",attempt:1},{id:"b",attempt:2},{id:"c",attempt:3}];');
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const manual = expected.map((record) => Object.assign(Object.create(null), record));
    expect(captureGraph(result.returnValue)).toStrictEqual(captureGraph(manual));
    expect(captureGraph(deepCopyToSandbox(expected))).toStrictEqual(captureGraph(manual));
    expect(isDeepStrictEqual(result.returnValue, expected)).toBe(false);
    expect(isDeepStrictEqual(result.returnValue, deepCopyToSandbox(expected))).toBe(true);
  });

  it("retains mixed guest/host prototypes and references without using the copier as oracle", async () => {
    const acknowledgement = { label: "planner-0", accepted: true };
    const result = await run(
      'import { ack } from "work"; const shared={id:"a",attempt:1}; const root={left:shared,right:shared,attempts:[shared],acknowledgement:await ack(),error:{name:"Error",message:"data",stack:"kept",code:"DATA"}}; root.self=root; return root;',
      { modules: { work: { ack: async () => acknowledgement } } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const expected = mixedFixture();
    expect(captureGraph(result.returnValue)).toStrictEqual(captureGraph(expected.root));
    const actual = result.returnValue as Record<string, unknown>;
    expect(actual.acknowledgement).not.toBe(acknowledgement);
    expect(captureGraph(deepCopyToSandbox(expected.root))).not.toStrictEqual(
      captureGraph(expected.root)
    );
  });

  it("copies a host result while preserving its internal aliases", async () => {
    const shared = { value: 1 };
    const hostResult = { left: shared, right: shared, items: [shared] };
    const result = await run('import { ack } from "work"; return await ack();', {
      modules: { work: { ack: async () => hostResult } }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).not.toBe(hostResult);
    expect(captureGraph(result.returnValue)).toStrictEqual(captureGraph(hostResult));
  });

  it("independently fixes expected copy keys, order, prototypes and reference topology", () => {
    const shared = { id: "a", attempt: 1 };
    const source: Record<string, unknown> = { left: shared, right: shared, items: [shared] };
    source.self = source;
    const manualShared = Object.assign(Object.create(null), shared);
    const manual = Object.assign(Object.create(null), {
      left: manualShared,
      right: manualShared,
      items: [manualShared]
    });
    manual.self = manual;
    const copied = deepCopyToSandbox(source);
    expect(captureGraph(copied)).toStrictEqual(captureGraph(manual));
    expect(captureGraph(deepCopyFromSandbox(copied))).toStrictEqual(captureGraph(manual));
  });

  it.each([
    [
      "changed value",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        shared.attempt = 2;
      }
    ],
    [
      "missing key",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        delete shared.id;
      }
    ],
    [
      "extra key",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        shared.extra = true;
      }
    ],
    [
      "hidden key",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.defineProperty(shared, "hidden", { value: 1 });
      }
    ],
    [
      "broken alias",
      ({ root, shared }: ReturnType<typeof mixedFixture>) => {
        root.right = Object.assign(Object.create(null), shared);
      }
    ],
    [
      "broken cycle",
      ({ root }: ReturnType<typeof mixedFixture>) => {
        root.self = null;
      }
    ],
    [
      "host acknowledgement misclassification",
      ({ acknowledgement }: ReturnType<typeof mixedFixture>) => {
        Object.setPrototypeOf(acknowledgement, null);
      }
    ],
    [
      "guest prototype mismatch",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.setPrototypeOf(shared, Object.prototype);
      }
    ],
    [
      "writable flag",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.defineProperty(shared, "id", { writable: false });
      }
    ],
    [
      "enumerable flag",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.defineProperty(shared, "id", { enumerable: false });
      }
    ],
    [
      "configurable flag",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.defineProperty(shared, "id", { configurable: false });
      }
    ],
    [
      "key order",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        const value = shared.id;
        delete shared.id;
        shared.id = value;
      }
    ],
    [
      "array hole",
      ({ root }: ReturnType<typeof mixedFixture>) => {
        delete (root.attempts as unknown[])[0];
      }
    ],
    [
      "error stack loss",
      ({ root }: ReturnType<typeof mixedFixture>) => {
        delete (root.error as Record<string, unknown>).stack;
      }
    ],
    [
      "error message change",
      ({ root }: ReturnType<typeof mixedFixture>) => {
        (root.error as Record<string, unknown>).message = "changed";
      }
    ],
    [
      "extensibility",
      ({ shared }: ReturnType<typeof mixedFixture>) => {
        Object.preventExtensions(shared);
      }
    ]
  ] as const)("rejects %s rather than hiding it in conversion", (_name, mutate) => {
    const expected = mixedFixture();
    const actual = mixedFixture();
    mutate(actual);
    expect(captureGraph(actual.root)).not.toStrictEqual(captureGraph(expected.root));
  });

  it("does not ignore symbol keys", () => {
    const { shared } = mixedFixture();
    Object.defineProperty(shared, Symbol("extra"), { value: 1 });
    expect(() => captureGraph(shared)).toThrow("Symbol key");
  });

  it("does not invoke accessor observers", () => {
    let reads = 0;
    const { shared } = mixedFixture();
    Object.defineProperty(shared, "extra", {
      get() {
        reads += 1;
        return 1;
      }
    });
    expect(() => captureGraph(shared)).toThrow("Data descriptors");
    expect(reads).toBe(0);
  });

  it("refuses out-of-domain native errors instead of dropping their fields", () => {
    expect(() => captureGraph(new Error("not ordinary data"))).toThrow("prototype domain");
  });

  it("does not turn a custom array prototype into an ordinary array", () => {
    const array = [1];
    Object.setPrototypeOf(array, null);
    expect(() => captureGraph(array)).toThrow("prototype domain");
  });
});
