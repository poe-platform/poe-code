import assert from "node:assert/strict";
import { Shell, CommandRegistry, createMemoryFileSystem, standardCommands, commandRuntimeIdentity, createCommandArguments, getCommandArguments, FsError } from "@poe-platform/safe-bash";
import { createYqCommand, yqCommands } from "@poe-platform/safe-bash/commands/yq";
import { commandRuntimeIdentity as contractIdentity, getCommandArguments as contractArguments } from "@poe-platform/safe-bash/contracts/command";
import { FsError as contractError } from "@poe-platform/safe-bash/contracts/errors";

assert.equal(createYqCommand().runtimeIdentity, commandRuntimeIdentity);
assert.equal(contractIdentity, commandRuntimeIdentity);
assert.equal(contractArguments, getCommandArguments);
assert.equal(contractError, FsError);
const fs = createMemoryFileSystem();
const encoder = new TextEncoder();
await fs.writeFile("/data.toml", encoder.encode("value = 2"));
await fs.writeFile("/run.sh", encoder.encode("yq -p toml -o json -c '.value + 0.1' /data.toml"));
const shell = new Shell({ fs }).use(standardCommands()).use(yqCommands());
try {
  assert.deepEqual(await shell.exec("sh /run.sh"), { exitCode: 0, stdout: "2.1\n", stderr: "", stdoutBytes: encoder.encode("2.1\n"), stderrBytes: new Uint8Array() });
  const piped = await shell.exec("printf 'items: [1, 2]\\n' | yq -o json -c '.items[]'");
  assert.equal(piped.exitCode, 0);
  assert.equal(piped.stdout, "1\n2\n");
  const argv = createCommandArguments(["-o", "json", "-c", "."]);
  assert.deepEqual(argv.bytes(3), encoder.encode("."));
  const original = createYqCommand();
  const registry = new CommandRegistry([original]);
  assert.throws(() => yqCommands().setup({ commands: registry }), /already registered/i);
  yqCommands({ replace: true }).setup({ commands: registry });
  assert.notEqual(registry.get("yq"), original);
  shell.use(yqCommands({ replace: true }));
  const controller = new AbortController();
  controller.abort(false);
  await assert.rejects(shell.exec("yq .", { signal: controller.signal }), reason => reason === false);
} finally { await shell.dispose(); }
console.log("Packed restricted yq: scripts, pipes, registration and canonical contracts verified");
