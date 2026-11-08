import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run, type HostCallResumeRequest } from "./index.js";
import { Budget } from "./interp/budget.js";
import { deepCopyToSandbox } from "./interp/values.js";

it.each([
  { kind: "stringLength" as const, limit: 128, value: "x".repeat(128), accepted: true },
  { kind: "stringLength" as const, limit: 128, value: "x".repeat(129), accepted: false },
  { kind: "arrayLength" as const, limit: 64, value: Array.from({ length: 64 }, () => 1), accepted: true },
  { kind: "arrayLength" as const, limit: 64, value: Array.from({ length: 65 }, () => 1), accepted: false }
])("enforces future proof settlement limits %j", async ({ kind, limit, value, accepted }) => {
  let releaseOuter!: (value: { next: Promise<string> }) => void;
  const nested = new Promise<{ next: Promise<string> }>(resolve => { releaseOuter = resolve; });
  let outerReached!: () => void;
  const outerReady = new Promise<void>(resolve => { outerReached = resolve; });
  let innerReached!: () => void;
  const innerReady = new Promise<void>(resolve => { innerReached = resolve; });
  let replaying = false;
  const boundary = declareHostOperation((phase: string) => {
    if (phase === "outer") outerReached();
    if (phase === "inner" && replaying) innerReached();
  }, "re-issue");
  const after = vi.fn();
  const source = `const outer=await input;boundary('outer');const inner=await outer.nested;
    boundary('inner');const result=await inner.next;after();return result.length;`;
  const original = run(source, { bindings: { input: Promise.resolve({ nested }), boundary, after } });
  void original.then(() => outerReached(), () => outerReached());
  let saved: string;
  try { await outerReady; saved = await dump(original, { mode: "replay" }); }
  finally { releaseOuter({ next: Promise.resolve("ok") }); await expect(original).resolves.toMatchObject({ ok: true, returnValue: 2 }); }
  after.mockClear();
  replaying = true;
  let releaseFuture!: (value: string | number[]) => void;
  const next = new Promise<string | number[]>(resolve => { releaseFuture = resolve; });
  const provider = vi.fn((request: HostCallResumeRequest) => ({ ...request,
    outcome: { status: "fulfilled" as const, value: deepCopyToSandbox({ next }) } }));
  const controller = new AbortController();
  const resumed = run(source, { bindings: { boundary, after }, budget: new Budget({ [kind]: limit }),
    snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider, signal: controller.signal });
  const observation = resumed.then(result => ({ status: "fulfilled", ok: result.ok,
    returnValue: result.ok ? result.returnValue : undefined }), error => ({ status: "rejected", error }));
  void resumed.then(() => innerReached(), () => innerReached());
  try {
    await innerReady;
    expect(provider).toHaveBeenCalledOnce();
    releaseFuture(value);
    if (accepted) await expect(observation).resolves.toMatchObject({ status: "fulfilled", ok: true, returnValue: value.length });
    else await expect(observation).resolves.toMatchObject({ status: "rejected", error: { code: "budgetExceeded", budget: kind } });
    expect(after).toHaveBeenCalledTimes(accepted ? 1 : 0);
  } finally { releaseFuture(value); controller.abort(); await resumed.catch(() => undefined); }
});
