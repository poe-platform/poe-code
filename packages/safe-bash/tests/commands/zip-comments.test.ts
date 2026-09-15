import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "../../src/contracts/index.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";
import { archiveBytes, execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipComment } from "../../src/commands/archive/zip/comments.js";
import { setImmediate } from "node:timers/promises";

for (const [input, expected] of [
  ["hello\nworld\n.\nignored\n", "hello\r\nworld"], ["hello\n", "hello"],
  [".\n", ""], ["\n", "\r\n"], ["\n\n.\n", "\r\n\r\n"],
  ["hello\r\nworld\r\n.\r\n", "hello\r\r\nworld\r\r\n.\r"],
  [" hello \n..\n.\n", " hello \r\n.."], ["hello", "hello"], [".", "."],
  ["a\0b\nc\n.\n", "a\r\nc"], ["\0x\n.\n", "\r\n"],
  ["café 🐯\n.\n", "café 🐯"],
] as const) {
  test(`zip archive comment preserves native input semantics ${JSON.stringify(input)}`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-qz", "sample.zip"], {}, { stdin: toByteSource(input) });
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(Buffer.from(archive.comment), Buffer.from(expected));
  });
}

test("zip archive comment prints old raw comment and prompt before replacing it", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["--archive-comment", "sample.zip"], {}, { stdin: toByteSource("new\n.\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "current zip file comment is:\narchive comment\nenter new zip file comment (end with .):\n");
});

test("zip archive comments preserve invalid UTF-8 bytes", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qz", "sample.zip"], {}, { stdin: toByteSource(Buffer.from([255, 10, 46, 10])) });
  assert.equal(result.exitCode, 0, result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(Buffer.from(archive.comment), Buffer.from([255]));
});

test("zip archive comment can create an archive and streams only binary stdout", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-z", "-", "binary"], {}, { stdin: toByteSource("comment\n.\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  const archive = await readZipArchive(result.stdout, settings({}), new AbortController().signal);
  assert.deepEqual(Buffer.from(archive.comment), Buffer.from("comment"));
  assert.ok(result.stderr.endsWith("enter new zip file comment (end with .):\n"));
});

for (const args of [["-qz", "missing.zip"], ["-qz", "missing.zip", "missing"]]) {
  test(`zip archive comment cannot create a missing archive without selected members ${args}`, async () => {
    const fs = await fixture();
    assert.equal((await execute("zip", fs, args, {}, { stdin: toByteSource("new\n") })).exitCode, 12);
    await assert.rejects(fs.readFile("/work/missing.zip"));
  });
}

test("zip archive comment input limit failure leaves original bytes unchanged", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qz", "sample.zip"], { limits: { maxFilesFromBytes: 3 } }, { stdin: toByteSource("long\n") });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

for (const action of ["-d", "-U"]) {
  test(`zip archive comment is ignored by ${action} without consuming stdin`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("a") }]));
    const stdin = { async *[Symbol.asyncIterator]() { yield await Promise.reject<Uint8Array>(new Error("ignored stdin acquired")); } };
    const args = ["-qz", action, "sample.zip", "a", ...(action === "-U" ? ["-O", "out.zip"] : [])];
    const result = await execute("zip", fs, args, {}, { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

test("zip archive comment reader owns fragmented UTF-8 and stops at exact terminator", async () => {
  let closed = false;
  let pulls = 0;
  const source = { async *[Symbol.asyncIterator]() {
    try {
      for (const byte of Buffer.from("🐯\n.\n")) { pulls++; yield Uint8Array.of(byte); }
      throw new Error("read beyond terminator");
    } finally { closed = true; }
  } };
  assert.deepEqual(await readZipComment(source, settings({}), new AbortController().signal), Buffer.from("🐯"));
  assert.equal(pulls, 7);
  assert.equal(closed, true);
});

test("zip archive comment accepts format maximum and rejects overflow without truncation", async () => {
  // Inspired by CPython test_zipfile comment length and large-comment cases.
  const limits = settings({});
  assert.equal((await readZipComment(toByteSource("a".repeat(65535)), limits, new AbortController().signal)).length, 65535);
  await assert.rejects(readZipComment(toByteSource("a".repeat(65536)), limits, new AbortController().signal), /comment byte limit/);
  await assert.rejects(readZipComment(toByteSource("ab\ncd"), settings({ limits: { maxTextBytes: 5 } }), new AbortController().signal), /comment byte limit/);
});

test("zip archive comment empty chunk work is bounded", async () => {
  const source = { async *[Symbol.asyncIterator]() {
    for (let count = 0; count < 10; count++) yield new Uint8Array();
  } };
  await assert.rejects(readZipComment(source, settings({ limits: { maxPatternSteps: 2 } }), new AbortController().signal), /input work limit/);
});

test("zip archive comment prints original non-UTF8 bytes without replacing them in diagnostics", async () => {
  const fs = await fixture();
  const prior = await fs.readFile("/work/sample.zip");
  // Existing fixture comment ends the archive; replace it with same-sized bytes.
  prior[prior.length - 2] = 255;
  await fs.writeFile("/work/sample.zip", prior);
  const result = await execute("zip", fs, ["-z", "sample.zip"], {}, { stdin: toByteSource(".\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes(255));
});

test("zip archive comment pending read drains on cancellation and never publishes", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const controller = new AbortController();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const stdin = { async *[Symbol.asyncIterator]() { entered(); await held; yield Buffer.from("new\n"); } };
  const pending = execute("zip", fs, ["-qz", "sample.zip"], {}, { stdin, signal: controller.signal }).then(value => {
    settled = true;
    return value;
  }, error => { settled = true; return error; });
  try {
    await started;
    controller.abort(false);
    await setImmediate();
    assert.equal(settled, false);
  } finally { release(); }
  assert.equal(await pending, false);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

for (const flags of [["-u", "-z"], ["-f", "-z"]]) {
  test(`zip ${flags} changes comment even with no newer sources`, async () => {
    const fs = await fixture();
    for (const path of ["/work/binary", "/work/folder/data", "/work/folder"]) await fs.utimes!(path, 0, 0);
    const result = await execute("zip", fs, ["-q", ...flags, "sample.zip"], {}, { stdin: toByteSource("new\n.\n") });
    assert.equal(result.exitCode, 0, result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(Buffer.from(archive.comment), Buffer.from("new"));
  });
}

test("zip archive comment shares exhausted stdin with stdin member payload", async () => {
  const fs = await fixture();
  let acquired = 0;
  const body = Buffer.from([0, 255, 10, 46, 10]);
  const stdin = { async *[Symbol.asyncIterator]() { acquired++; yield body; } };
  const result = await execute("zip", fs, ["-qz", "-", "-"], {}, { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(acquired, 1);
  const archive = await readZipArchive(result.stdout, settings({}), new AbortController().signal);
  assert.equal(archive.comment.length, 0);
  await fs.writeFile("/work/stream.zip", result.stdout);
  assert.deepEqual((await execute("unzip", fs, ["-p", "stream.zip"])).stdout, body);
});

test("zip archive comment ignored action warnings match native output", async () => {
  for (const action of ["-d", "-U"]) {
    const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("a") }]));
    const result = await execute("zip", fs, ["-z", action, "sample.zip", "a", ...(action === "-U" ? ["-O", "out.zip"] : [])]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.toString().startsWith(action === "-d"
      ? "\tzip warning: invalid option(s) used with -d; ignored.\n"
      : "\tzip warning: can't set method, move, recurse, or comments with copy mode.\n"));
    assert.equal(result.stdout.toString().includes("enter new"), false);
  }
});
