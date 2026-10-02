import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem, createZipCommand as rootFactory } from "@poe-platform/safe-bash";
import { createZipCommand, createZipCommands, zipCommands } from "@poe-platform/safe-bash/commands/zip";
import { FsError, getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";
import { FsError as directError } from "@poe-platform/safe-bash/contracts/errors";
import { shellValueBytes } from "@poe-platform/safe-bash/contracts/value";

assert.equal(FsError, directError);
assert.equal(rootFactory, createZipCommand);
assert.deepEqual(createZipCommands().map(command => command.name), ["zip"]);
const fs = createMemoryFileSystem();
const encode = value => new TextEncoder().encode(value);
await fs.writeFile("/input", Uint8Array.of(0, 255, 128, 10));
await fs.writeFile("/script.sh", encode("zip -q -0 /archive.zip /input; unzip -p /archive.zip | cat"));
const shell = new Shell({ fs }).use(agentCommands());
const command = createZipCommand({ zipHost: { entropy: length => new Uint8Array(length).fill(42) } });
let paired = false;
shell.use({ name: "zip-contract-witness", setup(host) {
  host.commands.register({ ...command, runtimeIdentity: commandRuntimeIdentity, execute(context) {
    const argv = getCommandArguments(context);
    if (context.args[0] === "-P") {
      assert.equal(argv, context.argumentValues);
      assert.deepEqual(argv.bytes(1), Uint8Array.of(255));
      assert.deepEqual(shellValueBytes(argv.values[1]), Uint8Array.of(255));
      paired = true;
    }
    return command.execute(context);
  } }, { replace: true });
  host.commands.register({ name: "raw-byte", async execute(context) {
    await context.stdout.write(Uint8Array.of(255));
    return { exitCode: 0 };
  } });
} });
try {
  const result = await shell.exec("sh /script.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(0, 255, 128, 10));
  const raw = await shell.exec('zip -P "$(raw-byte)" -q -0 /encrypted.zip /input');
  assert.equal(raw.exitCode, 0, raw.stderr);
  assert.ok(paired);
  const restored = await shell.exec('unzip -p -P "$(raw-byte)" /encrypted.zip');
  assert.equal(restored.exitCode, 0, restored.stderr);
  assert.deepEqual(restored.stdoutBytes, Uint8Array.of(0, 255, 128, 10));
  for (const method of ["deflate", "bzip2"]) {
    const zipped = await shell.exec(`zip -q -Z ${method} /${method}.zip /input`);
    assert.equal(zipped.exitCode, 0, zipped.stderr);
    const decoded = await shell.exec(`unzip -p /${method}.zip`);
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdoutBytes, Uint8Array.of(0, 255, 128, 10));
  }
  const aes = await shell.exec("zip --encryption aes-256-ae2 -P password -q -0 /aes.zip /input");
  assert.equal(aes.exitCode, 0, aes.stderr);
  const aesDecoded = await shell.exec("unzip -p -P password /aes.zip");
  assert.equal(aesDecoded.exitCode, 0, aesDecoded.stderr);
  assert.deepEqual(aesDecoded.stdoutBytes, Uint8Array.of(0, 255, 128, 10));
  // Independent ZIP_LZMA vector also used by the command's codec regression suite.
  await fs.writeFile("/lzma.zip", Uint8Array.from(atob("UEsDBD8AAgAOAIMYIliDFtyMFAAAAAEAAAABAAAAeAkEBQBdAACAAAA8Qfv////gAAAAUEsBAj8DPwACAA4AgxgiWIMW3IwUAAAAAQAAAAEAAAAAAAAAAAAAAIABAAAAAHhQSwUGAAAAAAEAAQAvAAAAMwAAAAAA"), character => character.charCodeAt(0)));
  const lzma = await shell.exec("unzip -p /lzma.zip x");
  assert.equal(lzma.exitCode, 0, lzma.stderr);
  assert.equal(lzma.stdout, "x");
  shell.use(zipCommands({ replace: true, limits: { maxArchiveBytes: 1 } }));
  const bounded = await shell.exec("zip -q -0 /bounded.zip /input");
  assert.notEqual(bounded.exitCode, 0);
  assert.ok(bounded.stderr.includes("limit"), bounded.stderr);
  await assert.rejects(fs.stat("/bounded.zip"), error => error instanceof FsError && error.code === "ENOENT");
} finally { await shell.dispose(); }
const collision = new Shell({ fs }).use(agentCommands()).use(zipCommands());
try { await assert.rejects(collision.exec(":"), /already registered/i); }
finally { await collision.dispose(); }
const controller = new AbortController();
const reason = new Error("packed zip cancellation");
controller.abort(reason);
await assert.rejects(() => createZipCommand().execute({ command: "zip", args: ["-q", "-0", "/cancelled.zip", "/input"], fs, cwd: "/", env: {},
  signal: controller.signal, stdin: (async function* () {})(),
  stdout: { async write() { assert.fail("cancelled output"); } },
  stderr: { async write() { assert.fail("cancelled diagnostic"); } },
}), error => error === reason);
console.log("Installed zip: binary scripts/pipes, byte passwords, contracts, limits, registration and cancellation passed");
