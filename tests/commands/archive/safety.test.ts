import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RealFileSystem } from "../../../src/fs/real/index.js";
import { archive, binary, checksum, direct, directory, fixture, header, member, record, source, wrapped } from "./helpers.js";

const malformed: readonly [string, () => Uint8Array, RegExp][] = [
  ["empty", () => new Uint8Array(), /truncated/u],
  ["short header", () => header("file").subarray(0, 511), /truncated/u],
  ["missing terminators", () => member("file", binary), /truncated/u],
  ["single terminator", () => Buffer.concat([member("file"), Buffer.alloc(512)]), /truncated/u],
  ["body truncation", () => Buffer.concat([header("file", binary), binary.subarray(0, 100)]), /truncated/u],
  ["padding truncation", () => Buffer.concat([header("file", Uint8Array.of(7)), Uint8Array.of(7)]), /truncated/u],
  ["checksum", () => { const bytes = archive(member("file")); bytes[0] = 77; return bytes; }, /checksum/u],
  ["invalid octal", () => { const bytes = archive(member("file")); bytes[124] = 57; checksum(bytes); return bytes; }, /numeric/u],
  ["unsafe integer", () => { const bytes = archive(member("file")); bytes.fill(255, 124, 136); bytes[124] = 128; checksum(bytes); return bytes; }, /numeric/u],
  ["negative size", () => { const bytes = archive(member("file")); bytes.fill(255, 124, 136); checksum(bytes); return bytes; }, /numeric/u],
  ["unknown type", () => archive(member("file", new Uint8Array(), "Z")), /unsupported.*type/u],
  ["device", () => archive(member("file", new Uint8Array(), "3")), /unsupported.*type/u],
  ["fifo", () => archive(member("file", new Uint8Array(), "6")), /unsupported.*type/u],
  ["GNU sparse", () => archive(member("file", new Uint8Array(), "S")), /unsupported.*type/u],
  ["sized symlink", () => archive(member("file", Uint8Array.of(1), "2", "target")), /nonzero/u],
  ["unknown format", () => { const bytes = archive(member("file")); bytes.fill(0, 257, 265); checksum(bytes); return bytes; }, /unsupported.*format/u],
  ["nonzero trailing", () => Buffer.concat([archive(member("file")), Uint8Array.of(1)]), /trailing/u],
  ["truncated trailing record", () => Buffer.concat([archive(member("file")), Uint8Array.of(0)]), /trailing/u],
  ["PAX zero record", () => archive(member("pax", Buffer.from("0 path=x\n"), "x"), member("file")), /PAX/u],
  ["PAX wrong byte length", () => archive(member("pax", Buffer.from("11 path=雪\n"), "x"), member("file")), /PAX/u],
  ["PAX missing newline", () => archive(member("pax", Buffer.from("10 path=x!"), "x"), member("file")), /PAX/u],
  ["PAX oversize decimal", () => archive(member("pax", record("size", "999999999999999999999"), "x"), member("file")), /PAX/u],
  ["PAX bad timestamp", () => archive(member("pax", record("mtime", "Infinity"), "x"), member("file")), /PAX/u],
  ["PAX sparse keyword", () => archive(member("pax", record("GNU.sparse.map", "0,1"), "x"), member("file")), /unsupported PAX/u],
  ["PAX binary names", () => archive(member("pax", record("hdrcharset", "BINARY"), "x"), member("file")), /charset/u],
  ["orphan PAX", () => archive(member("pax", record("path", "renamed"), "x")), /orphan/u],
  ["invalid UTF8 name", () => { const bytes = archive(member("file")); bytes[0] = 255; checksum(bytes); return bytes; }, /UTF-8/u],
];

for (const [name, make, expected] of malformed) test(`malformed archive rejected: ${name}`, async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("tar tf -", { stdin: source(make(), 31) });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, expected);
  } finally { await shell.dispose(); }
});

