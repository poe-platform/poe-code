import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { archive, epochSeconds, longName, member, pattern, pax, paxSample } from "./fixtures.js";
import { fixture, source, success, tar } from "./helpers.js";

const payload = pattern(517, 17);
const opaque = Buffer.from([0, 255, 128, 10, 61, 46, 46, 47, 120]);

function rawRecord(key: Uint8Array | string, value: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(" "), Buffer.from(key), Buffer.from("="), value, Buffer.from("\n")]);
  let length = body.length + 1;
  while (length !== body.length + String(length).length) length = body.length + String(length).length;
  return Buffer.concat([Buffer.from(String(length)), body]);
}

function extended(records: Uint8Array, following = member({ name: "file", data: payload })): Buffer {
  return archive(member({ name: "metadata", type: "x", data: records }), following);
}

async function unchangedOutside(fs: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
  assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["sentinel"]);
}

async function rejected(bytes: Uint8Array, diagnostic: RegExp, options: Parameters<typeof tar>[3] = {}): Promise<void> {
  for (const gzip of [false, true]) {
    const fs = await fixture();
    await fs.writeFile("/output/file", Buffer.from("protected"));
    const result = await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(gzip ? gzipSync(bytes) : bytes, 31) }, options);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, diagnostic);
    assert.equal(Buffer.from(await fs.readFile("/output/file")).toString(), "protected");
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["file"]);
    await unchangedOutside(fs);
  }
}

test("P01 optional vendor metadata is opaque, not file data, paths, ownership or permissions", async () => {
  const records = Buffer.concat([
    ...["SCHILY.xattr.user.binary", "LIBARCHIVE.xattr.user.note", "SCHILY.xattr.GNU.sparse", "SCHILY.fflags", "LIBARCHIVE.creationtime"].map(key => rawRecord(key, opaque)),
    rawRecord("LIBARCHIVE.xattr.com.apple.provenance", Buffer.from("AQIA889aSVAWdgE")),
    rawRecord("SCHILY.xattr.com.apple.provenance", Buffer.from("010200f3cf5a4950167601", "hex")),
    rawRecord("SCHILY.xattr.user.path", Buffer.from("../outside/sentinel\n20 path=escape\n")),
    rawRecord("LIBARCHIVE.xattr.user.size", Buffer.from("99999999999")),
  ]);
  for (const gzip of [false, true]) {
    const fs = await fixture();
    const bytes = extended(records);
    const listed = await tar(fs, [gzip ? "-tzf" : "-tf", "-"], { stdin: source(gzip ? gzipSync(bytes) : bytes) });
    success(listed);
    assert.equal(listed.stdout.toString(), "file\n");
    success(await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(gzip ? gzipSync(bytes) : bytes) }));
    assert.deepEqual(Buffer.from(await fs.readFile("/output/file")), payload);
    const stat = await fs.stat("/output/file");
    assert.equal(stat.size, payload.length);
    assert.equal(stat.mode & 0o777, 0o640);
    assert.equal(stat.mtimeMs, epochSeconds * 1000);
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["file"]);
    await unchangedOutside(fs);
  }
});

test("P02 ignored local/global metadata does not leak into supported PAX state", async () => {
  const bytes = archive(
    member({ name: "global", type: "g", data: Buffer.concat([rawRecord("SCHILY.xattr.user.global", opaque), pax(["mtime", "1700000000.125"])]) }),
    member({ name: "local", type: "x", data: Buffer.concat([rawRecord("SCHILY.fflags", opaque), pax(["path", "renamed"], ["mtime", "1700000001.25"])]) }),
    member({ name: "raw", data: payload }),
    member({ name: "global-delete", type: "g", data: rawRecord("SCHILY.xattr.user.global", Buffer.alloc(0)) }),
    member({ name: "following", data: pattern(13) }),
  );
  const fs = await fixture();
  success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes, 1) }));
  assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["following", "renamed"]);
  assert.equal((await fs.stat("/output/renamed")).mtimeMs, 1700000001250);
  assert.equal((await fs.stat("/output/following")).mtimeMs, 1700000000125);
  assert.deepEqual(Buffer.from(await fs.readFile("/output/renamed")), payload);
});

test("P03 essential text remains strict UTF-8 with NUL and binary charset rejected", async () => {
  for (const key of ["path", "linkpath", "size", "mtime"]) {
    await rejected(extended(Buffer.concat([rawRecord("SCHILY.xattr.user.binary", opaque), rawRecord(key, Uint8Array.of(255))])), /UTF-8/);
    await rejected(extended(rawRecord(key, Buffer.from("safe\0unsafe"))), /PAX key\/value/);
  }
  await rejected(extended(pax(["hdrcharset", "BINARY"])), /charset/);
});

