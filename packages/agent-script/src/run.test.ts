import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { restore } from "./restore.js";
import { run } from "./run.js";

describe("run", () => {
  it("registers Math globals by default", async () => {
    await expect(run("return Math.max(Math.min(5, -2), Math.abs(-4))")).resolves.toMatchObject({
      ok: true,
      returnValue: 4
    });
  });

  it("registers Object, Array, and coercion globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(JSON.parse('{"alpha":1,"beta":2}')),
      Object.values(JSON.parse('{"alpha":1,"beta":2}')),
      Object.entries(JSON.parse('{"alpha":1}')),
      Object.fromEntries(JSON.parse('[["left",1],["right",2]]')),
      Object.freeze(JSON.parse('{"locked":true}')),
      Object.assign(JSON.parse('{"start":1}'), JSON.parse('{"extra":2}')),
      Array.isArray(Array.of(1, 2)),
      Array.from(JSON.parse('["a","b"]')),
      Array.from(JSON.parse('["1","2"]'), Number),
      Array.of(1, 2, 3),
      String(123),
      Number('42.5'),
      Boolean(0)
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      ["alpha", "beta"],
      [1, 2],
      [["alpha", 1]],
      {
        left: 1,
        right: 2
      },
      {
        locked: true
      },
      {
        start: 1,
        extra: 2
      },
      true,
      ["a", "b"],
      [1, 2],
      [1, 2, 3],
      "123",
      42.5,
      false
    ]);
  });

  it("registers Error globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Error('boom').name,
      Error('boom').message,
      Error().message,
      Error().stack,
      TypeError(42).name,
      TypeError(42).message,
      Error('boom').stack
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      "Error",
      "boom",
      "",
      "Error\n    at Error (line 5, column 7)",
      "TypeError",
      "42",
      "Error: boom\n    at Error (line 8, column 7)"
    ]);
  });

  it("keeps coercion helpers opaque when used as Object sources", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(String),
      Object.values(String),
      Object.entries(String),
      Object.assign(JSON.parse('{}'), String, JSON.parse('{"ok":true}'))
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([[], [], [], { ok: true }]);
  });

  it("uses deterministic Math.random() when seeded", async () => {
    const first = await run("return Math.random()", {
      randomSeed: 123
    });
    const second = await run("return Math.random()", {
      randomSeed: 123
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
  });

  it("replays seeded random progress from a saved snapshot", async () => {
    const source = "return Math.random()";
    const first = await run(source, {
      randomSeed: 123
    });
    const snapshot = dump(first);
    const restored = restore(snapshot, { source });
    const second = await run(source, {
      randomSeed: 999,
      snapshot: restored
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.4351300236303359,
      snapshot: {
        random: {
          seed: 123,
          state: 1_868_869_221
        }
      }
    });
  });

  it("does not serialize random state for host randomness", async () => {
    const result = await run("return Math.random()");

    expect(result.ok).toBe(true);
    expect(result.snapshot.random).toBeUndefined();
  });
});
