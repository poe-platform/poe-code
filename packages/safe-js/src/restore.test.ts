import { describe, expect, it } from "vitest";

import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./snapshot/validation.js";

describe("restore", () => {
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
