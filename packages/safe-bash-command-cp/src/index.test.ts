import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, commandRuntimeIdentity, createCommandArguments, getCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createCpCommand, createCpCommands, cpCommands } from "./index.js";

async function context(args: string[]): Promise<CommandContext> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/source/nested", { recursive: true });
  await fs.writeFile("/source/nested/file", new Uint8Array([255, 0, 254]));
  const carrier = createCommandArguments(args);
  return { command: "cp", args: carrier.args, argumentValues: carrier, fs, cwd: "/", env: {},
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal };
}

test("private factory retains canonical contracts and copies bytes", async () => {
  const invocation = await context(["/source/nested/file", "/copy"]);
  const definition = createCpCommand();
  assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(getCommandArguments(invocation), invocation.argumentValues);
  assert.equal((await definition.execute(invocation)).exitCode, 0);
  assert.deepEqual(await invocation.fs.readFile("/copy"), new Uint8Array([255, 0, 254]));
});

test("cp plugin rejects collisions and permits explicit replacement", () => {
  const commands = new CommandRegistry();
  const host = { commands, use() {}, registerFileSystem() {} };
  cpCommands().setup(host);
  const original = commands.get("cp");
  assert.throws(() => cpCommands().setup(host), /already registered/);
  assert.equal(commands.get("cp"), original);
  cpCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("cp"), original);
  assert.deepEqual(createCpCommands().map(command => command.name), ["cp"]);
});

for (const limits of [{ maxDirectoryEntries: 0 }, { maxRecursiveDirectoryDepth: 0 }]) {
  test(`cp enforces explicit limits before copying: ${JSON.stringify(limits)}`, async () => {
    const invocation = await context(["-R", "/source", "/copy"]);
    assert.equal((await createCpCommand({ limits }).execute(invocation)).exitCode, 1);
    await assert.rejects(invocation.fs.stat("/copy/nested/file"));
  });
}
for (const limit of [-1, 0.5, NaN]) test(`cp rejects invalid limit ${limit}`, () => {
  assert.throws(() => createCpCommand({ limits: { maxDirectoryEntries: limit } }), RangeError);
  assert.throws(() => createCpCommand({ limits: { maxRecursiveDirectoryDepth: limit } }), RangeError);
});

test("cp preserves cancellation reason identity", async () => {
  const invocation = await context(["/source/nested/file", "/copy"]);
  const controller = new AbortController();
  const reason = new Error("cancel cp");
  controller.abort(reason);
  await assert.rejects(async () => createCpCommand().execute({ ...invocation, signal: controller.signal }), error => error === reason);
});
