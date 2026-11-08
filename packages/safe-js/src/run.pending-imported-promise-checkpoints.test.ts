import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run, type HostCallResumeRequest } from "./index.js";

it("preserves two distinct pending nodes and aliases across input outcomes", async () => {
  let first!: (value: number) => void;
  let second!: (value: number) => void;
  const one = new Promise<number>(resolve => { first = resolve; });
  const two = new Promise<number>(resolve => { second = resolve; });
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const boundary = declareHostOperation(() => { reached(); }, "re-issue");
  const source = `const a=await first; const b=await second; boundary();
    return [a.one===b.again,await a.one,await a.two,await b.again]`;
  const original = run(source, { bindings: { first: Promise.resolve({ one, two }),
    second: Promise.resolve({ again: one }), boundary } });
  void original.then(() => reached(), () => reached());
  let saved: string;
  try {
    await ready;
    saved = await dump(original, { mode: "replay" });
  } finally {
    first(1); second(2);
    await expect(original).resolves.toMatchObject({ ok: true, returnValue: [true, 1, 2, 1] });
  }
  const provider = vi.fn((request: HostCallResumeRequest) => ({ ...request,
    outcome: { status: "fulfilled" as const, value: provider.mock.calls.length * 10 } }));
  const result = await run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider });
  expect(result).toMatchObject({ ok: true, returnValue: [true, 10, 20, 10] });
  expect(provider).toHaveBeenCalledTimes(2);
  expect(new Set(provider.mock.calls.map(([request]) => request.callId)).size).toBe(2);
  const unexpected = vi.fn();
  const repeated = await run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(await dump(result)), { source }), hostCallResumeProvider: unexpected });
  expect(repeated).toMatchObject({ ok: true, returnValue: [true, 10, 20, 10] });
  expect(unexpected).not.toHaveBeenCalled();
});

it("keeps a reconciliation identity stable through another still-pending checkpoint", async () => {
  let release!: (value: number) => void;
  const nested = new Promise<number>(resolve => { release = resolve; });
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const boundary = declareHostOperation(() => { reached(); }, "re-issue");
  const source = "const value=await input; boundary(); return await value.nested";
  const original = run(source, { bindings: { input: Promise.resolve({ nested }), boundary } });
  void original.then(() => reached(), () => reached());
  let saved: string;
  try { await ready; saved = await dump(original, { mode: "replay" }); }
  finally { release(1); await expect(original).resolves.toMatchObject({ ok: true, returnValue: 1 }); }
  let requested!: () => void;
  const waiting = new Promise<void>(resolve => { requested = resolve; });
  let settle!: (value: number) => void;
  const proof = new Promise<number>(resolve => { settle = resolve; });
  const provider = vi.fn(async (request: HostCallResumeRequest) => {
    requested();
    return { ...request, outcome: { status: "fulfilled" as const, value: await proof } };
  });
  const resumed = run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider });
  void resumed.then(() => requested(), () => requested());
  let pending: string;
  try { await waiting; pending = await dump(resumed, { mode: "replay" }); }
  finally { settle(2); await expect(resumed).resolves.toMatchObject({ ok: true, returnValue: 2 }); }
  const finalProvider = vi.fn((request: HostCallResumeRequest) => ({ ...request,
    outcome: { status: "fulfilled" as const, value: 3 } }));
  const result = await run(source, { bindings: { boundary },
    snapshot: restore(JSON.parse(pending), { source }), hostCallResumeProvider: finalProvider });
  expect(result).toMatchObject({ ok: true, returnValue: 3 });
  expect(provider).toHaveBeenCalledOnce();
  expect(finalProvider).toHaveBeenCalledOnce();
  expect(finalProvider.mock.calls[0]![0]).toEqual(provider.mock.calls[0]![0]);
});
