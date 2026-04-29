import { describe, expect, it } from "vitest";

import {
  createSandboxClosure,
  createSandboxPromise,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise
} from "./values.js";

describe("sandbox values", () => {
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
    expect(Object.getPrototypeOf(sandboxCopy)).toBe(Object.prototype);

    expect(Object.hasOwn(hostCopy, "__proto__")).toBe(true);
    expect(hostCopy.__proto__).toEqual({
      polluted: true
    });
    expect(Object.getPrototypeOf(hostCopy)).toBe(Object.prototype);
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
    expect(() => deepCopyToSandbox(new Map())).toThrowError(
      "Unsupported sandbox value at <root>: Map"
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

  it("rejects enumerable accessors instead of invoking host getters", () => {
    let reads = 0;
    const source = {};

    Object.defineProperty(source, "answer", {
      enumerable: true,
      get() {
        reads += 1;
        return 42;
      }
    });

    expect(() => deepCopyToSandbox(source)).toThrowError(
      "Unsupported sandbox value at <root>.answer: accessor property"
    );
    expect(reads).toBe(0);
  });

  it("rejects arrays with extra enumerable keys", () => {
    const source = ["value"] as Array<string> & {
      extra?: string;
    };
    source.extra = "skip";

    expect(() => deepCopyToSandbox(source)).toThrowError(
      "Unsupported sandbox value at <root>: non-index array property 'extra'"
    );
  });
});
