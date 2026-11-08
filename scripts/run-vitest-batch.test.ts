import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { runVitestBatch } from "./run-vitest-batch.mjs";

function fixture(response = { ok: true, files: ["/repo/src/a.test.ts"] }, code = 0) {
  const child = Object.assign(new EventEmitter(), { send: vi.fn(() => {
    queueMicrotask(() => { child.emit("message", response); child.emit("close", code, null); });
  }) });
  const fork = vi.fn(() => child);
  return { child, fork };
}
it("sends exact file identities to an isolated process and waits for its successful exit", async () => {
  const state = fixture();
  expect(await runVitestBatch("/repo", ["/repo/src/a.test.ts"], { fork: state.fork })).toEqual(["/repo/src/a.test.ts"]);
  expect(state.child.send).toHaveBeenCalledExactlyOnceWith({ root: "/repo", files: ["/repo/src/a.test.ts"] });
  expect(state.fork.mock.calls[0][2].stdio).toEqual(["inherit", "inherit", "inherit", "ipc"]);
});
it.each([
  [{ ok: false, error: "failed" }, 1],
  [{ ok: true, files: ["/foreign.ts"] }, 0],
  [{ ok: true, files: [] }, 0],
  [{ ok: true, files: ["/repo/src/a.test.ts"] }, 1],
  [undefined, 0]
])("rejects failed, incomplete or foreign batch results %#", async (response, code) => {
  const state = fixture(response, code);
  if (response === undefined) state.child.send.mockImplementation(() => { queueMicrotask(() => state.child.emit("close", code, null)); });
  await expect(runVitestBatch("/repo", ["/repo/src/a.test.ts"], { fork: state.fork })).rejects.toThrow();
});
it("preserves process startup failures", async () => {
  const failure = new Error("startup failed");
  await expect(runVitestBatch("/repo", ["/repo/src/a.test.ts"], { fork: () => { throw failure; } })).rejects.toBe(failure);
});
