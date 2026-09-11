import { describe, expect, it } from "vitest";

import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";
import { run } from "./run.js";
import { SnapshotValidationError } from "./snapshot/validation.js";

describe("restore", () => {
  it.each([
    [{ clock: { next: -1 } }, "$.clock.next"],
    [{ random: { seed: 1, state: -1 } }, "$.random.state"]
  ])("rejects invalid scalar state before reading the heap: %j", (state, path) => {
    let reads = 0;
    const snapshot = Object.defineProperty({ version: 1, sourceHash: hashSource("1"), ...state }, "heap", {
      enumerable: true, get() { reads++; throw new Error("heap read"); }
    });
    expect(() => restore(snapshot, { source: "1" })).toThrow(expect.objectContaining({
      name: "SnapshotValidationError", path
    }));
    expect(reads).toBe(0);
  });

  it.each(["clock", "random", "next", "seed", "state", "initialState", "resumeState"])(
    "preserves ordinary traversal for scalar accessor %s", field => {
      let reads = 0;
      const error = new Error("getter ran");
      const snapshot = { version: 1, sourceHash: hashSource("1"), clock: { next: 0 }, random: { seed: 1, state: 1 } };
      const target = field === "clock" || field === "random" ? snapshot : field === "next" ? snapshot.clock : snapshot.random;
      Object.defineProperty(target, field, { enumerable: true, get() { reads++; throw error; } });
      expect(() => restore(snapshot, { source: "1" })).toThrow(error);
      expect(reads).toBe(1);
    }
  );

  it("skips scalar preflight for a proxy prototype without invoking its has trap", () => {
    let traps = 0;
    const prototype = new Proxy({}, { has() { traps++; throw new Error("has trap ran"); } });
    const snapshot = Object.assign(Object.create(prototype), { version: 1, sourceHash: hashSource("1") });
    expect(restore(snapshot, { source: "1" })).toBe(snapshot);
    expect(traps).toBe(0);
  });

  it.each(["clock", "random"])("rechecks %s scalar state after payload traversal", field => {
    const snapshot = { version: 1, sourceHash: hashSource("1"), clock: { next: 0 }, random: { seed: 1, state: 1 } };
    Object.defineProperty(snapshot, "extra", { enumerable: true, get() {
      if (field === "clock") snapshot.clock.next = -1;
      else snapshot.random.state = -1;
      return 0;
    } });
    expect(() => restore(snapshot, { source: "1" })).toThrow(expect.objectContaining({
      name: "SnapshotValidationError", path: field === "clock" ? "$.clock.next" : "$.random.state"
    }));
  });

  it.each(["clock", "initialState"])("preserves late validation for inherited scalar %s", field => {
    let reads = 0;
    const snapshot = { version: 1, sourceHash: hashSource("1"), random: { seed: 1, state: 1 } };
    const original = Object.getOwnPropertyDescriptor(Object.prototype, field);
    try {
      Object.defineProperty(Object.prototype, field, { configurable: true, get() { reads++; return -1; } });
      expect(() => restore(snapshot, { source: "1" })).toThrow(SnapshotValidationError);
      expect(reads).toBe(2);
    } finally {
      if (original) Object.defineProperty(Object.prototype, field, original);
      else Reflect.deleteProperty(Object.prototype, field);
    }
  });

  it.each([
    [{ heap: { "1": { kind: "mystery" } } }, "unknownTag"],
    [{ extra: "x".repeat(1_000_001) }, "budgetExceeded"]
  ])("valid scalar state does not bypass payload validation: case %#", (payload, code) => {
    const snapshot = { version: 1, sourceHash: hashSource("1"), clock: { next: 0 }, random: { seed: 1, state: 1 }, ...payload };
    expect(() => restore(snapshot, { source: "1" })).toThrow(expect.objectContaining({ name: "SnapshotValidationError", code }));
  });

  it("does not transfer runtime snapshot trust to a copied envelope", async () => {
    const source = "host.extra=7;return host()";
    const result = await run(source, { bindings: { host: () => 1 } });
    expect(restore(result.snapshot, { source })).toBe(result.snapshot);
    expect(() => restore({ ...result.snapshot }, { source })).toThrow("cannot be restored");
  });

  it("rejects an execution-semantics accessor without evaluating it", () => {
    let reads = 0;
    const snapshot = Object.defineProperty({ version: 1, sourceHash: hashSource("1") }, "executionSemantics", {
      enumerable: true,
      get() { reads++; throw new Error("snapshot getter ran"); }
    });
    expect(() => restore(snapshot, { source: "1" })).toThrow("must be a data property");
    expect(reads).toBe(0);
  });

  it("accepts snapshots whose source hash matches the current source", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("1 + 2"),
      callStack: []
    };

    expect(restore(snapshot, { source: "1 + 2" })).toBe(snapshot);
  });

  it("accepts ordinary objects with a kind field", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("1 + 2"),
      bindings: {
        frontmatter: {
          kind: "pipeline",
          version: 1
        }
      }
    };

    expect(restore(snapshot, { source: "1 + 2" })).toBe(snapshot);
  });

  it("accepts formatting and raw literal changes outside function source", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("const { value = 0x1f } = {}; `hi ${value}`")
    };

    expect(
      restore(snapshot, {
        source: "const {value = 31}={}; `hi ${ value }`"
      })
    ).toBe(snapshot);
  });

  it("rejects raw literal changes observable through function toString", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("({ value = 0x1f }) => `hi ${value}`")
    };
    expect(() => restore(snapshot, { source: "({value = 31}) => `hi ${ value }`" }))
      .toThrow("source changed since snapshot");
  });

  it("rejects snapshots when the source hash no longer matches", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("1 + 2")
    };

    expect(() => restore(snapshot, { source: "1 + 3" })).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("1 + 3")}); pass --reset to discard`
    );
  });

  it("rejects snapshots when the parsed structure changes despite similar source", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("user?.profile")
    };

    expect(() => restore(snapshot, { source: "user.profile" })).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("user.profile")}); pass --reset to discard`
    );
  });

  it.each([
    ["missing version", { sourceHash: hashSource("1 + 2") }, "$.version"],
    ["unknown version", { version: 3, sourceHash: hashSource("1 + 2") }, "$.version"],
    ["missing hash", { version: 1 }, "$.sourceHash"],
    [
      "unsafe clock cursor",
      { version: 1, sourceHash: hashSource("1 + 2"), clock: { next: Number.MAX_SAFE_INTEGER + 1 } },
      "$.clock.next"
    ],
    [
      "unsupported value",
      { version: 1, sourceHash: hashSource("1 + 2"), value: Symbol("bad") },
      "$.value"
    ],
    [
      "negative clock count",
      { version: 1, sourceHash: hashSource("1 + 2"), clock: { next: -1 } },
      "$.clock.next"
    ],
    [
      "non-finite loop cursor",
      {
        version: 1,
        sourceHash: hashSource("1 + 2"),
        loopIterations: { "1": Number.POSITIVE_INFINITY }
      },
      '$.loopIterations["1"]'
    ],
    [
      "negative collection cursor",
      {
        version: 1,
        sourceHash: hashSource("1 + 2"),
        loopIterations: { "1": { index: -1, values: [] } }
      },
      '$.loopIterations["1"].index'
    ],
    [
      "dangling heap reference",
      {
        version: 1,
        sourceHash: hashSource("1 + 2"),
        bindings: { value: { kind: "ref", id: 1 } },
        heap: {}
      },
      "$.bindings.value.id"
    ],
    [
      "invalid heap tag",
      {
        version: 1,
        sourceHash: hashSource("1 + 2"),
        heap: { "1": { kind: "map", entries: [] } }
      },
      '$.heap["1"].kind'
    ],
    [
      "malformed heap array",
      {
        version: 1,
        sourceHash: hashSource("1 + 2"),
        heap: { "1": { kind: "array", items: { length: 100_000 } } }
      },
      '$.heap["1"].items'
    ]
  ])("rejects malformed dump envelopes: %s", (_name, snapshot, path) => {
    expect(() => restore(snapshot as never, { source: "1 + 2" })).toThrowError(
      expect.objectContaining({ name: "SnapshotValidationError", path })
    );
  });

  it("does not expose host stack frames", () => {
    try {
      restore({ version: 3, sourceHash: "bad" }, { source: "1 + 2" });
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotValidationError);
      expect((error as Error).stack).toBe(
        (error as Error).message.replace(/^/, "SnapshotValidationError: ")
      );
    }
  });
});
