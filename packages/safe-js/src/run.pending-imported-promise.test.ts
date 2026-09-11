import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run } from "./index.js";
import type { HostCallResumeRequest } from "./interp/host-call.js";

it.each(["fulfilled", "rejected"] as const)("reconciles an aliased pending Promise once with a %s outcome", async status => {
  let resolve!: (value: { message: string }) => void;
  let reject!: (reason: unknown) => void;
  const nested = new Promise<{ message: string }>((yes, no) => { resolve = yes; reject = no; });
  let reached!: () => void;
  const ready = new Promise<void>(yes => { reached = yes; });
  const boundary = declareHostOperation(() => { reached(); }, "re-issue");
  const source = `const value=await input; boundary();
    const read=p=>p.then(x=>x,e=>e);
    const first=await read(value.nested); const second=await read(value.again);
    return [value.nested===value.again,first===second,first.message]`;
  const execution = run(source, { bindings: { input: Promise.resolve({ nested, again: nested }), boundary } });
  void execution.catch(() => { reached(); });
  let saved: string;
  try {
    await ready;
    saved = await dump(execution, { mode: "replay" });
  } finally {
    const original = { message: "original" };
    if (status === "fulfilled") resolve(original);
    else reject(new Error("original"));
    await expect(execution).resolves.toMatchObject({ ok: true, returnValue: [true, true, "original"] });
  }
  const value = { message: "resumed" };
  const provider = vi.fn((request: HostCallResumeRequest) => ({
    callId: request.callId, sourceHash: request.sourceHash,
    moduleId: request.moduleId, operation: request.operation, argumentDigest: request.argumentDigest,
    outcome: status === "fulfilled" ? { status, value } : { status, reason: value }
  }));
  let result = await run(source, {
    bindings: { boundary }, snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider
  });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, "resumed"] });
  expect(provider).toHaveBeenCalledTimes(1);
  const completedProvider = vi.fn();
  result = await run(source, {
    bindings: { boundary }, snapshot: restore(JSON.parse(await dump(result)), { source }),
    hostCallResumeProvider: completedProvider
  });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, "resumed"] });
  expect(completedProvider).not.toHaveBeenCalled();
});

it.each(["input", "sync host", "async host"] as const)("checkpoints a pending Promise from %s and reconciles it without repeating its source", async mode => {
  let release!: (value: number) => void;
  const nested = new Promise<number>(resolve => { release = resolve; });
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const boundary = declareHostOperation(() => { reached(); }, "re-issue");
  const source = `const value=${mode === "input" ? "await input" : "await load()"}; boundary(); return await value.nested`;
  const load = vi.fn(() => mode === "async host" ? Promise.resolve({ nested }) : { nested });
  const replayLoad = vi.fn(() => { throw new Error("Original host loader must not run during replay"); });
  const replayBindings = mode === "input" ? { boundary } : { boundary, load: replayLoad };
  const execution = run(source, { bindings: {
    ...(mode === "input" ? { input: Promise.resolve({ nested }) } : { load }), boundary
  } });
  void execution.catch(() => { reached(); });
  let saved: string;
  try {
    await ready;
    saved = await dump(execution, { mode: "replay" });
  } finally {
    release(7);
    await expect(execution).resolves.toMatchObject({ ok: true, returnValue: 7 });
  }
  const provider = vi.fn((request: HostCallResumeRequest) => ({
    callId: request.callId, sourceHash: request.sourceHash,
    moduleId: request.moduleId, operation: request.operation,
    argumentDigest: request.argumentDigest,
    outcome: { status: "fulfilled" as const, value: 7 }
  }));
  const result = await run(source, {
    bindings: replayBindings, snapshot: restore(JSON.parse(saved), { source }),
    hostCallResumeProvider: provider
  });
  expect(result).toMatchObject({ ok: true, returnValue: 7 });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(mode === "input" ? 0 : 1);
  const completedProvider = vi.fn();
  const repeated = await run(source, {
    bindings: replayBindings, snapshot: restore(JSON.parse(await dump(result)), { source }),
    hostCallResumeProvider: completedProvider
  });
  expect(repeated).toMatchObject({ ok: true, returnValue: 7 });
  expect(completedProvider).not.toHaveBeenCalled();

  await expect(run(source, {
    bindings: replayBindings, snapshot: restore(JSON.parse(saved), { source })
  })).rejects.toMatchObject({ action: "external-reconciliation" });

  const mismatched = vi.fn((request: HostCallResumeRequest) => ({
    callId: `${request.callId}-wrong`, sourceHash: request.sourceHash,
    moduleId: request.moduleId, operation: request.operation,
    argumentDigest: request.argumentDigest,
    outcome: { status: "fulfilled" as const, value: 9 }
  }));
  await expect(run(source, {
    bindings: replayBindings, snapshot: restore(JSON.parse(saved), { source }),
    hostCallResumeProvider: mismatched
  })).rejects.toMatchObject({ action: "external-reconciliation" });
  expect(mismatched).toHaveBeenCalledTimes(1);
  expect(replayLoad).not.toHaveBeenCalled();
});
