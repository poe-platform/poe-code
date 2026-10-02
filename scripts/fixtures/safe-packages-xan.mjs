import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem, createXanCommand as rootFactory, FsError as rootError } from "@poe-platform/safe-bash";
import { createXanCommand, createXanCommands, xanCommands, defaultLimits } from "@poe-platform/safe-bash/commands/xan";
import { FsError, getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";
import { shellValueBytes } from "@poe-platform/safe-bash/contracts/value";

assert.equal(rootFactory, createXanCommand);
assert.equal(rootError, FsError);
assert.deepEqual(createXanCommands().map(command => command.name), ["xan"]);
assert.ok(Object.values(defaultLimits).every(value => value === Infinity));
const fs = createMemoryFileSystem();
const encode = value => new TextEncoder().encode(value);
await fs.writeFile("/data.csv", encode("name,score\nbob,2\nalice,10\ncarol,2\n"));
await fs.writeFile("/script.sh", encode("xan sort -s score -N /data.csv | xan select name"));
const shell = new Shell({ fs }).use(agentCommands());
const command = createXanCommand();
const witnessed = [];
shell.use({ name: "xan-contract-witness", setup(host) {
  host.commands.register({ ...command, runtimeIdentity: commandRuntimeIdentity, execute(context) {
    if (context.args[0] === "search") {
      const argv = getCommandArguments(context);
      assert.equal(argv, context.argumentValues);
      const expected = witnessed.length === 0 ? 255 : 254;
      assert.deepEqual(argv.bytes(1), Uint8Array.of(expected));
      assert.deepEqual(shellValueBytes(argv.values[1]), Uint8Array.of(expected));
      witnessed.push(context.args[1]);
    }
    return command.execute(context);
  } }, { replace: true });
  host.commands.register({ name: "raw-byte", async execute(context) {
    await context.stdout.write(Uint8Array.of(Number(context.args[0])));
    return { exitCode: 0 };
  } });
} });
try {
  const result = await shell.exec("sh /script.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "name\nbob\ncarol\nalice\n");
  await shell.exec('xan search "$(raw-byte 255)" /data.csv');
  await shell.exec('xan search "$(raw-byte 254)" /data.csv');
  assert.equal(witnessed.length, 2);
  assert.equal(witnessed[0], witnessed[1], "distinct raw bytes share lossy presentation");
  const missing = await shell.exec("xan count /missing.csv");
  assert.equal(missing.exitCode, 1);
  assert.ok(missing.stderr.includes("ENOENT"), missing.stderr);
  shell.use(xanCommands({ replace: true, limits: { maxInputBytes: 4 } }));
  const bounded = await shell.exec("xan count /data.csv");
  assert.equal(bounded.exitCode, 1);
  assert.ok(bounded.stderr.includes("maxInputBytes"), bounded.stderr);
} finally { await shell.dispose(); }

const standalone = new Shell({ fs }).use(xanCommands());
try {
  const result = await standalone.exec("xan count /data.csv");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "3\n");
} finally { await standalone.dispose(); }
const collision = new Shell({ fs }).use(xanCommands()).use(xanCommands());
try { await assert.rejects(collision.exec(":"), /already registered/i); }
finally { await collision.dispose(); }

const controller = new AbortController();
const reason = new Error("packed xan cancellation");
controller.abort(reason);
await assert.rejects(() => command.execute({
  command: "xan", args: ["count"], fs, cwd: "/", env: {}, signal: controller.signal,
  stdin: (async function* () {})(),
  stdout: { async write() { assert.fail("cancelled output"); } },
  stderr: { async write() { assert.fail("cancelled diagnostic"); } },
}), error => error === reason);
console.log("Installed xan: public factories, scripts, pipes, contracts, limits, registration and cancellation passed");
