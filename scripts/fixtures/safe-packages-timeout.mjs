import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, agentCommands, createTimeoutCommand, FsError } from "@poe-platform/safe-bash";
import { createTimeoutCommand as subpathFactory, timeoutCommands } from "@poe-platform/safe-bash/commands/timeout";
import { getCommandArguments, toByteSource } from "@poe-platform/safe-bash/contracts";
import { FsError as contractError } from "@poe-platform/safe-bash/contracts/errors";

assert.throws(() => import.meta.resolve("safe-bash-command-timeout"), { code: "ERR_MODULE_NOT_FOUND" });
assert.equal(createTimeoutCommand, subpathFactory);
assert.equal(FsError, contractError);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(agentCommands());
try {
  await fs.writeFile("/input", Uint8Array.of(255, 0, 254));
  await fs.writeFile("/timeout.sh", new TextEncoder().encode("timeout 0 cat /input | cat"));
  const result = await shell.exec("sh /timeout.sh");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual([...result.stdoutBytes], [255, 0, 254]);
  assert.equal((await shell.exec("timeout 0 sh -c 'exit 9'")).exitCode, 9);
  assert.throws(() => timeoutCommands().setup({ commands: shell.commands }), /already registered/);
  timeoutCommands({ replace: true }).setup({ commands: shell.commands });
  let inspected = false;
  shell.commands.register({ name: "inspect-bytes", async execute(context) {
    const values = getCommandArguments(context);
    assert.equal(values.args, context.args);
    assert.deepEqual([...values.bytes(0)], [255]);
    assert.deepEqual([...values.bytes(1)], [254]);
    assert.throws(() => getCommandArguments({ ...context, argumentValues: { ...values } }));
    inspected = true;
    return { exitCode: 7 };
  } });
  assert.equal((await shell.exec("timeout 0 inspect-bytes $'\\xff' $'\\xfe'")).exitCode, 7);
  assert.equal(inspected, true);
  const controller = new AbortController();
  const reason = new Error("timeout parent cancellation");
  controller.abort(reason);
  await assert.rejects(shell.exec("timeout 1 cat /input", { signal: controller.signal }), error => error === reason);
} finally { await shell.dispose(); }

const sink = { async write() {} };
const context = { command: "timeout", args: ["1", "child"], cwd: "/", env: {}, fs,
  stdin: toByteSource(""), stdout: sink, stderr: sink, signal: new AbortController().signal };
await assert.rejects(createTimeoutCommand({ limits: { maxArguments: 1 } }).execute(context), error => error instanceof FsError && error.code === "EFBIG");
let wake;
let now = 0;
let cleared = 0;
const timed = createTimeoutCommand({ scheduler: { now: () => now, setTimeout(callback) { wake = callback; return 0; }, clearTimeout() { cleared++; } } });
assert.equal((await timed.execute({ ...context, async invoke(_command, _args, options) {
  now = 1000;
  wake();
  throw options.signal.reason;
} })).exitCode, 124);
assert.equal(cleared, 1);
console.log("timeout packed consumer passed");
