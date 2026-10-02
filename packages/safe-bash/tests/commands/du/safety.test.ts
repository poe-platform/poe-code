import assert from "node:assert/strict";
import test from "node:test";
import { duCommands } from "../../../src/commands/du/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { seed, wrapped } from "./helpers.js";

const turn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test("actual Shell caller abort preserves reason and stops later DU metadata admission", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const controller = new AbortController(); const reason = new FsError("ENOSPC");
  let entered!: () => void, calls = 0, rejectHost!: (error: unknown) => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const fs = wrapped(base, { async lstat(_path, options) {
    calls++; assert.ok(options?.signal); entered();
    return new Promise((_resolve, reject) => { rejectHost = reject; });
  } });
  const shell = new Shell({ fs }).use(duCommands());
  try {
    const execution = shell.exec("du -bs tree", { signal: controller.signal });
    await admitted; controller.abort(reason);
    await assert.rejects(execution, error => error === reason);
    assert.equal(calls, 1); rejectHost(new Error("late public-boundary host failure")); await turn();
  } finally { await shell.dispose(); }
});
