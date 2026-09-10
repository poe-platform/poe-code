import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, createReadOnlyFileSystem, evaluateCommandSupport, Shell } from "../../src/index.js";

test("truncate support declaration accepts retained or atomic resizing and respects readonly policy", () => {
  const command = createAgentCommands().find(definition => definition.name === "truncate");
  assert.ok(command);
  for (const [capabilities, status] of [
    [{ retainedResize: true }, "supported"],
    [{}, "partial"],
    [{ retainedResize: false }, "partial"],
    [{ atomicResize: false }, "partial"],
    [{ retainedResize: false, atomicResize: false }, "unsupported"],
    [{ atomicResize: true }, "supported"],
    [{ retainedResize: false, atomicResize: true }, "supported"],
    [{ atomicResize: true, readOnly: true }, "unsupported"],
    [{ retainedResize: true, readOnly: true }, "unsupported"],
  ] as const) {
    const result = evaluateCommandSupport(command, capabilities);
    assert.equal(result.declared, true);
    assert.equal(result.status, status, JSON.stringify(capabilities));
  }
});

for (const route of ["factory", "plugin"] as const) {
  test(`truncate ${route} uses configured modes through direct, nested and VFS script workflows`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/existing", Uint8Array.of(1, 2, 3, 4, 5, 6), { mode: 0o620 });
    await fs.writeFile("/reference", Uint8Array.of(7, 8, 9));
    await fs.writeFile("/resize.sh", new TextEncoder().encode("truncate -r /reference /script-output\nstat -c '%a:%s' /script-output\n"));
    const options = { metadata: { umask: 0o027 } };
    const shell = new Shell({ fs, env: { LC_ALL: "C" }, commands: new CommandRegistry(route === "factory" ? createAgentCommands(options) : []) });
    if (route === "plugin") shell.use(agentCommands(options));
    try {
      const initial = await shell.exec("truncate -s9 /existing /new");
      assert.deepEqual([initial.exitCode, initial.stdout, initial.stderr], [0, "", ""]);
      assert.deepEqual(await fs.readFile("/existing"), Uint8Array.of(1, 2, 3, 4, 5, 6, 0, 0, 0));
      assert.deepEqual(await fs.readFile("/new"), new Uint8Array(9));
      assert.equal((await fs.stat("/existing")).mode & 0o777, 0o620);
      assert.equal((await fs.stat("/new")).mode & 0o777, 0o640);
      for (const [script, stdout] of [
        ["env truncate -s2 /existing; stat -c '%a:%s' /existing | cat", "620:2\n"],
        ["printf /new | xargs truncate -s+1; stat -c '%a:%s' /new", "640:10\n"],
        ["sh /resize.sh", "640:3\n"],
      ] as const) {
        const result = await shell.exec(script);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, stdout, ""], script);
      }
      assert.deepEqual(await fs.readFile("/script-output"), new Uint8Array(3));
      assert.equal(shell.commands.list().filter(command => command.name === "truncate").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("truncate aggregate forwards target and argument admission limits before later effects", async () => {
  for (const [limits, command, firstSize] of [
    [{ maxEntries: 1 }, "truncate -s0 /first /second", 0],
    [{ maxArgumentBytes: 4 }, "truncate -s0 /first", 3],
  ] as const) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/first", Uint8Array.of(1, 2, 3));
    await fs.writeFile("/second", Uint8Array.of(4, 5, 6));
    const shell = new Shell({ fs }).use(agentCommands({ metadata: { limits } }));
    try {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 1, result.stderr);
      assert.ok(result.stderr.startsWith("truncate: "), result.stderr);
      assert.ok(result.stderr.includes("limit"), result.stderr);
      assert.equal((await fs.stat("/first")).size, firstSize);
      assert.deepEqual(await fs.readFile("/second"), Uint8Array.of(4, 5, 6));
    } finally { await shell.dispose(); }
  }
});

test("truncate aggregate forwards the configured output limit", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ metadata: { limits: { maxOutputBytes: 12 } } }));
  try {
    const result = await shell.exec("truncate --help");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdoutBytes.byteLength + result.stderrBytes.byteLength <= 12);
  } finally { await shell.dispose(); }
});

test("truncate aggregate preserves explicit readonly policy and the original bytes", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/file", Uint8Array.of(1, 2, 3));
  const shell = new Shell({ fs: createReadOnlyFileSystem(backing), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("truncate -s0 /file");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [1, "", "truncate: cannot open '/file' for writing: Read-only file system\n"]);
    assert.deepEqual(await backing.readFile("/file"), Uint8Array.of(1, 2, 3));
  } finally { await shell.dispose(); }
});