for (const name of ["../escape", "a/../../escape", "/../escape", "a/../safe"]) test(`traversal cannot hide behind stripping or exclusion: ${name}`, async () => {
  const { fs, shell } = await fixture();
  try {
    for (const flags of ["", "--strip-components=2", "--exclude='*'"]) {
      const result = await shell.exec(`tar xf - -C /out ${flags}`, { stdin: archive(member(name, binary)) });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.match(result.stderr, /parent component/u);
      assert.equal((await fs.readdir("/out")).length, 0);
    }
  } finally { await shell.dispose(); }
});

test("absolute member stripping, ./ roots, and safe nested relative symlinks", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("./", new Uint8Array(), "5"), member("/absolute", binary), member("nested/link", new Uint8Array(), "2", "../absolute"));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /leading/u);
    assert.deepEqual(await fs.readFile("/out/absolute"), binary);
    assert.deepEqual(await fs.readFile("/out/nested/link"), binary);
  } finally { await shell.dispose(); }
});

for (const target of ["/work/outside", "../../work/outside"]) test(`escaping symlink target rejected: ${target}`, async () => {
  const { fs, shell } = await fixture();
  try {
    const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("link", new Uint8Array(), "2", target)) });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /escapes extraction/u);
    assert.equal((await fs.readdir("/out")).length, 0);
  } finally { await shell.dispose(); }
});

test("preexisting and newly-created symlink ancestors never receive payload writes", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/outside");
    await fs.mkdir("/out/safe");
    for (const target of ["/work/outside", "safe"]) {
      await fs.symlink!(target, "/out/link");
      const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("link/file", binary)) });
      assert.equal(result.exitCode, 2, result.stderr);
      await fs.rm("/out/link");
    }
    const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("link", new Uint8Array(), "2", "safe"), member("link/file", binary)) });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal((await fs.readdir("/work/outside")).length, 0);
    assert.equal((await fs.readdir("/out/safe")).length, 0);
  } finally { await shell.dispose(); }
});

test("symlink target chains cannot hide a preexisting escape or symlink-before-dotdot", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.symlink!("/work", "/out/escape");
    await fs.symlink!("escape", "/out/chain");
    for (const target of ["escape/file", "chain/file", "chain/../file"]) {
      const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("new", new Uint8Array(), "2", target)) });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.match(result.stderr, /escapes extraction|non-leading/u);
      await assert.rejects(fs.lstat("/out/new"), { code: "ENOENT" });
    }
  } finally { await shell.dispose(); }
});

test("safe nested symlink chains remain actual symlinks", async () => {
  const { fs, shell } = await fixture();
  try {
    const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("file", binary), member("link", new Uint8Array(), "2", "file"), member("nested/link", new Uint8Array(), "2", "../link")) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.lstat("/out/nested/link")).type, "symlink");
    assert.deepEqual(await fs.readFile("/out/nested/link"), binary);
  } finally { await shell.dispose(); }
});

test("explicit -C resolves its directory; unsafe hardlinks fail honestly", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.symlink!("/out", "/work/rootlink");
    assert.equal((await shell.exec("tar xf - -C rootlink", { stdin: archive(member("file", binary)) })).exitCode, 0);
    assert.deepEqual(await fs.readFile("/out/file"), binary);
    await fs.rm("/out/file");
    for (const target of ["../outside", "later", "hard"]) {
      const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("hard", new Uint8Array(), "1", target), member("later", binary)) });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal((await fs.readdir("/out")).length, 0);
    }
  } finally { await shell.dispose(); }
});

test("hardlink-only selection and stripped-away targets are not silently copied", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("file", binary), member("dir/hard", new Uint8Array(), "1", "file"));
    for (const flags of ["dir/hard", "--strip-components=1"]) {
      const result = await shell.exec(`tar xf - -C /out ${flags}`, { stdin: bytes });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal((await fs.readdir("/out")).length, 0);
    }
  } finally { await shell.dispose(); }
});

test("nonempty directory replacement fails without deleting children", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/out/dir");
    await fs.writeFile("/out/dir/keep", binary);
    const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("dir", Buffer.from("wrong"))) });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await fs.readFile("/out/dir/keep"), binary);
  } finally { await shell.dispose(); }
});

