import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommands, archiveCommands, CommandRegistry, createArchiveCommands,
  createMemoryFileSystem, Shell, type PluginHost,
} from "../../src/index.js";

test("archive factories expose tar, zip and unzip exactly once", () => {
  assert.deepEqual(createArchiveCommands().map(command => command.name), ["tar", "zip", "unzip"]);
});

for (const name of ["tar", "zip", "unzip"]) {
  test(`archive collision with ${name} leaves the registry untouched`, () => {
    const original = { name, execute: () => ({ exitCode: 19 }) };
    const commands = new CommandRegistry([original]);
    const host: PluginHost = { commands, use() {}, registerFileSystem() {} };
    const before = commands.list();
    assert.throws(() => archiveCommands().setup(host), /already registered/u);
    assert.deepEqual(commands.list(), before);
    archiveCommands({ replace: true }).setup(host);
    assert.deepEqual(commands.list().map(command => command.name).sort(), ["tar", "unzip", "zip"]);
  });
}

test("saved scripts create, update and extract binary ZIP data through the default plugin", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    await fs.mkdir("/work");
    const first = Uint8Array.from([0, 255, 128, 10, 13, 65]);
    await fs.writeFile("/work/first", first);
    await fs.writeFile("/work/second", new TextEncoder().encode("retained\n"));
    await fs.writeFile("/work/workflow.sh", new TextEncoder().encode(
      "zip archive first second\nprintf 'replaced\\n' > first\nzip archive first\nunzip -o -d extracted archive.zip\n",
    ));
    const result = await shell.exec("sh workflow.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/extracted/first"), new TextEncoder().encode("replaced\n"));
    assert.deepEqual(await fs.readFile("/work/extracted/second"), new TextEncoder().encode("retained\n"));
    await fs.writeFile("/work/first", first);
    const binary = await shell.exec("zip binary.zip first; unzip -o -d binary binary.zip");
    assert.equal(binary.exitCode, 0, binary.stderr);
    assert.deepEqual(await fs.readFile("/work/binary/first"), first);
  } finally { await shell.dispose(); }
});
