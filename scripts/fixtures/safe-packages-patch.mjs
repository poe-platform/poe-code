import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, createPatchCommand as rootFactory, FsError } from "@poe-platform/safe-bash";
import { createPatchCommand, createPatchCommands, patchCommands } from "@poe-platform/safe-bash/commands/patch";
import { CommandRegistry, commandRuntimeIdentity, getCommandArguments, FsError as ContractFsError } from "@poe-platform/safe-bash/contracts";

assert.equal(FsError, ContractFsError);
assert.equal(rootFactory, createPatchCommand);
assert.deepEqual(createPatchCommands().map(command => command.name), ["patch"]);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(patchCommands());
const encode = text => new TextEncoder().encode(text);
const read = async path => new TextDecoder().decode(await fs.readFile(path));
const patch = "--- file\n+++ file\n@@ -1 +1 @@\n-old\n+new\n";
try {
  await assert.rejects(fs.readFile("/missing"), error => error instanceof FsError && error.code === "ENOENT");
  const commands = new CommandRegistry();
  commands.register(createPatchCommand());
  assert.throws(() => patchCommands().setup({ commands }), /already registered/);
  patchCommands({ replace: true }).setup({ commands });
  assert.deepEqual(commands.list().map(command => command.name), ["patch"]);
  await fs.writeFile("/file", encode("old\n"));
  shell.register({ name: "patch-source", async execute(context) {
    await context.stdout.write(encode(patch));
    return { exitCode: 0 };
  } });
  const piped = await shell.exec("patch-source | patch --batch -b /file");
  assert.equal(piped.exitCode, 0, piped.stderr);
  assert.equal(await read("/file"), "new\n");
  assert.equal(await read("/file.orig"), "old\n");
  await fs.writeFile("/change.sh", encode("patch --batch -R /file <<'PATCH'\n" + patch + "PATCH\n"));
  const script = await shell.exec("sh /change.sh");
  assert.equal(script.exitCode, 0, script.stderr);
  assert.equal(await read("/file"), "old\n");
  await fs.writeFile("/change.patch", encode(patch));
  await fs.writeFile("/file", encode("unmatched\n"));
  const failed = await shell.exec("patch --batch /file < /change.patch");
  assert.notEqual(failed.exitCode, 0);
  assert.equal(await read("/file"), "unmatched\n");
  assert.match(await read("/file.rej"), /new/);
  await fs.writeFile("/file", encode("old\n"));
  let bytes;
  const command = createPatchCommand();
  shell.register({ name: "witness", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    bytes = getCommandArguments(context).bytes(0);
    return command.execute(context);
  } });
  const witnessed = await shell.exec("patch-source | witness /file");
  assert.equal(witnessed.exitCode, 0, witnessed.stderr);
  assert.deepEqual(bytes, encode("/file"));
  shell.register({ name: "raw-byte", async execute(context) {
    await context.stdout.write(Uint8Array.of(255));
    return { exitCode: 0 };
  } });
  const invalid = await shell.exec('witness "$(raw-byte)" < /change.patch');
  assert.deepEqual(bytes, Uint8Array.of(255));
  assert.notEqual(invalid.exitCode, 0);
  shell.use(patchCommands({ replace: true, maxInputBytes: 1 }));
  assert.notEqual((await shell.exec("patch-source | patch /file")).exitCode, 0);
  assert.equal(await read("/file"), "new\n");
  const controller = new AbortController();
  const reason = new Error("cancel patch");
  controller.abort(reason);
  await assert.rejects(shell.exec("patch /file", { signal: controller.signal }), error => error === reason);
  assert.equal(await read("/file"), "new\n");
} finally {
  await shell.dispose();
}