test("late corruption returns failure but does not promise rollback", async () => {
  const { fs, shell } = await fixture();
  try {
    const bad = header("bad"); bad[148] = 55;
    const result = await shell.exec("tar xf - -C /out", { stdin: Buffer.concat([member("accepted", binary), bad]) });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await fs.readFile("/out/accepted"), binary);
  } finally { await shell.dispose(); }
});

for (const [name, limits, bytes] of [
  ["member", { maxMembers: 1 }, archive(member("first"), member("second"))],
  ["entry", { maxEntryBytes: 4 }, archive(member("file", binary))],
  ["total", { maxTotalBytes: 4 }, archive(member("file", binary))],
  ["archive", { maxArchiveBytes: 1024 }, archive(member("file", binary))],
  ["path", { maxPathBytes: 3 }, archive(member("long"))],
  ["depth", { maxDepth: 1 }, archive(member("one/two/three"))],
  ["PAX", { maxPaxBytes: 4 }, archive(member("pax", record("path", "long"), "x"), member("file"))],
  ["text", { maxTextBytes: 2 }, archive(member("file"))],
] as const) test(`${name} limit rejects before unbounded allocation`, async () => {
  const { shell } = await fixture({ limits });
  try {
    const result = await shell.exec("tar tf -", { stdin: bytes });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /limit/u);
  } finally { await shell.dispose(); }
});

for (const kind of ["trailer", "truncated", "bomb", "wrong format"]) test(`gzip ${kind} fails and settles`, async () => {
  const { shell } = await fixture({ limits: { maxArchiveBytes: 32 * 1024 } });
  try {
    let bytes = gzipSync(kind === "bomb" ? Buffer.alloc(2 * 1024 * 1024) : archive(member("file", binary)));
    if (kind === "trailer") bytes[bytes.length - 8] = bytes[bytes.length - 8]! ^ 255;
    if (kind === "truncated") bytes = bytes.subarray(0, -5);
    if (kind === "wrong format") bytes = Buffer.from("BZh-not-gzip");
    const result = await shell.exec("tar tzf -", { stdin: source(bytes, 7) });
    assert.equal(result.exitCode, 2, result.stderr);
  } finally { await shell.dispose(); }
});

test("source short/long reads and post-read replacement cannot silently succeed", async () => {
  const { fs, shell } = await fixture();
  await shell.dispose();
  await fs.writeFile("/work/file", binary);
  for (const bytes of [binary.subarray(0, -1), Buffer.concat([binary, Uint8Array.of(1)])]) {
    const adapter = wrapped(fs, { readStream() { return source(bytes); } });
    const result = await direct(["cf", "-", "file"], adapter);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /source (grew|shrank)/u);
  }
  const adapter = wrapped(fs, { async *readStream() { yield binary; await fs.rm("/work/file"); await fs.writeFile("/work/file", binary); } });
  assert.equal((await direct(["cf", "-", "file"], adapter)).exitCode, 2);
});

test("input archive pathname and inode aliases cannot be overwritten during extraction", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("archive", binary));
    await fs.writeFile("/out/archive", bytes);
    const result = await shell.exec("tar xf /out/archive -C /out");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await fs.readFile("/out/archive"), new Uint8Array(bytes));
  } finally { await shell.dispose(); }
});

test("RealFS extraction stays inside selected virtual root and rejects host symlink ancestors", async () => {
  const temporary = await mkdtemp(join(directory, ".native-real-"));
  try {
    await mkdir(join(temporary, "root"));
    await mkdir(join(temporary, "outside"));
    await writeFile(join(temporary, "outside/keep"), binary);
    const { fs, shell } = await fixture({}, new RealFileSystem({ root: join(temporary, "root") }));
    try {
      await symlink(join(temporary, "outside"), join(temporary, "root/out/link"));
      const result = await shell.exec("tar xf - -C /out", { stdin: archive(member("link/keep", Buffer.from("wrong"))) });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(await readFile(join(temporary, "outside/keep")), Buffer.from(binary));
      await fs.writeFile("/work/file", binary);
      const roundtrip = await shell.exec("tar czf archive file; tar xzf archive -C /out");
      assert.equal(roundtrip.exitCode, 0, roundtrip.stderr);
      assert.deepEqual(await fs.readFile("/out/file"), binary);
    } finally { await shell.dispose(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
