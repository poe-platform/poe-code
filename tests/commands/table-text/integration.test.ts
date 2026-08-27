import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommandRegistry, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { tableTextCommands, createTableTextCommands } from "../../../src/commands/table-text/index.js";
import { fixture, runTable } from "./helpers.js";

test("table plugin registers only missing names and preflights replacement atomically", () => {
  assert.deepEqual(createTableTextCommands().map(command => command.name), ["paste", "comm", "join"]);
  const original = { name: "join", execute: () => ({ exitCode: 23 }) };
  const host: PluginHost = { commands: new CommandRegistry([original]), use() {}, registerFileSystem() {} };
  assert.throws(() => tableTextCommands().setup(host), /already registered/u);
  assert.deepEqual(host.commands.list().map(command => command.name), ["join"]);
  tableTextCommands({ replace: true }).setup(host);
  assert.equal(host.commands.list().length, 3);
  assert.notEqual(host.commands.get("join")!.execute, original.execute);
});

for (const backend of ["memory", "real"] as const) {
  test(`${backend}: actual shell header/outer join/cut/paste pipeline`, async () => {
    const directory = backend === "real" ? await mkdtemp(join(tmpdir(), "safe-table-real-")) : undefined;
    const fs = directory ? await createRealFileSystem({ root: directory }) : createMemoryFileSystem();
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(tableTextCommands());
    try {
      const result = await shell.exec("printf 'id name\n1 alice\n2 bob\n' > people; printf 'id color\n1 red\n2 blue\n3 green\n' > colors; join --header -a2 -e '-' -o auto people colors | cut -d ' ' -f2,3 | paste -sd, -");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "name color,alice red,bob blue,- green\n");
      assert.equal(Buffer.from(await fs.readFile("/people")).toString(), "id name\n1 alice\n2 bob\n");
      assert.equal(Buffer.from(await fs.readFile("/colors")).toString(), "id color\n1 red\n2 blue\n3 green\n");
      const common = await shell.exec("printf 'b\na\n' | sort > first; printf 'c\nb\n' | sort > second; comm -12 first second | paste -sd, -");
      assert.equal(common.exitCode, 0, common.stderr); assert.equal(common.stdout, "b\n");
      const binary = await shell.exec("printf 'a\\000b\\000' | paste -z - -");
      assert.equal(binary.exitCode, 0, binary.stderr); assert.deepEqual(binary.stdoutBytes, Uint8Array.of(97, 9, 98, 0));
    } finally { await shell.dispose(); if (directory) await rm(directory, { recursive: true, force: true }); }
  });
}

test("readonly wrapper permits pure table composition without mutations", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/left", Buffer.from("a one\n")); await base.writeFile("/right", Buffer.from("a two\n"));
  const fs = createReadOnlyFileSystem(base);
  const shell = new Shell({ fs }).use(tableTextCommands());
  try {
    const result = await shell.exec("join /left /right");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "a one two\n");
    assert.equal((await base.readdir("/")).length, 2);
  } finally { await shell.dispose(); }
});

test("actual bounded downstream pipeline closes a large paste input", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/large", Buffer.from("line\n".repeat(100_000)));
  const shell = new Shell({ fs }).use(standardCommands()).use(tableTextCommands());
  try {
    const result = await shell.exec("paste /large | head -c 5", { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "line\n");
  } finally { await shell.dispose(); }
});

test("file byte streams preserve literal relative and symbolic VFS paths", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.symlink("./-literal", "/work/alias");
  const result = await runTable(fixture("paste", ["--", "alias", "./-literal"], { "-literal": "bytes\n" }), {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdoutHex, Buffer.from("bytes\tbytes\n").toString("hex"));
});

test("directory input fails without treating it as an empty file", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/work/directory");
  const result = await runTable(fixture("comm", ["directory", "right"], { right: "a\n" }), {}, { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /EISDIR/u); assert.equal(result.stdoutHex, "");
});
