import { describe, expect, it, vi } from "vitest";

import { run } from "./run.js";
import { dump } from "./dump.js";
import { restore } from "./restore.js";
import { createSeededRandom } from "./interp/globals/math.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";

describe("completed snapshot replay", () => {
  it("preserves legacy terminal progression and records subsequent replay history", async () => {
    const source = "return Math.random();";
    const original = await run(source, { randomSeed: 123 });
    if (original.snapshot.random === undefined) throw new Error("Missing random state");
    const legacy = {
      version: 1,
      sourceHash: original.snapshot.sourceHash,
      bindings: {},
      random: { seed: 123, state: original.snapshot.random.state }
    };
    const resumed = await run(source, { snapshot: legacy });
    const expected = createSeededRandom(legacy.random.state).next();
    expect(resumed).toMatchObject({ ok: true, returnValue: expected });
    const repeated = await run(source, {
      snapshot: JSON.parse(serializeSafeJSSnapshot(resumed.snapshot))
    });
    expect(repeated).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not invoke user code in a malformed replay error marker", async () => {
    const source = "return 1;";
    const original = await run(source);
    const stringify = vi.fn(() => "unavailable");
    const read = vi.fn(() => "unavailable");
    const markers = [
      { ...original.snapshot, replayError: { toString: stringify } },
      Object.defineProperty({ ...original.snapshot }, "replayError", {
        enumerable: true,
        get: read
      })
    ];
    for (const snapshot of markers) {
      expect(() => serializeSafeJSSnapshot(snapshot)).toThrow(/not replayable/);
      expect(() => restore(snapshot, { source })).toThrow();
    }
    expect(stringify).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "native function",
      value: () => () => 1,
      source: "const value = await load(); return value();"
    },
    {
      kind: "nested promise",
      value: () => ({ pending: Promise.resolve(1) }),
      source: "const value = await load(); return await value.pending;"
    }
  ])(
    "keeps ordinary execution available but refuses incomplete $kind snapshots",
    async ({ value, source }) => {
      const load = vi.fn(async () => value());
      const execution = run(source, { bindings: { load } });
      const original = await execution;
      expect(original).toMatchObject({ ok: true, returnValue: 1 });
      expect(original.snapshot.replayError).toMatch(/resume capability/);
      expect(() => serializeSafeJSSnapshot(original.snapshot)).toThrow(/not replayable/);
      await expect(dump(original)).rejects.toThrow(/not replayable/);
      await expect(dump(execution)).rejects.toThrow(/not replayable/);
      expect(() => restore(original.snapshot, { source })).toThrow(/not replayable/);
      expect(() => restore(JSON.parse(JSON.stringify(original.snapshot)), { source })).toThrow(
        /not replayable/
      );
      expect(load).toHaveBeenCalledOnce();
    }
  );

  it.each([1, 16, 128])(
    "replays %i draws, original inputs, and completed host results",
    async (width) => {
      let reads = 0;
      const read = async (index: number) => {
        reads += 1;
        return index + 10;
      };
      const source = `const values = []; for (let index = 0; index < ${width}; index++) { payload.count++; values.push([payload.count, Math.random(), await read(index)]); } return values;`;
      const original = await run(source, { bindings: { read, payload: { count: 3 } } });
      expect(original.ok).toBe(true);
      let snapshot = JSON.parse(serializeSafeJSSnapshot(original.snapshot));
      for (let iteration = 0; iteration < 3; iteration++) {
        const resumed = await run(source, { snapshot, bindings: { read } });
        expect(resumed).toMatchObject({
          ok: true,
          returnValue: original.ok ? original.returnValue : undefined
        });
        expect(reads).toBe(width);
        snapshot = JSON.parse(serializeSafeJSSnapshot(resumed.snapshot));
      }
    }
  );

  it("reconstructs returned source functions from a completed host journal", async () => {
    let invocations = 0;
    const echo = async (callback: unknown) => {
      invocations++;
      return callback;
    };
    const source =
      "let count = 0; const callback = await echo(() => ++count + Math.random()); return [callback(), callback()];";
    const original = await run(source, { bindings: { echo } });
    const snapshot = JSON.parse(serializeSafeJSSnapshot(original.snapshot));
    const resumed = await run(source, { snapshot, bindings: { echo } });
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: original.ok ? original.returnValue : undefined
    });
    expect(invocations).toBe(1);
  });
});
