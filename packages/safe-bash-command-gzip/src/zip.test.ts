import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createGzipCommand } from "./index.js";
import { chunks, run } from "./test-helpers.js";

const payload = Buffer.from("single deflated ZIP member\n".repeat(100));
function zip(descriptor = false): Buffer {
  const compressed = deflateRawSync(payload);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(descriptor ? 8 : 0, 6);
  header.writeUInt16LE(8, 8);
  const fields = Buffer.alloc(12);
  const gzip = gzipSync(payload);
  fields.writeUInt32LE(gzip.readUInt32LE(gzip.length - 8));
  fields.writeUInt32LE(compressed.length, 4);
  fields.writeUInt32LE(payload.length, 8);
  if (!descriptor) fields.copy(header, 14);
  header.writeUInt16LE(5, 26);
  return Buffer.concat([header, Buffer.from("a.txt"), compressed,
    ...(descriptor ? [Buffer.from("504b0708", "hex"), fields] : []),
    Buffer.from("504b0102", "hex")]);
}

for (const descriptor of [false, true]) {
  for (const args of [["-dc"], ["-fdc"], ["-t"]]) {
    test(`gzip decodes ZIP (descriptor=${descriptor}, ${args}) at byte boundaries`, async () => {
      const result = await run("gzip", args, chunks(...Array.from(zip(descriptor), byte => Uint8Array.of(byte))));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, args[0] === "-t" ? Buffer.alloc(0) : payload);
    });
  }
}

test("forced gzip rejects corrupt or unsupported ZIP instead of passing it through", async () => {
  for (const offset of [6, 8, 14, 22]) {
    const bytes = zip();
    bytes[offset]! ^= 1;
    const result = await run("gzip", ["-fdc"], chunks(bytes));
    assert.equal(result.exitCode, 1);
    assert.notEqual(result.stderr, "");
  }
  const result = await run("gzip", ["-fdc"], chunks(zip().subarray(0, 32)));
  assert.equal(result.exitCode, 1);
});

test("ZIP decoding obeys the decoded byte budget, including test mode", async () => {
  for (const args of [["-dc"], ["-fdc"], ["-t"]]) {
    let written = 0;
    let error = "";
    const result = await createGzipCommand({ maxDecodedBytes: payload.length - 1 }).execute({
      command: "gzip", args, stdin: chunks(zip()), cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdout: { async write(bytes) { written += bytes.length; } },
      stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.ok(written < payload.length);
    assert.match(error, /decoded byte limit/u);
  }
});

test("forced gzip preserves plain input resembling ZIP signatures", async () => {
  for (const value of ["P", "PK", "PKx", "PKxxplain"]) {
    const result = await run("gzip", ["-fdc"], chunks(Buffer.from(value)));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), value);
  }
});

test("gunzip and zcat share ZIP decoding", async () => {
  for (const command of ["gunzip", "zcat"]) {
    const result = await run(command, [], chunks(zip()));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, payload);
  }
});
