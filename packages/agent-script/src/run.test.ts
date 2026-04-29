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
