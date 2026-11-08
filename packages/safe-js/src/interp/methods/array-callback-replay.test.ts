import { describe, expect, it, vi } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { declareHostOperation } from "../host-bridge.js";

describe("array callback mutation replay", () => {
  it.each(["map", "reduce", "sort"])(
    "replays recorded host callbacks containing %s mutation without repeating the host",
    async (method) => {
      const invocation =
        method === "reduce"
          ? "values.reduce((total, entry, index, receiver) => total + visit(entry, index, receiver), 0)"
          : method === "sort"
            ? "values.sort((left, right) => { visit(left, 0, values); return left - right; }).slice()"
            : "values.map(visit)";
      const source = `
        const values = [3, 1, 2];
        const alias = values;
        values.note = { count: 0 };
        let changed = false;
        function visit(entry, index, receiver) {
          if (!changed) {
            changed = true;
            receiver.push(4);
            delete receiver[1];
            receiver[2] = 9;
            receiver.note.count += 1;
          }
          return entry;
        }
        const result = await host(() => ${invocation});
        values.push(5);
        values.note.count += 1;
        return { result, values, same: alias === values, keys: Object.keys(values) };
      `;
      const invoke = async (callback: () => unknown) => callback();
      const expected: unknown = await Function(
        "host",
        `"use strict"; return (async () => { ${source} })();`
      )(invoke);
      const host = vi.fn(invoke);
      const bindings = { host: declareHostOperation(host, "read-side-effect") };
      let snapshot: ReturnType<typeof restore> | undefined;
      for (let round = 0; round < 3; round += 1) {
        const result = await run(source, { bindings, snapshot });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected successful callback replay");
        expect(structuredClone(result.returnValue)).toStrictEqual(expected);
        expect(host).toHaveBeenCalledTimes(1);
        snapshot = restore(JSON.parse(await dump(result)), { source });
      }
    }
  );

  it("restores pending async map results after synchronous receiver mutation", async () => {
    const source = `
      const values = [1, 2, 3];
      const alias = values;
      const visits = [];
      const mapped = await Promise.all(values.map(async (entry, index, receiver) => {
        visits.push([entry, index, receiver === alias]);
        if (index === 0) { receiver.push(4); delete receiver[1]; }
        const marked = await mark(entry);
        return entry + marked;
      }));
      values.push(5);
      return { mapped, visits, values, keys: Object.keys(values), same: values === alias };
    `;
    const expected: unknown = await Function(
      "mark",
      `"use strict"; return (async () => { ${source} })();`
    )(async (entry: number) => entry * 10);
    let release!: () => void;
    let signalEntered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let originalCalls = 0;
    const mark = declareHostOperation(async (entry: number) => {
      originalCalls += 1;
      if (originalCalls === 2) signalEntered();
      await pending;
      return entry * 10;
    }, "re-issue");
    const execution = run(source, { bindings: { mark } });
    void execution.catch(() => undefined);
    let serialized: string;
    try {
      await Promise.race([entered, execution]);
      serialized = await dump(execution, { mode: "replay" });
    } finally {
      release();
    }
    const original = await execution;
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error("Expected successful pending execution");
    expect(structuredClone(original.returnValue)).toStrictEqual(expected);
    const checkpoint = JSON.parse(serialized);
    expect(checkpoint.pendingAwaits.length).toBeGreaterThan(0);
    const reissued = vi.fn(async (entry: number) => entry * 10);
    const replay = await run(source, {
      snapshot: restore(checkpoint, { source }),
      bindings: { mark: declareHostOperation(reissued, "re-issue") }
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("Expected successful pending replay");
    expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
    expect(originalCalls).toBe(2);
    expect(reissued).toHaveBeenCalledTimes(2);
  });
});
