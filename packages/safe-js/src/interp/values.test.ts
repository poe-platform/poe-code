import { describe, expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { SandboxError } from "./budget.js";

import {
  createSandboxClosure,
  createSandboxPromise,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise
} from "./values.js";

describe("sandbox values", () => {
  it("rejects deeply nested host ingress and final-result export with typed depth errors", () => {
    let hostValue: unknown = "leaf";
    for (let index = 0; index < 5_000; index += 1) hostValue = [hostValue];

    expect(() => deepCopyToSandbox(hostValue)).toThrowError(
      expect.objectContaining({
        name: "SandboxError",
        budget: "dataDepth",
        current: MAX_DATA_DEPTH + 1,
        limit: MAX_DATA_DEPTH
      }) satisfies Partial<SandboxError>
    );

    let sandboxValue = "leaf" as ReturnType<typeof deepCopyToSandbox>;
    for (let index = 0; index < 5_000; index += 1) sandboxValue = [sandboxValue];
    expect(() => deepCopyFromSandbox(sandboxValue)).toThrowError(
      expect.objectContaining({
        name: "SandboxError",
        budget: "dataDepth",
        current: MAX_DATA_DEPTH + 1,
        limit: MAX_DATA_DEPTH
      }) satisfies Partial<SandboxError>
    );
  });
  it("deep-copies host Map and Set values with shared references and cycles", () => {
    const shared = { id: "shared" };
    const source = new Map<unknown, unknown>();
    const set = new Set<unknown>([shared]);
    source.set(shared, set);
    source.set("self", source);

    const sandbox = deepCopyToSandbox(source);
    expect(isSandboxMap(sandbox)).toBe(true);
    if (!isSandboxMap(sandbox)) {
      return;
    }

    const host = deepCopyFromSandbox(sandbox);
    expect(host).toBeInstanceOf(Map);
    const restored = host as Map<unknown, unknown>;
    const restoredShared = [...restored.keys()][0];
    expect(restored.get("self")).toBe(restored);
    expect(restored.get(restoredShared)).toBeInstanceOf(Set);
    expect([...(restored.get(restoredShared) as Set<unknown>)][0]).toBe(restoredShared);
  });

  it("copies plain objects and arrays into sandbox space using own enumerable keys only", () => {
    const source = {
      visible: {
        items: [1, "two", null] as Array<number | string | null>
      }
    } as {
      visible: {
        items: Array<number | string | null>;
      };
      hidden?: string;
      [key: symbol]: string;
    };
    const symbolKey = Symbol("skip");

    Object.defineProperty(source, "hidden", {
      enumerable: false,
      value: "skip"
    });
    source[symbolKey] = "skip";

    const copy = deepCopyToSandbox(source);

    expect(copy).toEqual({
      visible: {
        items: [1, "two", null]
      }
    });
    expect(copy).not.toBe(source);
    expect(Array.isArray(copy.visible.items)).toBe(true);
    expect(copy.visible).not.toBe(source.visible);
    expect(copy.visible.items).not.toBe(source.visible.items);
  });

  it("copies sandbox objects and arrays back to host values", () => {
    const source = deepCopyToSandbox({
      agent: "planner",
      nested: {
        steps: [1, 2, 3]
      }
    });

    const copy = deepCopyFromSandbox(source);

    expect(copy).toEqual({
      agent: "planner",
      nested: {
        steps: [1, 2, 3]
      }
    });
    expect(copy).not.toBe(source);
    expect(copy.nested).not.toBe(source.nested);
    expect(copy.nested.steps).not.toBe(source.nested.steps);
  });

  it("preserves null-prototype objects in both directions", () => {
    const source = Object.create(null) as Record<string, unknown>;
    source.answer = {
      nested: true
    };

    const sandboxCopy = deepCopyToSandbox(source);
    const hostCopy = deepCopyFromSandbox(sandboxCopy) as Record<string, unknown>;

    expect(Object.getPrototypeOf(sandboxCopy)).toBeNull();
    expect(Object.getPrototypeOf(hostCopy)).toBeNull();
    expect(hostCopy).toEqual({
      answer: {
        nested: true
      }
    });
  });

  it("preserves own __proto__ keys as data in both directions", () => {
    const source = {
      safe: 1
    } as Record<string, unknown>;

    Object.defineProperty(source, "__proto__", {
      enumerable: true,
      value: {
        polluted: true
      }
    });

    const sandboxCopy = deepCopyToSandbox(source);
    const hostCopy = deepCopyFromSandbox(sandboxCopy) as Record<string, unknown>;

    expect(Object.hasOwn(sandboxCopy, "__proto__")).toBe(true);
    expect(sandboxCopy.__proto__).toEqual({
      polluted: true
    });
    expect(Object.getPrototypeOf(sandboxCopy)).toBeNull();

    expect(Object.hasOwn(hostCopy, "__proto__")).toBe(true);
    expect(hostCopy.__proto__).toEqual({
      polluted: true
    });
    expect(Object.getPrototypeOf(hostCopy)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves shared references and cycles when copying to sandbox", () => {
    const shared = {
      answer: 42
    };
    const source = {
      left: shared,
      right: shared,
      items: [shared] as unknown[]
    } as {
      left: { answer: number };
      right: { answer: number };
      items: unknown[];
      self?: unknown;
    };

    source.self = source;

    const copy = deepCopyToSandbox(source);

    expect(copy.left).toBe(copy.right);
    expect(copy.items[0]).toBe(copy.left);
    expect(copy.self).toBe(copy);
  });

  it("preserves circular object references when copying to sandbox", () => {
    const source = {} as {
      self?: unknown;
    };
    source.self = source;

    const copy = deepCopyToSandbox(source);

    expect(copy).not.toBe(source);
    expect(copy.self).toBe(copy);
  });

  it("preserves sibling-shared references when copying to sandbox", () => {
    const shared = {};
    const source = {
      l: shared,
      r: shared
    };

    const copy = deepCopyToSandbox(source);

    expect(copy.l).toBe(copy.r);
    expect(copy.l).not.toBe(shared);
  });

  it("preserves self-referencing arrays when copying to sandbox", () => {
    const source: unknown[] = [];
    source.push(source);

    const copy = deepCopyToSandbox(source);

    expect(copy).not.toBe(source);
    expect(copy[0]).toBe(copy);
  });

  it("copies very deep plain objects without overflowing the stack", () => {
    const source: Record<string, unknown> = {};
    let current = source;

    for (let index = 0; index < 1_000; index += 1) {
      const next: Record<string, unknown> = {};
      current.child = next;
      current = next;
    }

    expect(() => deepCopyToSandbox(source)).not.toThrow();
  });

  it("preserves shared references and cycles when copying back to host", () => {
    const shared = deepCopyToSandbox({
      answer: 42
    });
    const source = {
      left: shared,
      right: shared,
      items: [shared] as unknown[]
    } as {
      left: typeof shared;
      right: typeof shared;
      items: unknown[];
      self?: unknown;
    };

    source.self = source;

    const copy = deepCopyFromSandbox(source) as {
      left: { answer: number };
      right: { answer: number };
      items: unknown[];
      self: unknown;
    };

    expect(copy.left).toBe(copy.right);
    expect(copy.items[0]).toBe(copy.left);
    expect(copy.self).toBe(copy);
  });

  it("preserves sparse arrays instead of materializing holes", () => {
    const source = new Array<string | undefined>(2);
    source[1] = "value";

    const sandboxCopy = deepCopyToSandbox(source);
    const hostCopy = deepCopyFromSandbox(sandboxCopy) as Array<string | undefined>;

    expect(0 in sandboxCopy).toBe(false);
    expect(sandboxCopy).toHaveLength(2);
    expect(1 in sandboxCopy).toBe(true);
    expect(sandboxCopy[1]).toBe("value");

    expect(0 in hostCopy).toBe(false);
    expect(hostCopy).toHaveLength(2);
    expect(hostCopy[1]).toBe("value");
  });

  it("skips non-enumerable properties when copying to sandbox", () => {
    const source = {
      visible: 1
    } as {
      visible: number;
      hidden?: number;
    };

    Object.defineProperty(source, "hidden", {
      enumerable: false,
      value: 2
    });

    expect(deepCopyToSandbox(source)).toEqual({
      visible: 1
    });
  });

  it("skips symbol-keyed properties when copying to sandbox", () => {
    const symbolKey = Symbol("hidden");
    const source = {
      visible: 1,
      [symbolKey]: 2
    };

    expect(deepCopyToSandbox(source)).toEqual({
      visible: 1
    });
  });

  it("copies arrays with enumerable string keys", () => {
    const source = [] as Array<unknown> & {
      foo?: number;
    };
    source.foo = 1;

    const copy = deepCopyToSandbox(source);

    expect(Array.isArray(copy)).toBe(true);
    expect(copy).toHaveLength(0);
    expect(copy.foo).toBe(1);
  });

  it("wraps host promises as sandbox promises and unwraps them back to host promises", async () => {
    const sandboxPromise = deepCopyToSandbox(
      Promise.resolve({
        answer: [42]
      })
    );

    expect(isSandboxPromise(sandboxPromise)).toBe(true);
    await expect(deepCopyFromSandbox(sandboxPromise)).resolves.toEqual({
      answer: [42]
    });
  });

  it("copies promise rejection reasons across the host boundary", async () => {
    const sandboxPromise = deepCopyToSandbox(
      Promise.reject({
        code: "FAIL",
        detail: [42]
      })
    );

    expect(isSandboxPromise(sandboxPromise)).toBe(true);
    await expect(deepCopyFromSandbox(sandboxPromise)).rejects.toEqual({
      code: "FAIL",
      detail: [42]
    });
  });

  it("keeps subset closures in sandbox space and rejects host callbacks until wrapped explicitly", () => {
    const closure = createSandboxClosure({
      call: async ([first]) => first,
      name: "first"
    });

    expect(isSandboxClosure(closure)).toBe(true);
    expect(deepCopyToSandbox(closure)).toBe(closure);
    expect(() => deepCopyFromSandbox(closure)).toThrowError(
      "Sandbox closures cannot cross into host values without an explicit wrapper."
    );
  });

  it("rejects nested sandbox closures when copying back to host values", () => {
    const closure = createSandboxClosure({
      call: ([first]) => first,
      name: "first"
    });

    expect(() =>
      deepCopyFromSandbox({
        callback: closure
      })
    ).toThrowError("Sandbox closures cannot cross into host values without an explicit wrapper.");
  });

  it("passes sandbox promises through untouched", () => {
    const promise = createSandboxPromise(Promise.resolve("done"));

    expect(deepCopyToSandbox(promise)).toBe(promise);
  });

  it("rejects unsupported host values", () => {
    expect(() => deepCopyToSandbox(new Date("2026-04-28T12:00:00Z"))).toThrowError(
      "Unsupported sandbox value at <root>: Date"
    );
    expect(() => deepCopyToSandbox(() => "nope")).toThrowError(
      "Unsupported sandbox value at <root>: function"
    );
  });

  it("rejects unsupported scalar and built-in host values with clear errors", () => {
    expect(() => deepCopyToSandbox(1n)).toThrowError("Unsupported sandbox value at <root>: bigint");
    expect(() => deepCopyToSandbox(/SafeJS/giu)).toThrowError(
      "Unsupported sandbox value at <root>: RegExp"
    );
    expect(() => deepCopyToSandbox(new Uint8Array([1, 2, 3]))).toThrowError(
      "Unsupported sandbox value at <root>: Uint8Array"
    );
  });

  it("rejects non-plain objects and arrays", () => {
    class Example {
      readonly answer = 42;
    }

    class ExampleArray extends Array<number> {}

    expect(() => deepCopyToSandbox(new Example())).toThrowError(
      "Unsupported sandbox value at <root>: Example"
    );
    expect(() => deepCopyToSandbox(new ExampleArray(1, 2, 3))).toThrowError(
      "Unsupported sandbox value at <root>: ExampleArray"
    );
    expect(() => deepCopyToSandbox(Object.create({ hidden: true }))).toThrowError(
      "Unsupported sandbox value at <root>: Object"
    );
  });

  it("rejects throwing enumerable accessors instead of invoking host getters", () => {
    let reads = 0;
    const source = {};

    Object.defineProperty(source, "answer", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter failed");
      }
    });

    expect(() => deepCopyToSandbox(source)).toThrowError(
      "Unsupported sandbox value at <root>.answer: accessor property"
    );
    expect(reads).toBe(0);
  });
});
