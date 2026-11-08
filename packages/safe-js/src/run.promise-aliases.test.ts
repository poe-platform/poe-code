import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { declareHostOperation, dump, restore, run } from "./index.js";
import type { RunOptions, RunSnapshot } from "./run.js";
import { aliasSource } from "../test/fixtures/public-promise-alias-source.js";
import { fullSource } from "../test/fixtures/public-promise-inputs.js";
import previousV7 from "../test/fixtures/public-promise-alias-v7.json" with { type: "json" };

type Placement = "arguments" | "bindings" | "imports" | "importMeta";

function place(source: string, fixture: unknown, placement: Placement) {
  switch (placement) {
    case "arguments":
      return { source, inputs: { entryPointArgs: [fixture] } };
    case "bindings":
      return {
        source,
        inputs: { entryPointArgs: [], bindings: { incoming: fixture } } as RunOptions
      };
    case "imports":
      return {
        source: `import { incoming } from 'inputs';\n${source}`,
        inputs: { entryPointArgs: [], modules: { inputs: { incoming: fixture } } } as RunOptions
      };
    case "importMeta":
      return {
        source: `const incoming = import.meta.incoming;\n${source}`,
        inputs: { entryPointArgs: [], importMeta: { incoming: fixture } }
      };
  }
}

function rawPromise<TValue>(value: TValue, pending: boolean): Promise<TValue> {
  return pending
    ? new Promise((resolve) => queueMicrotask(() => resolve(value)))
    : Promise.resolve(value);
}

function aliasFixture(pending: boolean) {
  const input = rawPromise({ value: 7 }, pending);
  return { primary: input, again: input };
}

function fullFixture(pending: boolean) {
  const left = rawPromise(
    {
      name: "left",
      events: [
        { name: "open", delta: 3 },
        { name: "credit", delta: 5 }
      ]
    },
    pending
  );
  const right = rawPromise(
    {
      name: "right",
      events: [
        { name: "replace", delta: -2, replace: true },
        { name: "settle", delta: 7 }
      ]
    },
    pending
  );
  return {
    order: ["left", "right"],
    primary: left,
    again: left,
    nested: { promise: left },
    remote: right,
    remoteAgain: right
  };
}

async function native(source: string, fixture: unknown, placement: Placement = "arguments") {
  const calls: unknown[] = [];
  const execute = new Function(
    "incoming",
    "boundary",
    `return (${source.trim().slice("export default ".length, -1)});`
  )(fixture, async (label: unknown) => {
    calls.push(label);
    return { boundary: label };
  });
  return { value: await execute(placement === "arguments" ? fixture : undefined), calls };
}

async function captureFull(pending: boolean) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved: RunSnapshot | undefined;
  const calls: unknown[] = [];
  try {
    const result = await run(fullSource, {
      entryPointArgs: [fullFixture(pending)],
      bindings: {
        boundary: declareHostOperation(async (label: unknown) => {
          calls.push(label);
          if (calls.length === 1) {
            clock.mockReturnValue(2);
            await gate;
          }
          return { boundary: label };
        }, "re-issue")
      },
      snapshotIntervalMs: 1,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async remove() {},
        async write(snapshot) {
          saved = JSON.parse(await dump({ snapshot: snapshot as RunSnapshot }));
          release();
        }
      }
    });
    expect(saved).toBeDefined();
    return { result, saved: saved!, calls };
  } finally {
    release();
    clock.mockRestore();
  }
}

