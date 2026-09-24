import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { agentCommands, Shell, MockS3Client, S3FileSystem } from "../../../src/index.js";
import { collectBytes, toByteSource } from "../../../src/contracts/io.js";
import { isFsError } from "../../../src/contracts/errors.js";
import { createS3Transport } from "../../../src/fs/s3/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);

test("root agentCommands supports S3 reads, stdin gzip, same-view move and touch", async () => {
  const transport = new MockS3Client({ buckets: ["tools"] });
  const fs = new S3FileSystem({ transport, bucket: "tools" });
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  try {
    await fs.writeFile("/input", bytes("hello\n"));
    const result = await shell.exec("cat /input && sha256sum /input && gzip -c < /input > /input.gz && gzip -dc < /input.gz && touch /input");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `hello\n${createHash("sha256").update("hello\n").digest("hex")}  /input\nhello\n`);
    assert.deepEqual(gunzipSync(await fs.readFile("/input.gz")), Buffer.from("hello\n"));
    const moved = await shell.exec("mv /input /moved");
    assert.equal(moved.exitCode, 0, moved.stderr);
    assert.equal(moved.stderr, "");
    assert.equal(moved.stdout, "");
    assert.deepEqual(await fs.readFile("/moved"), bytes("hello\n"));
    await assert.rejects(fs.stat("/input"), error => isFsError(error, "ENOENT"));
    assert.deepEqual(await fs.readdir("/"), ["input.gz", "moved"].map(name => ({ name, type: "file" })));
    assert.equal(fs.capabilities.atomicRename, false);
  } finally { await shell.dispose(); }
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

test("root named-file gzip refuses unsupported S3 retained reads before acquiring or mutating entries", async () => {
  for (const decompress of [false, true]) {
    const transport = new MockS3Client({ buckets: ["tools"] });
    const fs = new S3FileSystem({ transport, bucket: "tools" });
    const shell = new Shell({ fs });
    shell.use(agentCommands());
    try {
      await fs.writeFile("/input", bytes("hello\n"));
      if (decompress) {
        const prepared = await shell.exec("gzip -c < /input > /input.gz");
        assert.equal(prepared.exitCode, 0, prepared.stderr);
        assert.deepEqual(gunzipSync(await fs.readFile("/input.gz")), Buffer.from("hello\n"));
        await fs.rm("/input");
      }
      const source = decompress ? "/input.gz" : "/input";
      const destination = decompress ? "/input" : "/input.gz";
      const sourceBytes = await fs.readFile(source);
      for (const command of [decompress ? "gzip -d /input.gz" : "gzip -k /input", decompress ? "gzip -dc /input.gz" : "gzip -c /input"]) {
        const requestCount = transport.requests.length;
        const result = await shell.exec(command);
        const commandRequests = transport.requests.slice(requestCount);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stderr, `gzip: ENOTSUP: named input requires retained VFS reads with stable scoped identities '${source}'\n`);
        assert.equal(result.stdout, "");
        assert.deepEqual(commandRequests.filter(request => !["headObject", "listObjectsV2"].includes(request.operation)), []);
        assert.deepEqual(await fs.readFile(source), sourceBytes);
        await assert.rejects(fs.stat(destination), error => isFsError(error, "ENOENT"));
        assert.deepEqual(await fs.readdir("/"), [{ name: source.slice(1), type: "file" }]);
      }
    } finally {
      await shell.dispose();
    }
  }
});
