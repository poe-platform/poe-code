import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { byteCommands } from "../../../src/commands/bytes/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { bytes, memory } from "./helpers.js";

test("binary seven-stage transcoding pipeline retains exact bytes and digest", async () => {
  const input = bytes(256 * 1024 + 13);
  const fs = await memory();
  const shell = new Shell({ fs, cwd: "/work", limits: { pipeHighWaterMark: 31 } }).use(standardCommands()).use(byteCommands());
  const result = await shell.exec("set -o pipefail; base64 -w13 | base64 -d | base32 -w17 | gzip -c | zcat | base32 -d | sha256sum", { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `${createHash("sha256").update(input).digest("hex")}  -\n`);
});

test("append redirection creates concatenated gzip members and verifiable checksums", async () => {
  const first = bytes(4097); const second = bytes(65537);
  const fs = await memory({ files: { first, second } });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(byteCommands());
  const result = await shell.exec("set -o pipefail; gzip -cn first > bundle.gz; gzip -cn second >> bundle.gz; gzip -t bundle.gz && zcat bundle.gz | tee restored | sha256sum; sha256sum restored > checks; sha256sum -c --strict checks");
  assert.equal(result.exitCode, 0, result.stderr);
  const joined = Buffer.concat([first, second]);
  assert.equal(result.stdout, `${createHash("sha256").update(joined).digest("hex")}  -\nrestored: OK\n`);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/restored")), joined);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/first")), first);
});

test("corrupt second gzip member propagates pipefail through byte encoders", async () => {
  const valid = gzipSync("valid"); const invalid = gzipSync("invalid"); invalid[invalid.length - 8] = invalid[invalid.length - 8]! ^ 1;
  const fs = await memory({ files: { "broken.gz": Buffer.concat([valid, invalid]) } });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(byteCommands());
  const result = await shell.exec("set -o pipefail; zcat broken.gz | base64 | base64 -d | sha256sum");
  assert.notEqual(result.exitCode, 0); assert.match(result.stderr, /zcat:/u);
  assert.match(result.stdout, /^[a-f0-9]{64} {2}-\n$/u);
});

test("expanding decompression respects Shell captured-output quota", async () => {
  const fs = await memory({ files: { "large.gz": gzipSync(Buffer.alloc(4 * 1024 * 1024, 65)) } });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(byteCommands());
  await assert.rejects(shell.exec("zcat large.gz | base64 -w0 | base64 -d", { limits: { maxOutputBytes: 1024 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.equal((await fs.lstat("/work/large.gz")).type, "file");
});

test("virtual file replacement refuses existing outputs until force is explicit", async () => {
  const fs = await memory({ files: { input: "original", "input.gz": "protected" } });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(byteCommands());
  const blocked = await shell.exec("gzip -k input");
  assert.notEqual(blocked.exitCode, 0); assert.equal(Buffer.from(await fs.readFile("/work/input.gz")).toString(), "protected");
  const result = await shell.exec("gzip -fk input && gunzip -t input.gz && zcat input.gz");
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "original");
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "original");
});

test("GNU unpadded decoder input composes through compression and checksums", async () => {
  const shell = new Shell({ fs: await memory(), cwd: "/work", limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(byteCommands());
  const actual = await shell.exec("set -o pipefail; printf Zg | base64 -d | gzip -c | zcat | base32 -w0 | base32 -d | sha256sum");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, "252f10c83610ebca1a059c0bae8255eba2f95be4d1d7bcfa89d7248a82d9f111  -\n");
});

test("GNU decoder partial bytes remain observable while pipefail rejects invalid pad bits", async () => {
  const shell = new Shell({ fs: await memory(), cwd: "/work", limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(byteCommands());
  const actual = await shell.exec("set -o pipefail; printf MZ====== | base32 -d | base64 -w0");
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stdout, "Zg==");
  assert.equal(actual.stderr, "base32: invalid input\n");
});