describe("public raw native Promise alias memoization", () => {
  it("retains the unchanged original alias source", () => {
    expect(createHash("sha256").update(aliasSource).digest("hex")).toBe(
      "784f6eb021150c6c0d83365061cea4db1cc53d2504e643900aff633d178347be"
    );
  });

  it.each(
    (["arguments", "bindings", "imports", "importMeta"] as const).flatMap((placement) =>
      [false, true].map((pending) => ({ placement, pending }))
    )
  )(
    "preserves identity and one input journal row in $placement (pending: $pending)",
    async ({ placement, pending }) => {
      const anchor = await native(aliasSource, aliasFixture(pending), placement);
      expect(anchor.value).toEqual({
        promiseAlias: true,
        value: 7,
        sameHandle: true,
        sameAlias: true,
        markerVisible: true
      });
      const { source, inputs } = place(aliasSource, aliasFixture(pending), placement);
      const result = await run(source, inputs);
      expect(result).toMatchObject({ ok: true, returnValue: anchor.value });
      const snapshot = JSON.parse(await dump(result)) as RunSnapshot;
      expect(snapshot.replay?.calls.filter((call) => call.moduleId === "<inputs>")).toMatchObject([
        { lifecycle: "consumed", outcome: { status: "fulfilled" } }
      ]);
      const provider = vi.fn();
      const resumed = await run(source, {
        snapshot: restore(snapshot, { source }),
        hostCallResumeProvider: provider
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(resumed.snapshot.initialInputs).toEqual(result.snapshot.initialInputs);
      expect(resumed.snapshot.replay).toEqual(result.snapshot.replay);
      expect(resumed.snapshot.promiseReplay).toEqual(result.snapshot.promiseReplay);
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    "matches the full native workflow and restores both inputs (pending: %s)",
    async (pending) => {
      const anchor = await native(fullSource, fullFixture(pending));
      expect(anchor.value).toMatchObject({ balance: 13, promiseAliases: [true, true, true, true] });
      const first = await captureFull(pending);
      expect(first.result).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(first.result.ok && JSON.stringify(first.result.returnValue)).toBe(
        JSON.stringify(anchor.value)
      );
      expect(first.calls).toEqual(anchor.calls);
      expect(
        first.saved.replay?.calls.filter((call) => call.moduleId === "<inputs>")
      ).toMatchObject([
        { lifecycle: "settled", outcome: { status: "fulfilled" } },
        { lifecycle: "settled", outcome: { status: "fulfilled" } }
      ]);
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const provider = vi.fn();
      let saved = first.saved;
      for (let generation = 0; generation < 3; generation++) {
        const before = JSON.stringify(saved);
        const resumed = await run(fullSource, {
          snapshot: restore(saved, { source: fullSource }),
          bindings: { boundary: declareHostOperation(boundary, "re-issue") },
          hostCallResumeProvider: provider
        });
        expect(JSON.stringify(saved)).toBe(before);
        expect(resumed).toMatchObject({ ok: true, returnValue: anchor.value });
        expect(boundary.mock.calls.map(([label]) => label)).toEqual(
          generation === 0 ? anchor.calls : []
        );
        expect(provider).not.toHaveBeenCalled();
        expect(resumed.snapshot.initialInputs).toEqual(first.result.snapshot.initialInputs);
        expect(JSON.stringify(resumed.snapshot.initialInputs)).toBe(
          JSON.stringify(first.result.snapshot.initialInputs)
        );
        expect(resumed.snapshot.replay).toEqual(first.result.snapshot.replay);
        expect(resumed.snapshot.promiseReplay).toEqual(first.result.snapshot.promiseReplay);
        saved = JSON.parse(await dump(resumed));
        boundary.mockClear();
      }
    }
  );

  it.each(["arguments", "bindings"] as const)(
    "memoizes across arrays, maps, sets and cycles in %s",
    async (placement) => {
      const source = `export default async fixture => {
      const input = fixture === undefined ? incoming : fixture;
      return [input.primary === input.array[0], input.primary === input.map.get('input'),
        input.primary === [...input.set][0], input.self === input,
        (await input.primary) === (await input.array[0])];
    };`;
      const input = Promise.resolve({ value: 7 });
      const fixture: Record<string, unknown> = {
        primary: input,
        array: [input],
        map: new Map([["input", input]]),
        set: new Set([input])
      };
      fixture.self = fixture;
      const anchor = await native(source, fixture, placement);
      expect(anchor.value).toEqual([true, true, true, true, true]);
      const current = place(source, fixture, placement);
      const result = await run(current.source, current.inputs);
      expect(result).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(
        result.snapshot.replay?.calls.filter((call) => call.moduleId === "<inputs>")
      ).toHaveLength(1);
    }
  );

  it.each(["arguments", "bindings"] as const)(
    "shares a rejected input and its reason in %s",
    async (placement) => {
      const source = `export default async fixture => {
      const input = fixture === undefined ? incoming : fixture;
      const first = await input.primary.catch(reason => reason);
      first.seen = true;
      const again = await input.again.catch(reason => reason);
      return [input.primary === input.again, first === again, again.seen === true];
    };`;
      const input = Promise.reject({ value: 7 });
      const fixture = { primary: input, again: input };
      const anchor = await native(source, fixture, placement);
      expect(anchor.value).toEqual([true, true, true]);
      const current = place(source, fixture, placement);
      const result = await run(current.source, current.inputs);
      expect(result).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(
        result.snapshot.replay?.calls.filter((call) => call.moduleId === "<inputs>")
      ).toHaveLength(1);
      const provider = vi.fn();
      const resumed = await run(current.source, {
        snapshot: restore(JSON.parse(await dump(result)), { source: current.source }),
        hostCallResumeProvider: provider
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it("keeps distinct Promise inputs distinct across runs", async () => {
    const fixture = {
      primary: Promise.resolve({ value: 7 }),
      again: Promise.resolve({ value: 7 })
    };
    const anchor = await native(aliasSource, fixture);
    expect(anchor.value).toMatchObject({
      promiseAlias: false,
      sameAlias: false,
      markerVisible: false
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await run(aliasSource, { entryPointArgs: [fixture] });
      expect(result).toMatchObject({ ok: true, returnValue: anchor.value });
      expect(
        result.snapshot.replay?.calls.filter((call) => call.moduleId === "<inputs>")
      ).toHaveLength(2);
    }
  });

  it.each(previousV7)(
    "preserves genuine pre-repair v7 $name history without relabeling",
    async (fixture) => {
      expect(fixture.snapshot.executionSemantics).toBe("jobs-v7");
      const before = JSON.stringify(fixture.snapshot);
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const provider = vi.fn();
      const result = await run(fixture.source, {
        snapshot: restore(fixture.snapshot, { source: fixture.source }),
        bindings: { boundary: declareHostOperation(boundary, "re-issue") },
        hostCallResumeProvider: provider
      });
      expect(result).toMatchObject({ ok: true, returnValue: fixture.expected });
      expect(result.snapshot.replay).toEqual(fixture.snapshot.replay);
      expect(result.snapshot.promiseReplay).toEqual(fixture.snapshot.promiseReplay);
      expect(result.snapshot.initialInputs).toEqual(fixture.snapshot.initialInputs);
      expect(JSON.stringify(fixture.snapshot)).toBe(before);
      expect(boundary).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    }
  );
});
