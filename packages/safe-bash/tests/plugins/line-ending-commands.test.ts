import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

const expectedPrefix = [
  "true",
  "false",
  "echo",
  "pwd",
  "basename",
  "dirname",
  "printf",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "ln",
  "readlink",
  "realpath",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "tee",
  "tr",
  "sort",
  "uniq",
  "cut",
  "grep",
  "test",
  "[",
  "env",
  "xargs",
  "find",
  "cmp",
  "fmt",
  "shuf",
  "numfmt",
  "sed",
  "awk",
  "jq",
  "rg",
  "base64",
  "base32",
  "xxd",
  "od",
  "sha512sum",
  "sha384sum",
  "sha256sum",
  "sha224sum",
  "sha1sum",
  "md5sum",
  "cksum",
  "gzip",
  "gunzip",
  "zcat",
  "bzip2",
  "bunzip2",
  "bzcat",
  "xz",
  "unxz",
  "xzcat",
  "zstd",
  "unzstd",
  "zstdcat",
  "diff",
  "patch",
  "chmod",
  "stat",
  "mktemp",
  "truncate",
  "tar",
  "zip",
  "unzip",
  "paste",
  "comm",
  "join",
  "tac",
  "expand",
  "fold",
  "strings",
  "seq",
  "nl",
  "rev",
  "unexpand",
  "split",
  "date",
  "sleep",
  "printenv",
  "tree",
  "file",
  "egrep",
  "fgrep",
  "column",
  "html-to-markdown",
  "du",
  "expr",
  "which",
  "timeout",
  "apply_patch",
  "xq",
  "xmllint",
  "csplit",
  "pr",
  "tsort",
  "factor",
  "getopt",
  "hexdump",
  "hd",
  "iconv"
];
const limitNames = ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxOutputBytes", "maxBufferedBytes", "maxDiagnosticBytes", "maxFiles", "maxWork", "maxEmptyChunks", "maxPathBytes", "maxDepth", "maxTempAttempts", "chunkSize"] as const;

test("default line-ending commands append to the independent 108-command prefix", () => {
  const names = entry.createAgentCommands().map(command => command.name);
  assert.deepEqual(names, [...expectedPrefix, "dos2unix", "unix2dos"]);
  assert.equal(new Set(names).size, 110);
  for (const name of ["createDos2unixCommand", "createUnix2dosCommand", "createLineEndingCommands", "lineEndingCommands"]) assert.ok(name in entry, `Missing public export: ${name}`);
});

test("root and line-ending subpath retain all four factory identities", async () => {
  assert.equal(typeof entry.createDos2unixCommand, "function");
  const subpath = await import("../../src/commands/line-endings/index.js");
  assert.equal(entry.createDos2unixCommand, subpath.createDos2unixCommand);
  assert.equal(entry.createUnix2dosCommand, subpath.createUnix2dosCommand);
  assert.equal(entry.createLineEndingCommands, subpath.createLineEndingCommands);
  assert.equal(entry.lineEndingCommands, subpath.lineEndingCommands);
  assert.equal(entry.createDos2unixCommand().name, "dos2unix");
  assert.equal(entry.createUnix2dosCommand().name, "unix2dos");
  assert.deepEqual(entry.createLineEndingCommands().map(command => command.name), ["dos2unix", "unix2dos"]);
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.lineEndingCommands());
  try {
    const result = await shell.exec("dos2unix", { stdin: Uint8Array.of(65, 13, 10) });
    assert.deepEqual(shell.commands.list().map(command => command.name), ["dos2unix", "unix2dos"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(65, 10));
    assert.equal(result.stderrBytes.length, 0);
  } finally { await shell.dispose(); }
});

test("saved line-ending workflow preserves a BOM across in-place, new-file and stream conversion", async () => {
  const fs = entry.createMemoryFileSystem();
  const source = new TextEncoder().encode('dos2unix -q -b "$1" || exit "$?"\nunix2dos -q -b -n "$1" "$2" || exit "$?"\ncat "$1" | unix2dos -b > stream.bin || exit "$?"\ncat stream.bin | dos2unix -b\n');
  const input = Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 10);
  const unix = Uint8Array.of(239, 187, 191, 65, 10, 66, 10);
  const dos = Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 13, 10);
  await fs.mkdir("/work");
  await fs.writeFile("/work/saved.sh", source);
  await fs.writeFile("/work/input.bin", input);
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh saved.sh input.bin converted.bin");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, unix);
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readFile("/work/input.bin"), unix);
    assert.deepEqual(await fs.readFile("/work/converted.bin"), dos);
    assert.deepEqual(await fs.readFile("/work/stream.bin"), dos);
    assert.deepEqual(await fs.readFile("/work/saved.sh"), source);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name).sort(), ["converted.bin", "input.bin", "saved.sh", "stream.bin"]);
  } finally { await shell.dispose(); }
});

test("saved line-ending pipeline keeps high input bytes without text repair", async () => {
  const fs = entry.createMemoryFileSystem();
  const source = new TextEncoder().encode('dos2unix < "$1" | unix2dos\n');
  const input = Uint8Array.of(255, 65, 13, 10, 66, 10);
  await fs.mkdir("/work");
  await fs.writeFile("/work/raw.sh", source);
  await fs.writeFile("/work/input.bin", input);
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh raw.sh input.bin");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 65, 13, 10, 66, 13, 10));
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readFile("/work/input.bin"), input);
    assert.deepEqual(await fs.readFile("/work/raw.sh"), source);
  } finally { await shell.dispose(); }
});

test("the aggregate forwards every declared line-ending limit", () => {
  for (const name of limitNames) assert.throws(() => entry.createAgentCommands({ lineEndings: { limits: { [name]: 0 } } }), RangeError, name);
});

for (const command of ["dos2unix", "unix2dos"]) {
  test(`aggregate line-ending options limit ${command} without reading nested replace`, async () => {
    const options = { limits: { maxArguments: 1 } };
    Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replacement"); } });
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands({ lineEndings: options }));
    try {
      const result = await shell.exec(`${command} -q -b`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 1, stdout: "", stderr: `${command}: argument count limit exceeded\n` });
    } finally { await shell.dispose(); }
  });
}
