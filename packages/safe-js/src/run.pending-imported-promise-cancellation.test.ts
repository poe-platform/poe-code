import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run, type HostCallResumeProof, type HostCallResumeRequest } from "./index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(["fulfilled", "rejected"] as const)("cancels pending imported-Promise reconciliation before a late %s proof", async late => {
  const source = "const value=await input; boundary(); const result=await value.nested; after(); return result";
  const gate = deferred<number>();
  const paused = deferred<void>();
  const after = vi.fn();
  const boundary = declareHostOperation(() => { paused.resolve(); }, "re-issue");
  const bindings = { input: Promise.resolve({ nested: gate.promise }), boundary, after };
  const original = run(source, { bindings });
  void original.then(() => paused.resolve(), () => paused.resolve());
  let saved: string;
  try {
    await paused.promise;
    saved = await dump(original, { mode: "replay" });
  } finally {
    gate.resolve(7);
    await expect(original).resolves.toMatchObject({ ok: true, returnValue: 7 });
  }
  after.mockClear();
  const proof = deferred<HostCallResumeProof>();
  const requested = deferred<void>();
  let request!: HostCallResumeRequest;
  const provider = vi.fn((value: HostCallResumeRequest) => { request = value; requested.resolve(); return proof.promise; });
  const controller = new AbortController();
  const resumed = run(source, { snapshot: restore(JSON.parse(saved), { source }), bindings: { boundary, after },
    signal: controller.signal, hostCallResumeProvider: provider
  }).then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error }));
  void resumed.then(() => requested.resolve());
  try {
    await requested.promise;
    expect(provider).toHaveBeenCalledOnce();
    controller.abort(new Error("stop reconciliation"));
    const outcome = await Promise.race([resumed, new Promise(resolve => setImmediate(() => resolve("still pending")))]);
    expect(outcome).toMatchObject({ status: "rejected", error: { message: "stop reconciliation" } });
    expect(after).not.toHaveBeenCalled();
  } finally {
    controller.abort();
    if (late === "rejected") proof.reject(new Error("late provider failure"));
    else proof.resolve({ ...request, outcome: { status: "fulfilled", value: 7 } });
    await resumed;
  }
  await new Promise(resolve => setImmediate(resolve));
  expect(after).not.toHaveBeenCalled();
});
