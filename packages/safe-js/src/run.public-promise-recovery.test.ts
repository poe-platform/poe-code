import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Budget, declareHostOperation, dump, restore, run } from "./index.js";
import type { RunOptions, RunSnapshot } from "./run.js";
import { fullSource, singleSource } from "../test/fixtures/public-promise-inputs.js";

function fullFixture() {
  const left = Promise.resolve({
    name: "left",
    events: [
      { name: "open", delta: 3 },
      { name: "credit", delta: 5 }
    ]
  });
  const right = Promise.resolve({
    name: "right",
    events: [
      { name: "replace", delta: -2, replace: true },
      { name: "settle", delta: 7 }
    ]
  });
  return {
    order: ["left", "right"],
    primary: left,
    again: left,
    nested: { promise: left },
    remote: right,
    remoteAgain: right
  };
}

async function capture(source: string, inputs: RunOptions, onCaptured?: () => void) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let serialized: string | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: unknown[] = [];
  try {
    const result = await run(source, {
      ...inputs,
      budget: new Budget({ maxSteps: 15000, maxCallDepth: 48, dataSize: 500000 }),
      bindings: {
        ...inputs.bindings,
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
          serialized = await dump({ snapshot: snapshot as RunSnapshot });
          onCaptured?.();
          release();
        }
      }
    });
    expect(result.ok).toBe(true);
    expect(serialized).toBeTypeOf("string");
    return { result, saved: JSON.parse(serialized!), calls };
  } finally {
    release();
    clock.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("completed public raw Promise inputs", () => {
  it.each([
    {
      source: singleSource,
      hash: "21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8"
    },
    { source: fullSource, hash: "94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff" }
  ])("retains unchanged audited source $hash", ({ source, hash }) => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
  });

  it.each(["arguments", "bindings", "imports", "importMeta"] as const)(
    "restores one completed nonaliased raw Promise from %s without replacement inputs",
    async (placement) => {
      const fixture = { input: Promise.resolve({ value: 7 }) };
      const body = singleSource.slice("export default async fixture => {".length, -3);
      const cases = {
        arguments: { source: singleSource, inputs: { entryPointArgs: [fixture] } },
        bindings: {
          source: body,
          inputs: { bindings: { fixture } as unknown as RunOptions["bindings"] }
        },
        imports: {
          source: `import { fixture } from 'inputs'; ${body}`,
          inputs: { modules: { inputs: { fixture } } as unknown as RunOptions["modules"] }
        },
        importMeta: {
          source: `const fixture = import.meta.fixture; ${body}`,
          inputs: { importMeta: { fixture } }
        }
      };
      const { source, inputs } = cases[placement];
      const first = await capture(source, inputs);
      expect(first.result).toMatchObject({ ok: true, returnValue: { value: 7, sameHandle: true } });
      const inputCalls = first.saved.replay.calls.filter(
        (call: { moduleId: string }) => call.moduleId === "<inputs>"
      );
      expect(inputCalls).toHaveLength(1);
      expect(inputCalls[0]).toMatchObject({
        lifecycle: "settled",
        outcome: { status: "fulfilled" }
      });
      expect(
        first.saved.initialInputs.nodes
          .filter((node: { kind: string }) => node.kind === "capability")
          .map((node: { id: string }) => node.id)
      ).toEqual(['["bindings","boundary"]']);
      const snapshot = restore(first.saved, { source });
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const provider = vi.fn();
      const resumed = await run(source, {
        snapshot,
        bindings: { boundary: declareHostOperation(boundary, "re-issue") },
        hostCallResumeProvider: provider
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: { value: 7, sameHandle: true } });
      expect(boundary).toHaveBeenCalledExactlyOnceWith("before");
      expect(provider).not.toHaveBeenCalled();
      expect(resumed.snapshot.initialInputs).toEqual(first.result.snapshot.initialInputs);
      expect(resumed.snapshot.replay).toEqual(first.result.snapshot.replay);
      for (let iteration = 0; iteration < 2; iteration++) {
        boundary.mockClear();
        const repeated = await run(source, {
          snapshot: restore(JSON.parse(await dump(resumed)), { source }),
          bindings: { boundary: declareHostOperation(boundary, "re-issue") },
          hostCallResumeProvider: provider
        });
        expect(repeated).toMatchObject({ ok: true, returnValue: { value: 7, sameHandle: true } });
        expect(boundary).not.toHaveBeenCalled();
        expect(provider).not.toHaveBeenCalled();
      }
    }
  );

  it("restores the full unchanged scan without hiding separate raw alias differences", async () => {
    const first = await capture(fullSource, { entryPointArgs: [fullFixture()] });
    expect(first.result).toMatchObject({
      ok: true,
      returnValue: { balance: 13 }
    });
    const inputCalls = first.saved.replay.calls.filter(
      (call: { moduleId: string }) => call.moduleId === "<inputs>"
    );
    expect(inputCalls).not.toHaveLength(0);
    expect(inputCalls.every((call: { lifecycle: string }) => call.lifecycle === "settled")).toBe(
      true
    );
    const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
    const provider = vi.fn();
    const resumed = await run(fullSource, {
      snapshot: restore(first.saved, { source: fullSource }),
      bindings: { boundary: declareHostOperation(boundary, "re-issue") },
      hostCallResumeProvider: provider
    });
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: first.result.ok ? first.result.returnValue : undefined
    });
    expect(boundary.mock.calls.map(([label]) => label)).toEqual(first.calls);
    expect(provider).not.toHaveBeenCalled();
    expect(resumed.snapshot.initialInputs).toEqual(first.result.snapshot.initialInputs);
    expect(resumed.snapshot.replay).toEqual(first.result.snapshot.replay);
  });

  it("requires the saved callable path before reconciling input promises", async () => {
    const first = await capture(singleSource, {
      entryPointArgs: [{ input: Promise.resolve({ value: 7 }) }]
    });
    const provider = vi.fn();
    await expect(
      run(singleSource, {
        snapshot: restore(first.saved, { source: singleSource }),
        hostCallResumeProvider: provider
      })
    ).rejects.toThrow(/Missing replay capability/);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "refuses a pending input without a provider (replacement: %s)",
    async (replacement) => {
      let resolveInput!: (value: { value: number }) => void;
      const input = new Promise<{ value: number }>((resolve) => {
        resolveInput = resolve;
      });
      const first = await capture(singleSource, { entryPointArgs: [{ input }] }, () =>
        resolveInput({ value: 7 })
      );
      expect(
        first.saved.replay.calls.find((call: { moduleId: string }) => call.moduleId === "<inputs>")
      ).toMatchObject({ lifecycle: "running" });
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      await expect(
        run(singleSource, {
          snapshot: restore(first.saved, { source: singleSource }),
          bindings: { boundary: declareHostOperation(boundary, "re-issue") },
          ...(replacement ? { entryPointArgs: [{ input: Promise.resolve({ value: 99 }) }] } : {})
        })
      ).rejects.toMatchObject({
        name: "HostCallResumabilityError",
        action: "external-reconciliation",
        lifecycle: "running"
      });
      expect(boundary).toHaveBeenCalledExactlyOnceWith("before");
    }
  );
});
