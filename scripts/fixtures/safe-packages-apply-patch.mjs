import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, createApplyPatchCommand as rootFactory, FsError } from "@poe-platform/safe-bash";
import { createApplyPatchCommand, createApplyPatchCommands, applyPatchCommands } from "@poe-platform/safe-bash/commands/apply-patch";
import { CommandRegistry, commandRuntimeIdentity, getCommandArguments, FsError as ContractFsError } from "@poe-platform/safe-bash/contracts";

assert.equal(FsError, ContractFsError);
assert.equal(rootFactory, createApplyPatchCommand);
assert.deepEqual(createApplyPatchCommands().map(command => command.name), ["apply_patch"]);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(applyPatchCommands());
const patch = "*** Begin Patch\n*** Add File: /hello\n+hello\n*** End Patch\n";
try {
  const commands = new CommandRegistry();
  commands.register(createApplyPatchCommand());
  assert.throws(() => applyPatchCommands().setup({ commands }), /already registered/);
  applyPatchCommands({ replace: true }).setup({ commands });
  assert.deepEqual(commands.list().map(command => command.name), ["apply_patch"]);
  shell.use(applyPatchCommands({ replace: true }));
  shell.register({ name: "patch-source", async execute(context) {
    await context.stdout.write(new TextEncoder().encode(patch));
    return { exitCode: 0 };
  } });
  const piped = await shell.exec("patch-source | apply_patch");
  assert.equal(piped.exitCode, 0, piped.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/hello")), "hello\n");
  await fs.writeFile("/change.sh", new TextEncoder().encode("apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: /hello\n@@\n-hello\n+updated\n*** End Patch\nPATCH\n"));
  const script = await shell.exec("sh /change.sh");
  assert.equal(script.exitCode, 0, script.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/hello")), "updated\n");
  const failed = await shell.exec("apply_patch '*** Begin Patch\n*** Add File: /staged\n+staged\n*** Update File: /absent\n@@\n-old\n+new\n*** End Patch'");
  assert.notEqual(failed.exitCode, 0);
  await assert.rejects(fs.readFile("/staged"), error => error instanceof FsError && error.code === "ENOENT");
  let bytes;
  const command = createApplyPatchCommand();
  shell.register({ name: "witness", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    bytes = getCommandArguments(context).bytes(0);
    return command.execute(context);
  } });
  const witnessed = await shell.exec("witness '*** Begin Patch\n*** Add File: /argv\n+value\n*** End Patch'");
  assert.equal(witnessed.exitCode, 0, witnessed.stderr);
  assert.equal(new TextDecoder().decode(bytes), "*** Begin Patch\n*** Add File: /argv\n+value\n*** End Patch");
  shell.register({ name: "raw-byte", async execute(context) {
    await context.stdout.write(Uint8Array.of(255));
    return { exitCode: 0 };
  } });
  const invalid = await shell.exec('witness "$(raw-byte)"');
  assert.deepEqual(bytes, Uint8Array.of(255));
  assert.notEqual(invalid.exitCode, 0);
  shell.use(applyPatchCommands({ replace: true, limits: { maxPatchBytes: 1 } }));
  assert.notEqual((await shell.exec("patch-source | apply_patch")).exitCode, 0);
  shell.use(applyPatchCommands({ replace: true }));
  const controller = new AbortController();
  const reason = new Error("cancel patch");
  controller.abort(reason);
  await assert.rejects(shell.exec("apply_patch '*** Begin Patch\n*** Add File: /cancelled\n+x\n*** End Patch'", { signal: controller.signal }), error => error === reason);
  await assert.rejects(fs.readFile("/cancelled"), error => error instanceof FsError && error.code === "ENOENT");
} finally {
  await shell.dispose();
}
