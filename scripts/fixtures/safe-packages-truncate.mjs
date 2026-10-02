import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, createTruncateCommand as rootFactory, agentCommands } from "@poe-platform/safe-bash";
import { createTruncateCommand, truncateCommands } from "@poe-platform/safe-bash/commands/truncate";
import { createTruncateCommand as legacyFactory } from "@poe-platform/safe-bash/truncate";
import { CommandRegistry, createCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { FsError as FileSystemError } from "@poe-platform/safe-fs/core";
import { verifyTruncateCommands } from "./safe-packages-mixed-entry-runtime.mjs";

assert.throws(() => import.meta.resolve("safe-bash-command-truncate"), { code: "ERR_MODULE_NOT_FOUND" });
assert.equal(FsError, FileSystemError);
for (const factory of [rootFactory, legacyFactory, createTruncateCommand]) {
  assert.equal(factory().runtimeIdentity, commandRuntimeIdentity);
}
await verifyTruncateCommands();

const backing = createMemoryFileSystem();
const fs = new Proxy(backing, { get(target, key) {
  if (key === "stat") return async (...args) => {
    const stat = { ...await target.stat(...args) };
    delete stat.ioBlockSize;
    return stat;
  };
  const value = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
} });
const shell = new Shell({ fs }).use(agentCommands());
try {
  const commands = new CommandRegistry([rootFactory()]);
  const original = commands.get("truncate");
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => truncateCommands().setup(host), /already registered/);
  assert.equal(commands.get("truncate"), original);
  truncateCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("truncate"), original);
  shell.use(truncateCommands({ replace: true, ioBlockSize: () => 8, seekEnd: (path, stat, context) => { assert.equal(path, "/reference"); assert.equal(stat.type, "directory"); context.signal.throwIfAborted(); return 3; } }));
  await fs.writeFile("/resize.sh", new TextEncoder().encode("truncate -os2 /target; stat -c '%s' /target | cat"));
  const result = await shell.exec("sh /resize.sh");
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "16\n", ""]);
  await fs.writeFile("/�", Uint8Array.of(7));
  for (const byte of ["377", "376"]) {
    const result = await shell.exec(`truncate -s0 $'\\${byte}'`);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await fs.readFile("/�"), Uint8Array.of(7));
  }
  await fs.mkdir("/reference");
  const measured = await shell.exec("truncate -r /reference /measured");
  assert.equal(measured.exitCode, 0, measured.stderr);
  assert.equal((await fs.stat("/measured")).size, 3);
  const reason = new Error("packed truncate cancellation");
  const values = createCommandArguments(["-s0", "/target"]);
  await assert.rejects(createTruncateCommand().execute({
    command: "truncate", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
    signal: AbortSignal.abort(reason),
  }), error => error === reason);
  assert.equal((await fs.stat("/target")).size, 16);
} finally { await shell.dispose(); }
