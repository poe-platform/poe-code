import { expect, it, vi } from "vitest";
import { declareHostOperation, dump, restore, run, type HostCallResumeRequest } from "./index.js";

it("retains original properties across pending proof replacement and completed replay", async () => {
  let release!: (value: number) => void;
  const nested = Object.assign(new Promise<number>(resolve => { release = resolve; }), { data: { count: 0 } });
  Object.defineProperty(nested, "self", { value: nested });
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const boundary = declareHostOperation(() => { reached(); }, "re-issue");
  const load = vi.fn(() => ({ nested }));
  const source = "const value = await load(); const before = value.nested.data.count++; boundary(); return [before, value.nested.self === value.nested, await value.nested]";
  const execution = run(source, { bindings: { load, boundary } });
  void execution.then(() => reached(), () => reached());
  let saved: string;
  try {
    await ready;
    saved = await dump(execution, { mode: "replay" });
  } finally {
    release(7);
    await expect(execution).resolves.toMatchObject({ ok: true, returnValue: [0, true, 7] });
  }
  const provider = vi.fn((request: HostCallResumeRequest) => ({ ...request, outcome: { status: "fulfilled" as const, value: 9 } }));
  let result = await run(source, { bindings: { load, boundary }, snapshot: restore(JSON.parse(saved), { source }), hostCallResumeProvider: provider });
  expect(result).toMatchObject({ ok: true, returnValue: [0, true, 9] });
  expect(provider).toHaveBeenCalledOnce();
  const unexpected = vi.fn();
  result = await run(source, { bindings: { load, boundary }, snapshot: restore(JSON.parse(await dump(result)), { source }), hostCallResumeProvider: unexpected });
  expect(result).toMatchObject({ ok: true, returnValue: [0, true, 9] });
  expect(unexpected).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledOnce();
});
