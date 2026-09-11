import assert from "node:assert/strict";
import test from "node:test";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { Shell } from "../../src/shell/shell.js";
import * as filesystem from "poe-code/safe-fs/core";

for (const reason of [false, 0, null, ""]) {
  test(`retained filesystem cleanup shares the operation counter after cancellation with ${String(reason)}`, () => {
    const controller = new AbortController();
    const budget = new Budget(resolveLimits({ maxFileSystemOperations: 2 }), controller.signal);
    try {
      budget.fileSystemOperation();
      controller.abort(reason);
      assert.throws(() => budget.fileSystemOperation(), error => Object.is(error, reason));
      budget.fileSystemCleanupOperation();
      assert.throws(() => budget.fileSystemCleanupOperation(), error => error instanceof ShellLimitError && error.limit === "maxFileSystemOperations");
      assert.equal(budget.signal.reason, reason);
    } finally { budget.close(); }
  });
}

test("retained filesystem cleanup cannot create extra ordinary operation capacity", () => {
  const budget = new Budget(resolveLimits({ maxFileSystemOperations: 2 }));
  try {
    budget.fileSystemCleanupOperation();
    budget.fileSystemOperation();
    assert.throws(() => budget.fileSystemOperation(), error => error instanceof ShellLimitError && error.limit === "maxFileSystemOperations");
  } finally { budget.close(); }
});

for (const reason of [false, 0, null, ""]) {
  test(`actual Shell retains owned cleanup while ordinary filesystem access rejects ${String(reason)}`, async () => {
    assert.equal(typeof filesystem.retainFileSystemCleanup, "function", "public SafeFS cleanup build prerequisite");
    const fs = filesystem.createMemoryFileSystem();
    const controller = new AbortController();
    const shell = new Shell({ fs });
    let calls = 0;
    await fs.writeFile("/owned", new Uint8Array([1]));
    await fs.writeFile("/outside", new Uint8Array([2]));
    shell.commands.register({ name: "cleanup-owned", async execute(context) {
      const close = filesystem.retainFileSystemCleanup(context.fs, async cleanup => {
        calls++;
        assert.equal((await cleanup.lstat("/owned")).type, "file");
        await cleanup.rm("/owned");
      }, { maxOperations: 2 });
      context.registerCleanup!(close);
      controller.abort(reason);
      await assert.rejects(context.fs.lstat("/outside"), error => Object.is(error, reason));
      await close();
      return { exitCode: 0 };
    } });
    try {
      await assert.rejects(shell.exec("cleanup-owned", { signal: controller.signal }), error => Object.is(error, reason));
      assert.equal(calls, 1);
      await assert.rejects(fs.lstat("/owned"), error => error instanceof filesystem.FsError && error.code === "ENOENT");
      assert.deepEqual(await fs.readFile("/outside"), Uint8Array.of(2));
      assert.equal((await shell.exec(":")).exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
