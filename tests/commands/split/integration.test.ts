import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { S3FileSystem, MockS3Client } from "../../../src/fs/s3/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { agentCommands, createAgentCommands } from "../../../src/plugins/index.js";
import { splitCommands } from "../../../src/commands/split/index.js";
import { files, run } from "./helpers.js";

for (const backend of ["memory", "explicit-root-real"]) test(`${backend}: opt-in Shell byte pipeline and existing-file workflow`, async () => {
  const directory = backend === "explicit-root-real" ? await mkdtemp(fileURLToPath(new URL(".native-real-", import.meta.url))) : undefined;
  const fs = directory ? await createRealFileSystem({ root: directory }) : createMemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(splitCommands());
  try {
    const result = await shell.exec("printf '\\377\\000a\\nb\\nlast' | split -l1 - piece; cat pieceaa pieceab pieceac");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff00610a620a6c617374");
    const overwritten = await shell.exec("printf OLD > partaa; printf 'abcde' > input; split -b2 input part; cat partaa partab partac");
    assert.equal(overwritten.exitCode, 0, overwritten.stderr);
    assert.equal(overwritten.stdout, "abcde");
    const alias = await shell.exec("split -b1 input inpu");
    assert.equal(alias.exitCode, 0, alias.stderr);
    const same = await shell.exec("split -b1 partaa part");
    assert.equal(same.exitCode, 1);
    assert.match(same.stderr, /would overwrite input/);
    assert.equal(Buffer.from(await fs.readFile("/partaa")).toString(), "ab");
  } finally {
    await shell.dispose();
    if (directory) await rm(directory, { recursive: true });
  }
});

test("actual default registry contains 70 including split without duplicate installation", async () => {
  assert.equal(createAgentCommands().length, 70);
  assert.equal(createAgentCommands().some(command => command.name === "split"), true);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    assert.equal((await shell.exec("split")).exitCode, 0);
    assert.equal((await shell.exec("printf abc | split -b2")).exitCode, 0);
    assert.equal(shell.commands.list().length, 70);
  } finally { await shell.dispose(); }
});

test("plugin collision preflight and replacement use actual registry", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(splitCommands()).use(splitCommands());
  try { await assert.rejects(shell.exec("split"), /Command already registered: split/); }
  finally { await shell.dispose(); }
  const replacement = new Shell({ fs: createMemoryFileSystem() }).use(splitCommands()).use(splitCommands({ replace: true }));
  try { assert.equal((await replacement.exec("split", { stdin: "abc" })).exitCode, 0); }
  finally { await replacement.dispose(); }
});

test("shared shell pipe/output budget remains active beside VFS payload budget", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 4 } }).use(standardCommands()).use(splitCommands());
  try {
    await assert.rejects(shell.exec("printf abcdefghi | split -b2"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("explicit-root RealFS streaming large file reassembles bytes", async () => {
  const directory = await mkdtemp(fileURLToPath(new URL(".native-real-", import.meta.url)));
  const fs = await createRealFileSystem({ root: directory });
  try {
    const input = Buffer.alloc(4 * 1024 * 1024 + 9);
    for (let offset = 0; offset < input.length; offset++) input[offset] = offset % 256;
    await fs.writeFile("/input", input);
    const result = await run(["-b1M", "input", "part"], "", { limits: { maxBufferBytes: 16 } }, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = Buffer.concat(await Promise.all(["aa", "ab", "ac", "ad", "ae"].map(suffix => fs.readFile(`/part${suffix}`))));
    assert.deepEqual(output, input);
  } finally { await rm(directory, { recursive: true }); }
});

test("configured S3 mock supports streamed split and known-distinct overwrite", async () => {
  const client = new MockS3Client({ buckets: ["split-author"] });
  const fs = new S3FileSystem({ bucket: "split-author", transport: client });
  await fs.writeFile("/input", Buffer.from("abc\ndef\nghi"));
  await fs.writeFile("/xaa", Buffer.from("PREEXISTING"));
  const result = await run(["-l1", "input"], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(fs), { input: "6162630a6465660a676869", xaa: "6162630a", xab: "6465660a", xac: "676869" });
});