test("P04 opaque values never bypass malformed record framing, keys, checksum or truncation", async () => {
  const valid = rawRecord("SCHILY.xattr.user.binary", opaque);
  const badNewline = Buffer.from(valid); badNewline[badNewline.length - 1] = 0;
  for (const records of [badNewline, valid.subarray(0, -1), Buffer.from("0 SCHILY.fflags=x\n"), rawRecord("SCHILY.fflags\0", opaque), rawRecord("SCHILY.fflags\n", opaque), rawRecord(Uint8Array.of(255), opaque)]) {
    await rejected(extended(records), /PAX|UTF-8/);
  }
  const header = extended(valid); header[0] = header[0]! ^ 1;
  await rejected(header, /checksum/);
  await rejected(extended(valid).subarray(0, 512 + valid.length - 1), /truncated/);
  await rejected(extended(valid).subarray(0, 512 + valid.length + 1), /truncated/);
  await rejected(archive(member({ name: "metadata", type: "x", data: valid })), /orphan/);
});

test("P05 sparse, layout-changing and unclassified extensions remain fail-closed before publication", async () => {
  for (const key of ["GNU.sparse.map", "GNU.sparse.major", "GNU.sparse.realsize", "SCHILY.realsize", "SCHILY.filetype", "SCHILY.offset", "SUN.holesdata", "GNU.volume.offset", "VENDOR.unknown", "LIBARCHIVE.unknown", "SCHILY.xattr.", "LIBARCHIVE.xattr.", "SCHILY.acl.access", "RHT.security.selinux", "SCHILY.dev", "SCHILY.ino", "SCHILY.nlink", "LIBARCHIVE.symlinktype"]) {
    for (const type of ["x", "g"] as const) {
      await rejected(archive(member({ name: "metadata", type, data: Buffer.concat([rawRecord("SCHILY.fflags", opaque), pax([key, "1"])]) }), member({ name: "file", data: payload })), /unsupported PAX keyword/);
    }
  }
  const fs = await fixture();
  const hidden = extended(pax(["GNU.sparse.map", "0,1"], ["GNU.sparse.map", ""]));
  const result = await tar(fs, ["-xf", "-", "-C", "/output", "--exclude=file"], { stdin: source(hidden) });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unsupported PAX keyword/);
  assert.deepEqual(await fs.readdir("/output"), []);
  await unchangedOutside(fs);
});

test("P06 optional bytes retain extended-header, member and effective-size limits", async () => {
  const record = rawRecord("SCHILY.xattr.user.binary", opaque);
  const bytes = extended(record);
  await rejected(bytes, /extended header byte limit/, { limits: { maxPaxBytes: record.length - 1 } });
  await rejected(bytes, /member.*limit/, { limits: { maxMembers: 1 } });
  await rejected(extended(Buffer.concat([record, pax(["size", "67108865"])])), /entry.*limit/);
  await rejected(extended(rawRecord("SCHILY.xattr.user.large", Buffer.alloc(1024 * 1024))), /extended header byte limit/);
  const fs = await fixture();
  success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes) }, { limits: { maxPaxBytes: record.length, maxEntryBytes: payload.length, maxMembers: 2 } }));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/file")), payload);
});

test("P07 optional metadata cannot bypass effective path, symlink or member-type controls", async () => {
  const optional = rawRecord("LIBARCHIVE.xattr.user.note", opaque);
  await rejected(extended(Buffer.concat([optional, pax(["path", "../outside/sentinel"])])), /unsafe parent/);
  await rejected(extended(Buffer.concat([optional, pax(["linkpath", "../outside/sentinel"])]), member({ name: "file", type: "2", link: "safe" })), /symlink target escapes extraction root/);
  const special = member({ name: "file" }); special[156] = 51; special.fill(32, 148, 156);
  special.write(`${special.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  await rejected(extended(optional, special), /unsupported.*type/);
  const fs = await fixture();
  await fs.symlink!("/outside", "/output/pivot");
  const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(extended(Buffer.concat([optional, pax(["path", "pivot/sentinel"])]))) });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /symlink ancestor/);
  await unchangedOutside(fs);
  assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["pivot"]);
});

test("P08 virtual global/local mtime follows the deterministic POSIX fixture independently of native profiles", async () => {
  const fs = await fixture();
  success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(paxSample()) }));
  assert.equal((await fs.stat(`/output/${longName}`)).mtimeMs, 1700123401125);
  assert.equal((await fs.stat("/output/following")).mtimeMs, 1700123400000);
  assert.deepEqual(Buffer.from(await fs.readFile(`/output/${longName}`)), pattern(1031));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/following")), pattern(17, 7));
});

test("P09 immutable formerly rejected BSD PAX archives now extract exact contents in both formats", async () => {
  const crossName = `cross-${"name".repeat(29)}.bin`;
  for (const gzip of [false, true]) {
    const bytes = await readFile(new URL(`./final-evidence/gate-3ecvdu/BSD-native.tar${gzip ? ".gz" : ""}`, import.meta.url));
    const fs = await fixture();
    const listing = await tar(fs, [gzip ? "-tzf" : "-tf", "-"], { stdin: source(bytes) });
    success(listing);
    assert.equal(listing.stdout.toString(), `deep/leaf\nspace name\n${crossName}\nsymbol\n`);
    success(await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(bytes) }));
    for (const [name, expected] of [["deep/leaf", pattern(1237, 713)], ["space name", pattern(0)], [crossName, pattern(65563, 81)]] as const) assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), expected);
    assert.equal(await fs.readlink!("/output/symbol"), crossName);
    assert.equal((await fs.lstat("/output/symbol")).type, "symlink");
    await unchangedOutside(fs);
  }
});
