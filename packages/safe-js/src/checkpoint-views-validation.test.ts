import { afterEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";

import { declareHostOperation, dump, FileSnapshotBackend, restore, run } from "./index.js";
import type { RunSnapshot } from "./run.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const source = `export default async input => {
  const state = { count: input.count, trace: [] };
  const alias = state;
  await exchange("done");
  try {
    await exchange("held");
    state.count += 1;
    return { count: state.count, same: alias === state, trace: state.trace };
  } finally {
    state.trace.push("cleanup");
  }
};`;

const expected = { count: 6, same: true, trace: ["cleanup"] };

afterEach(() => {
  vi.restoreAllMocks();
  vol.reset();
});

describe("checkpoint point-in-time persistence validation", () => {
  it.each(["complete", "cancel"] as const)(
    "retains serialized state and restores actual file bytes after %s",
    async (action) => {
      vol.mkdirSync("/snapshots");
      const clock = vi.spyOn(Date, "now").mockReturnValue(0);
      const backend = new FileSnapshotBackend("/snapshots/run.json");
      const gate = deferred<string>();
      const captured = deferred<{ snapshot: RunSnapshot; text: string; fileText: string }>();
      const calls: string[] = [];
      const controller = new AbortController();
      const exchange = declareHostOperation((label: string) => {
        calls.push(label);
        clock.mockReturnValue(calls.length * 2);
        return label === "held" ? gate.promise : Promise.resolve(label);
      }, "re-issue");
      const execution = run(source, {
        bindings: { exchange },
        entryPointArgs: [{ count: 5 }],
        signal: controller.signal,
        snapshotIntervalMs: 1,
        snapshotBackend: {
          read: backend.read.bind(backend),
          remove: backend.remove.bind(backend),
          async write(snapshot) {
            const current = snapshot as RunSnapshot;
            const text = await dump({ snapshot: current });
            await backend.write(snapshot);
            if (
              current.replay?.calls.length === 2 &&
              current.replay.calls.filter((call) => call.outcome !== undefined).length === 1
            ) {
              captured.resolve({
                snapshot: current,
                text,
                fileText: String(await fs.promises.readFile(backend.path, "utf8"))
              });
            }
          }
        }
      });
      const settled = execution.then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error })
      );
      try {
        const before = await captured.promise;
        const parsedBefore = JSON.parse(before.text) as RunSnapshot;
        expect(before.fileText).toBe(before.text);
        expect(before.snapshot.bindings.state).toMatchObject({ count: 5, trace: [] });
        expect(before.snapshot.bindings.alias).toBe(before.snapshot.bindings.state);
        expect(parsedBefore.heap).toBeDefined();
        const durable = structuredClone(parsedBefore);

        if (action === "cancel") {
          controller.abort(new DOMException("ordinary-user-stop", "AbortError"));
          expect((await settled).error).toMatchObject({
            name: "AbortError",
            message: "ordinary-user-stop"
          });
          gate.resolve("held");
        } else {
          gate.resolve("held");
          expect((await settled).result).toMatchObject({ ok: true, returnValue: expected });
        }
        expect(JSON.parse(before.text)).toEqual(durable);
        expect(calls).toEqual(["done", "held"]);
        const after = await backend.read();
        expect(after).toBeDefined();
        if (action === "complete") {
          expect(after).toEqual(parsedBefore);
        }
        expect(after!.replay).toEqual(parsedBefore.replay);
        expect(after!.initialInputs).toEqual(parsedBefore.initialInputs);
        expect(after!.promiseReplay).toEqual(parsedBefore.promiseReplay);

        for (const saved of [parsedBefore, after!]) {
          const resumedCalls: string[] = [];
          const replayed: string[] = [];
          const resumedOperation = declareHostOperation(
            async (label: string) => {
              resumedCalls.push(label);
              return label;
            },
            "re-issue",
            { onReplay: (args) => replayed.push(String(args[0])) }
          );
          const resumed = await run(source, {
            snapshot: restore(saved, { source }),
            signal: new AbortController().signal,
            bindings: { exchange: resumedOperation }
          });
          expect(resumed).toMatchObject({ ok: true, returnValue: expected });
          expect(resumedCalls).toEqual(["held"]);
          expect(replayed).toEqual(["done"]);
        }
      } finally {
        gate.resolve("held");
        await settled;
      }
    }
  );
});
