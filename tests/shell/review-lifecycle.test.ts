import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

test("signal-only upstream remains pending until the caller cancels", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const reason = new Error("caller cancels no-write producer");
  let consumed!: () => void;
  const consumerFinished = new Promise<void>(resolve => { consumed = resolve; });
  let upstreamAborted = false;
  let settled = false;
  commands.register({ name: "waiting", async execute({ signal }) {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    upstreamAborted = signal.aborted;
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  commands.register({ name: "consumer", execute() { consumed(); return { exitCode: 0 }; } });
  const execution = shell.exec("waiting | consumer", { signal: controller.signal });
  const rejected = assert.rejects(execution, error => error === reason);
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await consumerFinished;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(upstreamAborted, false);
  } finally { controller.abort(reason); }
  await rejected;
  assert.equal(upstreamAborted, true);
  await shell.dispose();
});

for (const limit of [0, 127, 128, 129, 256]) {
  test(`cooperative yielding preserves exact command budget ${limit}`, async () => {
    const { shell, fs, commands } = setup();
    let executed = 0;
    commands.register({ name: "count", execute() { executed++; return { exitCode: 0 }; } });
    try {
      await assert.rejects(shell.exec(`${"count;".repeat(limit)} : >after`, { limits: { maxCommands: limit } }),
        error => error instanceof ShellLimitError && error.limit === "maxCommands");
      assert.equal(executed, limit);
      assert.deepEqual(await fs.readdir("/"), []);
    } finally { await shell.dispose(); }
  });
}

test("cooperative yielding preserves the loop iteration budget", async () => {
  const { shell, commands } = setup();
  let executed = 0;
  commands.register({ name: "count", execute() { executed++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("while true; do count; done", { limits: { maxLoopIterations: 129 } }),
      error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
    assert.equal(executed, 129);
  } finally { await shell.dispose(); }
});
