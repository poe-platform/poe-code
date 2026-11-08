import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "../../src/contracts/index.js";
import { readZipArchive, makeZipEntry, setZipEntryComment, crc32 } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";
import { ZipCommentInput } from "../../src/commands/archive/zip/comments.js";

async function comments(fs: Awaited<ReturnType<typeof fixture>>, path = "/work/out.zip") {
  const archive = await readZipArchive(await fs.readFile(path), settings({}), new AbortController().signal);
  return { entries: archive.entries.map(entry => [entry.name, Buffer.from(entry.comment ?? []).toString()]), archive: Buffer.from(archive.comment).toString() };
}

for (const flag of ["-c", "--entry-comments", "--entry-c"]) {
  test(`zip ${flag} assigns one input line per selected entry and preserves cursor for archive comment`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-qz", flag, "out.zip", "binary", "folder/data"], {}, { stdin: toByteSource("one\ntwo\narchive\n.\n") });
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    assert.deepEqual(await comments(fs), { entries: [["binary", "one"], ["folder/data", "two"]], archive: "archive" });
  });
}

for (const [input, expected] of [["one\r\n", "one\r"], ["one", "one"], ["\n", ""], ["a\0b\n", "a"], [".\n", "."], ["café 🐯\n", "café 🐯"]]) {
  test(`zip entry comment uses native single-line grammar ${JSON.stringify(input)}`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-qc", "out.zip", "binary"], {}, { stdin: toByteSource(input!) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((await comments(fs)).entries, [["binary", expected]]);
  });
}

test("zip entry comment prompts follow archive order rather than operand order", async () => {
  const fs = await fixture(await archiveBytes([{ name: "b", body: Buffer.from("b") }, { name: "a", body: Buffer.from("a") }]));
  await fs.writeFile("/work/a", Buffer.from("a"));
  await fs.writeFile("/work/b", Buffer.from("b"));
  const result = await execute("zip", fs, ["-c", "sample.zip", "a", "b"], {}, { stdin: toByteSource("first\nsecond\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.toString().endsWith("Enter comment for b:\nEnter comment for a:\n"));
  assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["b", "first"], ["a", "second"]]);
});

for (const action of ["-u", "-f"]) {
  test(`zip ${action} comments current members without replacing payloads`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }]));
    await fs.utimes!("/work/binary", modified.getTime() - 1000, modified.getTime() - 1000);
    const result = await execute("zip", fs, ["-qc", action, "sample.zip"], {}, { stdin: toByteSource("new\n") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["binary", "new"]]);
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip"])).stdout.toString(), "old");
  });
}

test("zip entry comments leave unselected old member comments unchanged and retain old comment on EOF", async () => {
  const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("a") }, { name: "b", body: Buffer.from("b") }], entries => {
    for (const entry of entries) entry.comment = Buffer.from("old");
  }));
  await fs.writeFile("/work/a", Buffer.from("new"));
  const result = await execute("zip", fs, ["-qc", "sample.zip", "a"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["a", "old"], ["b", "old"]]);
});

test("zip entry comments input failure preserves original archive", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qc", "sample.zip", "binary"], { limits: { maxFilesFromBytes: 3 } }, { stdin: toByteSource("long\n") });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

for (const name of ["binary", "🐯.txt"]) {
  test(`zip entry comment retains raw non-UTF8 bytes with valid filename metadata for ${name}`, async () => {
    const fs = await fixture();
    if (name !== "binary") await fs.writeFile(`/work/${name}`, Buffer.from("tiger"));
    const result = await execute("zip", fs, ["-qc", "out.zip", name], {}, { stdin: toByteSource(Buffer.from([255, 10])) });
    assert.equal(result.exitCode, 0, result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
    assert.equal(archive.entries[0]!.name, name);
    assert.deepEqual(Buffer.from(archive.entries[0]!.comment!), Buffer.from([255]));
    assert.equal(archive.entries[0]!.flags! & 0x800, 0);
  });
}

test("zip comment-only -c with no selected members does not acquire stdin", async () => {
  const fs = await fixture();
  const stdin = { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { throw new Error("unused stdin acquired"); } };
  const result = await execute("zip", fs, ["-qc", "sample.zip"], {}, { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
});

test("zip changed entry comments remove stale Unicode comment extras while preserving opaque metadata", async () => {
  const limits = settings({});
  const entry = await makeZipEntry("a", Buffer.from("a"), { modified, mode: 0o100644, directory: false, symlink: false }, limits, new AbortController().signal);
  entry.comment = Buffer.from("old");
  const extra = Buffer.alloc(16);
  extra.writeUInt16LE(0x6375, 0);
  extra.writeUInt16LE(8, 2);
  extra[4] = 1;
  extra.writeUInt32LE(crc32(entry.comment), 5);
  extra.write("old", 9);
  extra.writeUInt16LE(0xbeef, 12);
  entry.centralExtra = extra;
  const changed = setZipEntryComment(entry, Buffer.from("new"), limits);
  assert.deepEqual(Buffer.from(changed.centralExtra!), extra.subarray(12));
  assert.deepEqual(Buffer.from(changed.comment!), Buffer.from("new"));
  assert.deepEqual(Buffer.from(entry.comment), Buffer.from("old"));
});

test("zip entry comment maximum length splits input like native fgets", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qc", "out.zip", "binary", "folder/data"], {}, { stdin: toByteSource("a".repeat(65535) + "tail\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.comment!.length, 65535);
  assert.equal(Buffer.from(archive.entries[1]!.comment!).toString(), "tail");
});

test("zip comment cursor owns unread bytes when host reuses an input chunk", async () => {
  const chunk = Buffer.from("one\ntwo\n");
  const source = { async *[Symbol.asyncIterator]() { yield chunk; } };
  const cursor = new ZipCommentInput(source, settings({}), new AbortController().signal);
  try {
    assert.deepEqual(Buffer.from((await cursor.readLine())!), Buffer.from("one\n"));
    chunk.fill(0);
    assert.deepEqual(Buffer.from((await cursor.readLine())!), Buffer.from("two\n"));
  } finally { await cursor.iterator.return?.(); }
});

for (const dates of [["-t", "2030-01-01"], ["-tt", "1980-01-01"], ["-t", "2030-01-01", "-tt", "1980-01-01"]]) {
  test(`zip entry comments ignore source date exclusions ${dates} while preserving payloads`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }]));
    const result = await execute("zip", fs, ["-quc", "sample.zip", ...dates], {}, { stdin: toByteSource("comment\n") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["binary", "comment"]]);
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip"])).stdout.toString(), "old");
  });
}

test("zip date-excluded comments still obey include and exclude name selection", async () => {
  const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }, { name: "folder/data", body: Buffer.from("kept") }]));
  const result = await execute("zip", fs, ["-quc", "sample.zip", "-t", "2030-01-01", "-i", "*", "@", "-x", "folder/*"], {}, { stdin: toByteSource("comment\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["binary", "comment"], ["folder/data", ""]]);
});

test("zip entry comments retain existing directory selection under -D", async () => {
  const fs = await fixture(await archiveBytes([{ name: "folder/", body: Buffer.alloc(0) }, { name: "binary", body: Buffer.from("old") }]));
  const result = await execute("zip", fs, ["-qucD", "sample.zip"], {}, { stdin: toByteSource("directory\nfile\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await comments(fs, "/work/sample.zip")).entries, [["folder/", "directory"], ["binary", "file"]]);
});
