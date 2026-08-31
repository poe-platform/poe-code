import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, Shell, MockS3Client, S3FileSystem } from "../../../src/index.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import { isFsError } from "../../../src/contracts/errors.js";
import { createS3Transport } from "../../../src/fs/s3/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);

test("root agentCommands dispatches named reads, gzip, move, and existing-file touch on S3", async () => {
  const transport = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport, bucket: "tools" });
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  await fs.writeFile("/input", bytes("hello\n"));
  const result = await shell.exec("cat /input && sha256sum /input && gzip -c /input > /input.gz && gzip -dc /input.gz && mv /input /moved && touch /moved");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/moved"), bytes("hello\n"));
  await assert.rejects(fs.stat("/input"), error => isFsError(error, "ENOENT"));
  assert.equal(fs.capabilities.atomicRename, false);
});

test("stream transport reads ranges beyond the buffered budget without eager body materialization", async () => {
  const transport = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport, bucket: "tools", maxReadBytes: 2, maxStreamBytes: 10 });
  await fs.writeFile("/input", bytes("0123456789"));
  await assert.rejects(fs.readFile("/input"), error => isFsError(error, "EFBIG"));
  assert.ok(fs.readStream);
  const chunks: Uint8Array[] = [];
  for await (const chunk of fs.readStream("/input", { start: 3, endExclusive: 8, chunkSize: 2 })) chunks.push(chunk);
  assert.deepEqual(chunks.map(chunk => chunk.length), [2, 2, 1]);
  assert.deepEqual(await collectBytes((async function* () { yield* chunks; })(), { maxBytes: 5 }), bytes("34567"));
  chunks[0]!.fill(255);
  assert.deepEqual(await collectBytes(fs.readStream("/input"), { maxBytes: 10 }), bytes("0123456789"));
  assert.ok(fs.writeStream);
  await fs.writeStream("/streamed", toByteSource(bytes("abcdefghij")), { flag: "wx" });
  assert.deepEqual(await collectBytes(fs.readStream("/streamed"), { maxBytes: 10 }), bytes("abcdefghij"));
});

test("legacy buffered transports expose no misleading stream methods", async () => {
  const client = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport: createS3Transport(client), bucket: "tools", maxReadBytes: 4 });
  assert.equal(fs.capabilities.streamingRead, false);
  assert.equal(fs.capabilities.streamingWrite, false);
  assert.equal(fs.readStream, undefined);
  assert.equal(fs.writeStream, undefined);
  await fs.writeFile("/input", bytes("1234"));
  assert.deepEqual(await fs.readFile("/input"), bytes("1234"));
});

test("timestamps persist in object metadata and truncate preserves bytes and padding", async () => {
  const transport = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport, bucket: "tools" });
  await fs.writeFile("/input", bytes("abcdef"));
  await fs.utimes("/input", 1234, 5678);
  const reopened = new S3FileSystem({ transport, bucket: "tools" });
  assert.equal((await reopened.stat("/input")).atimeMs, 1234);
  assert.equal((await reopened.stat("/input")).mtimeMs, 5678);
  await reopened.truncate("/input", 3);
  assert.deepEqual(await reopened.readFile("/input"), bytes("abc"));
  await reopened.truncate("/input", 5);
  assert.deepEqual(await reopened.readFile("/input"), new Uint8Array([97, 98, 99, 0, 0]));
  assert.notEqual((await reopened.stat("/input")).mtimeMs, 5678);
});

test("root named-file gzip stages, publishes, preserves input with -k and removes input without -k", async () => {
  const transport = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport, bucket: "tools" });
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  await fs.writeFile("/input", bytes("hello\n"));
  const compressed = await shell.exec("gzip -k /input && gzip -dc /input.gz");
  assert.equal(compressed.exitCode, 0, compressed.stderr);
  assert.equal(compressed.stdout, "hello\n");
  assert.deepEqual(await fs.readFile("/input"), bytes("hello\n"));
  await fs.rm("/input");
  const decompressed = await shell.exec("gzip -d /input.gz");
  assert.equal(decompressed.exitCode, 0, decompressed.stderr);
  assert.deepEqual(await fs.readFile("/input"), bytes("hello\n"));
  assert.deepEqual(await fs.readdir("/"), [{ name: "input", type: "file" }]);
});
