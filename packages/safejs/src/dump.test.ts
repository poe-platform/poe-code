import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { createSandboxClosure } from "./interp/values.js";
import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";

describe("dump", () => {
  it("writes valid JSON", async () => {
    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource("return 1"),
        bindings: {
          answer: 42
        }
      }
    });

    expect(() => JSON.parse(dumped)).not.toThrow();
  });

  it("does not read inherited snapshot properties", async () => {
    const result = Object.create({
      snapshot: {
        sourceHash: hashSource("return 1")
      }
    }) as Parameters<typeof dump>[0];

    await expect(dump(result)).rejects.toThrow("Run completed without producing a snapshot.");
  });

  it("writes human-readable JSON with 2-space indentation", async () => {
    await expect(
      dump({
        snapshot: {
          sourceHash: hashSource("return 1"),
          bindings: {
            answer: 42
          }
        }
      })
    ).resolves.toBe(
      [
        "{",
        '  "version": 1,',
        `  "sourceHash": "${hashSource("return 1")}",`,
        '  "bindings": {',
        '    "answer": 42',
        "  }",
        "}"
      ].join("\n")
    );
  });

  it("roundtrips through restore", async () => {
    const source = "return 1";
    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource(source),
        bindings: {
          answer: 42
        }
      }
    });
    const snapshot = JSON.parse(dumped);

    expect(restore(snapshot, { source })).toBe(snapshot);
  });

  it("includes a version field checked by restore", async () => {
    const source = "return 1";
    const snapshot = JSON.parse(
      await dump({
        snapshot: {
          sourceHash: hashSource(source)
        }
      })
    );

    expect(snapshot.version).toBe(1);

    const { version: ignoredVersion, ...withoutVersion } = snapshot;
    expect(() => restore(withoutVersion, { source })).toThrowError(
      expect.objectContaining({ name: "SnapshotValidationError", path: "$.version" })
    );
  });

  it("rejects dumps from older versions with a clear incompatible version error", () => {
    const source = "return 1";

    expect(() =>
      restore(
        {
          version: 0,
          sourceHash: hashSource(source)
        },
        { source }
      )
    ).toThrowError(expect.objectContaining({ name: "SnapshotValidationError", path: "$.version" }));
  });

  it("rejects dumps with a corrupted source hash with a clear error", () => {
    expect(() =>
      restore(
        {
          version: 1,
          sourceHash: "corrupted"
        },
        { source: "return 1" }
      )
    ).toThrowError(
      `source changed since snapshot was taken (hash corrupted expected, got ${hashSource("return 1")}); pass --reset to discard`
    );
  });

  it("bounds dump size for circular harness state", async () => {
    const source = "return state";
    const state: Record<string, unknown> = {
      id: "root"
    };
    state.self = state;
    state.repeated = Array.from({ length: 100 }, () => state);

    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource(source),
        bindings: {
          state
        }
      }
    });
    const snapshot = JSON.parse(dumped);

    expect(dumped.length).toBeLessThan(10_000);
    expect(snapshot.bindings.state).toEqual({
      kind: "ref",
      id: 1
    });
    expect(snapshot.heap["1"].entries.self).toEqual({
      kind: "ref",
      id: 1
    });
  });

  it("excludes host references from dumped values", async () => {
    const source = "return task";
    const hostState = {
      secret: "do-not-dump"
    };
    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource(source),
        bindings: {
          task: createSandboxClosure({
            call: () => hostState.secret,
            name: "task"
          }),
          leaked: () => hostState.secret
        }
      }
    });
    const snapshot = JSON.parse(dumped);

    expect(snapshot.bindings).toEqual({
      task: {
        kind: "fn",
        name: "task"
      }
    });
    expect(dumped).not.toContain("call");
    expect(dumped).not.toContain("do-not-dump");
  });

  it("does not invoke object accessors while excluding host state", async () => {
    const source = "return state";
    const hostState = {
      secret: "do-not-dump"
    };
    const state: Record<string, unknown> = {
      visible: true
    };
    Object.defineProperty(state, "leaked", {
      enumerable: true,
      get: () => hostState.secret
    });

    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource(source),
        bindings: {
          state
        }
      }
    });
    const snapshot = JSON.parse(dumped);

    expect(snapshot.bindings.state).toEqual({
      visible: true
    });
    expect(dumped).not.toContain("leaked");
    expect(dumped).not.toContain("do-not-dump");
  });

  it("does not invoke array accessors while excluding host state", async () => {
    const source = "return values";
    const hostState = {
      secret: "do-not-dump"
    };
    const values: unknown[] = ["safe"];
    Object.defineProperty(values, "1", {
      enumerable: true,
      get: () => hostState.secret
    });

    const dumped = await dump({
      snapshot: {
        sourceHash: hashSource(source),
        bindings: {
          values
        }
      }
    });
    const snapshot = JSON.parse(dumped);

    expect(snapshot.bindings.values).toEqual(["safe", { kind: "undefined" }]);
    expect(dumped).not.toContain("do-not-dump");
  });
});
