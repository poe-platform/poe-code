import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { S3FileSystem, MockS3Client } from "../../../src/fs/s3/index.js";
import { archive, binary, checksum, direct, fixture, member, record, source, wrapped } from "./helpers.js";

for (const size of [0, 1, 511, 512, 513, 65537]) for (const gzip of [false, true]) test(`record boundary ${size}, ${gzip ? "gzip" : "plain"}, one-byte input fragments`, async () => {
  const { fs, shell } = await fixture();
  try {
    const payload = Uint8Array.from({ length: size }, (_value, index) => index % 256);
    const plain = archive(member("first", payload), member("second", binary));
    const result = await shell.exec(`tar x${gzip ? "z" : ""}f - -C /out`, { stdin: source(gzip ? gzipSync(plain) : plain, 1) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/first"), payload);
    assert.deepEqual(await fs.readFile("/out/second"), binary);
  } finally { await shell.dispose(); }
});

test("positive base-256 sizes and negative base-256 timestamps are parsed exactly", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("file", Uint8Array.of(9)));
    bytes.fill(0, 124, 136); bytes[124] = 128; bytes[135] = 1;
    bytes.fill(255, 136, 148); checksum(bytes);
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/file"), Uint8Array.of(9));
    assert.equal((await fs.stat("/out/file")).mtimeMs, -1000);
  } finally { await shell.dispose(); }
});

test("a leading UTF-8 BOM is filename data, not silently discarded", async () => {
  const { fs, shell } = await fixture();
  try {
    const name = "\ufefffile";
    const result = await shell.exec("tar xf - -C /out", { stdin: archive(member(name, binary)) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile(`/out/${name}`), binary);
    await fs.writeFile(`/work/${name}`, binary);
    const created = await shell.exec("tar cf - -T -", { stdin: `${name}\n` });
    assert.equal(created.exitCode, 0, created.stderr);
    assert.deepEqual((await shell.exec("tar tf -", { stdin: created.stdoutBytes })).stdoutBytes, new Uint8Array(Buffer.from(`${name}\n`)));
  } finally { await shell.dispose(); }
});

test("PAX size overrides the USTAR field without losing following record alignment", async () => {
  const { fs, shell } = await fixture();
  try {
    const data = member("file", binary); data.fill(48, 124, 135); checksum(data);
    const bytes = archive(member("pax", record("size", String(binary.length)), "x"), data, member("next", Uint8Array.of(9)));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/file"), binary);
    assert.deepEqual(await fs.readFile("/out/next"), Uint8Array.of(9));
  } finally { await shell.dispose(); }
});

test("special permission bits are recorded but not restored, including verbose visibility", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary); await fs.chmod!("/work/file", 0o4755);
    const result = await shell.exec("tar cf archive file; tar xf archive -C /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/out/file")).mode & 0o7777, 0o755);
    assert.match((await shell.exec("tar tvf archive")).stdout, /^-rwsr-xr-x/u);
  } finally { await shell.dispose(); }
});

test("unknown hardlink identity and unsupported hardlink publication are not converted to copies", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  await fs.writeFile("/work/file", binary); await fs.link!("/work/file", "/work/hard");
  const unknown = wrapped(fs, { async lstat(path, options) {
    const stat = await fs.lstat(path, options);
    const { identityScope: ignoredScope, ...rest } = stat; return rest;
  } });
  const created = await direct(["cf", "archive", "file", "hard"], unknown);
  assert.equal(created.exitCode, 2, created.stderr);
  await assert.rejects(fs.lstat("/work/archive"), { code: "ENOENT" });
  const noLinks = wrapped(fs, { capabilities: { ...fs.capabilities, hardlinks: false } });
  const extracted = await direct(["xf", "-", "-C", "/out"], noLinks, { stdin: source(archive(member("file", binary), member("hard", new Uint8Array(), "1", "file"))) });
  assert.equal(extracted.exitCode, 2, extracted.stderr);
  await assert.rejects(fs.lstat("/out/hard"), { code: "ENOENT" });
});

test("unknown backing identity cannot justify replacing an existing archive or named-input destination", async () => {
  const { fs, shell } = await fixture(); await shell.dispose();
  await fs.writeFile("/work/file", binary);
  await fs.writeFile("/work/existing", Buffer.from("preserve"));
  await fs.writeFile("/work/input", archive(member("file", binary)));
  await fs.writeFile("/out/file", Buffer.from("preserve"));
  const unknown = wrapped(fs, { async lstat(path, options) {
    const { identityScope: ignoredScope, ...stat } = await fs.lstat(path, options); return stat;
  }, async stat(path, options) {
    const { identityScope: ignoredScope, ...stat } = await fs.stat(path, options); return stat;
  } });
  const created = await direct(["cf", "existing", "file"], unknown);
  assert.equal(created.exitCode, 2, created.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/existing")).toString(), "preserve");
  const extracted = await direct(["xf", "input", "-C", "/out"], unknown);
  assert.equal(extracted.exitCode, 2, extracted.stderr);
  assert.equal(Buffer.from(await fs.readFile("/out/file")).toString(), "preserve");
});

test("link targets with internal parents cannot be activated by a later symlink replacement", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("link", new Uint8Array(), "2", "later/../outside"), member("later", new Uint8Array(), "2", "."));
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /non-leading/u);
    assert.equal((await fs.readdir("/out")).length, 0);
  } finally { await shell.dispose(); }
});

test("truncated extraction leaves only the received partial payload and fails", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = member("partial", binary).subarray(0, 512 + 77);
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await fs.readFile("/out/partial"), binary.subarray(0, 77));
  } finally { await shell.dispose(); }
});

test("file-list, argument and pattern work budgets fail explicitly", async () => {
  for (const [limits, command, stdin] of [
    [{ maxFilesFromBytes: 3 }, "tar cf archive -T -", Buffer.from("longname\n")],
    [{ maxArgumentBytes: 2 }, "tar cf archive file", new Uint8Array()],
    [{ maxPatternSteps: 1 }, "tar tf - --exclude='a*'", archive(member("abc"))],
  ] as const) {
    const { shell } = await fixture({ limits });
    try { const result = await shell.exec(command, { stdin }); assert.equal(result.exitCode, 2, result.stderr); }
    finally { await shell.dispose(); }
  }
});

test("actual S3 mock filesystem supports ordinary tar payloads without invented metadata", async () => {
  const fs = new S3FileSystem({ bucket: "bucket", transport: new MockS3Client({ buckets: ["bucket"] }) });
  const { shell } = await fixture({}, fs);
  try {
    await fs.writeFile("/work/file", binary);
    const result = await shell.exec("tar czf archive file; tar xzf archive -C /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/file"), binary);
  } finally { await shell.dispose(); }
});
