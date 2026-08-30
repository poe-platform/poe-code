import assert from "node:assert/strict";
import test from "node:test";
import { diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { FsError } from "../../../../src/contracts/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { assertBytes, cwd, deferred, drain, instrument, memory, replacement, snapshot } from "./helpers.js";

test("Shell diff-to-patch pipeline treats Unicode/metacharacter labels literally", { timeout: 4000 }, async () => {
  const name = "café $(not-a-command);target";
  const backing = await memory({ old: "old\n", next: "new\n", [name]: "old\n", sentinel: "sentinel\n" });
  const observed = instrument(backing, { streaming: true });
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const result = await shell.exec(`diff -u --label 'a/${name}' --label 'b/${name}' old next | patch -p1`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  await assertBytes(backing, name, "new\n");
  await assertBytes(backing, "old", "old\n");
  await assertBytes(backing, "next", "new\n");
  await assertBytes(backing, "sentinel", "sentinel\n");
  assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), [["writeFile", `${cwd}/${name}`]]);
});

test("Shell heredoc unsafe later target cannot alter earlier files", async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const result = await shell.exec(`patch <<'SAFETY_PATCH'\n${replacement("first") + replacement("../second")}SAFETY_PATCH\n`);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /unsafe patch path/u);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

test("Shell dry-run reads explicit input outside cwd without any writes", async () => {
  const backing = await memory({ "nested/target": "old\n", changes: replacement() });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const shell = new Shell({ fs: observed.fs, cwd: `${cwd}/nested` }).use(diffPatchCommands());
  const result = await shell.exec("patch --dry-run -i ../changes");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

test("Shell preserves partial commit diagnostics and third-file bytes on injected EIO", async () => {
  const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
  const observed = instrument(backing, {
    before(call) { if (call.method === "writeFile" && call.path === `${cwd}/second`) throw new FsError("EIO"); },
  });
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const result = await shell.exec("patch", { stdin: replacement("first") + replacement("second") + replacement("third") });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /1\/3 files committed/u);
  await assertBytes(backing, "first", "new\n");
  await assertBytes(backing, "second", "old\n");
  await assertBytes(backing, "third", "old\n");
  assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/first`, `${cwd}/second`]);
});

test("Shell cancellation propagates exact reason during a blocked patch write", { timeout: 4000 }, async () => {
  const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
  const entered = deferred<void>();
  const blocked = deferred<void>();
  const controller = new AbortController();
  const reason = { source: "Shell integration abort" };
  let commandSignal: AbortSignal | undefined;
  const observed = instrument(backing, {
    async before(call) {
      if (call.method !== "writeFile" || call.path !== `${cwd}/second`) return;
      commandSignal = call.signal;
      entered.resolve();
      await blocked.promise;
    },
  });
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const rejected = assert.rejects(shell.exec("patch", { stdin: replacement("first") + replacement("second") + replacement("third"), signal: controller.signal }), error => error === reason);
  try {
    await entered.promise;
    controller.abort(reason);
    await rejected;
    assert(commandSignal?.aborted);
    assert.equal(commandSignal.reason, reason);
    await assertBytes(backing, "first", "new\n");
    await assertBytes(backing, "second", "old\n");
    await assertBytes(backing, "third", "old\n");
    assert.equal(observed.mutations().length, 2);
  } finally {
    controller.abort(reason);
    blocked.reject(new Error("late Shell write rejection"));
    await drain();
  }
});

test("Shell hardlink alias rejection does not truncate the alias or input", async () => {
  const backing = await memory({ first: "old\n", second: "old\n", changes: replacement("first") + replacement("second") });
  await backing.link(`${cwd}/second`, `${cwd}/alias`);
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const result = await shell.exec("patch <changes");
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /hard-linked/u);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});
