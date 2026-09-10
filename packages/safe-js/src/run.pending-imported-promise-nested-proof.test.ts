import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run, type HostCallResumeRequest } from "./index.js";
import { deepCopyToSandbox } from "./interp/values.js";

it.each(["pending", "completed"] as const)("replays a %s checkpoint containing a Promise introduced by a reconciliation proof", async mode => {
  let releaseOuter!: (value: { next: Promise<number> }) => void;
  const nested = new Promise<{ next: Promise<number> }>(resolve => { releaseOuter = resolve; });
  let reachedOuter!: () => void;
  const outerReady = new Promise<void>(resolve => { reachedOuter = resolve; });
  let reachedInner!: () => void;
  const innerReady = new Promise<void>(resolve => { reachedInner = resolve; });
  let resumedPhase = false;
  const boundary = declareHostOperation((phase: string) => {
    if (phase === "outer") reachedOuter();
    if (phase === "inner" && resumedPhase) reachedInner();
  }, "re-issue");
  const source = `const outer=await input; boundary('outer');
    const inner=await outer.nested; boundary('inner'); return await inner.next;`;
  const original = run(source, { bindings: { input: Promise.resolve({ nested }), boundary } });
  void original.then(() => reachedOuter(), () => reachedOuter());
  let saved: string;
  try { await outerReady; saved = await dump(original, { mode: "replay" }); }
  finally {
    releaseOuter({ next: Promise.resolve(1) });
    await expect(original).resolves.toMatchObject({ ok: true, returnValue: 1 });
  }
  let releaseInner!: (value: number) => void;
  const next = new Promise<number>(resolve => { releaseInner = resolve; });
  const provider = vi.fn((request: HostCallResumeRequest) => {
    const value = deepCopyToSandbox({ next });
    return { ...request, outcome: { status: "fulfilled" as const, value } };
  });
  resumedPhase = true;
  const controller = new AbortController();
  const resumed = run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider, signal: controller.signal });
  void resumed.then(() => reachedInner(), () => reachedInner());
  let pending: string;
  let didReach = false;
  try {
    const reached = await Promise.race([innerReady.then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))]);
    didReach = reached === true;
    expect(reached, "Guest must reach the inner checkpoint before its nested proof Promise settles").toBe(true);
    pending = await dump(resumed, { mode: "replay" });
  }
  finally {
    releaseInner(2);
    if (didReach) await expect(resumed).resolves.toMatchObject({ ok: true, returnValue: 2 });
    else { controller.abort(); await resumed.catch(() => undefined); }
  }
  expect(provider).toHaveBeenCalledOnce();
  const nextProvider = vi.fn((request: HostCallResumeRequest) => ({ ...request,
    outcome: { status: "fulfilled" as const, value: 3 } }));
  const result = await run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(mode === "pending" ? pending : await dump(await resumed)), { source }), hostCallResumeProvider: nextProvider });
  const expected = mode === "pending" ? 3 : 2;
  expect(result).toMatchObject({ ok: true, returnValue: expected });
  expect(nextProvider).toHaveBeenCalledTimes(mode === "pending" ? 1 : 0);
  if (mode === "pending") expect(nextProvider.mock.calls[0]![0].callId).not.toBe(provider.mock.calls[0]![0].callId);
  const unexpected = vi.fn();
  const completed = await run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(await dump(result)), { source }), hostCallResumeProvider: unexpected });
  expect(completed).toMatchObject({ ok: true, returnValue: expected });
  expect(unexpected).not.toHaveBeenCalled();
});
