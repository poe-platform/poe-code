import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

test("the default public preset appends iconv and exposes its factories", () => {
  const names = entry.createAgentCommands().map(command => command.name);
  assert.equal(names.length, 108);
  assert.equal(new Set(names).size, 108);
  assert.deepEqual(names.slice(-3), ["hexdump", "hd", "iconv"]);
  for (const name of ["createIconvCommand", "createIconvCommands", "iconvCommands"]) assert.ok(name in entry, `Missing public export: ${name}`);
});

test("saved iconv VFS workflow roundtrips UTF-8 through UTF-16LE and Latin-1", async () => {
  const fs = entry.createMemoryFileSystem();
  const encoder = new TextEncoder();
  const input = encoder.encode("A\0éÿ\n");
  const source = encoder.encode('iconv -f UTF-8 -t UTF-16LE "$1" > utf16.bin || exit "$?"\niconv -f UTF-16LE -t Latin1 utf16.bin > latin1.bin || exit "$?"\niconv -f Latin1 -t UTF-8 latin1.bin\n');
  await fs.mkdir("/work");
  await fs.writeFile("/work/saved.sh", source);
  await fs.writeFile("/work/input.bin", input);
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh saved.sh input.bin");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, input);
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readFile("/work/utf16.bin"), Uint8Array.of(65, 0, 0, 0, 233, 0, 255, 0, 10, 0));
    assert.deepEqual(await fs.readFile("/work/latin1.bin"), Uint8Array.of(65, 0, 233, 255, 10));
    assert.deepEqual(await fs.readFile("/work/input.bin"), input);
    assert.deepEqual(await fs.readFile("/work/saved.sh"), source);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name).sort(), ["input.bin", "latin1.bin", "saved.sh", "utf16.bin"]);
  } finally { await shell.dispose(); }
});

test("saved C transliteration workflow keeps raw NUL and exact expansion bytes", async () => {
  const fs = entry.createMemoryFileSystem();
  const encoder = new TextEncoder();
  const input = encoder.encode("éß€\0㎯\n");
  const expected = encoder.encode("?ssEUR\0rad/s^2\n");
  const source = encoder.encode('iconv -f UTF-8 -t ASCII//TRANSLIT "$1" > "$2" || exit "$?"\ncat "$2"\n');
  await fs.mkdir("/work");
  await fs.writeFile("/work/saved.sh", source);
  await fs.writeFile("/work/input.bin", input);
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh saved.sh input.bin converted.bin");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, expected);
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readFile("/work/converted.bin"), expected);
    assert.deepEqual(await fs.readFile("/work/input.bin"), input);
    assert.deepEqual(await fs.readFile("/work/saved.sh"), source);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name).sort(), ["converted.bin", "input.bin", "saved.sh"]);
  } finally { await shell.dispose(); }
});

test("the aggregate forwards all nine iconv limits without nested replacement", async () => {
  const names = ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxChunks", "maxEmptyChunks"] as const;
  for (const name of names) assert.throws(() => entry.createAgentCommands({ iconv: { limits: { [name]: 0 } } }), RangeError);
  const options = { limits: { maxArguments: 1 } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands({ iconv: options }));
  try {
    const result = await shell.exec("iconv -f UTF-8");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 1, stdout: "", stderr: "iconv: argument count limit exceeded\n" });
  } finally { await shell.dispose(); }
});

test("public root and command subpath share iconv factory identity", async () => {
  assert.equal(typeof entry.createIconvCommand, "function");
  const subpath = await import("../../src/commands/iconv/index.js");
  assert.equal(entry.createIconvCommand, subpath.createIconvCommand);
  assert.equal(entry.createIconvCommands, subpath.createIconvCommands);
  assert.equal(entry.iconvCommands, subpath.iconvCommands);
  assert.deepEqual(entry.createIconvCommands().map(command => command.name), ["iconv"]);
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.iconvCommands());
  try {
    const result = await shell.exec("iconv -f Latin1 -t UTF-8", { stdin: Uint8Array.of(233, 0, 255) });
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(195, 169, 0, 195, 191));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderrBytes.length, 0);
  } finally { await shell.dispose(); }
});
