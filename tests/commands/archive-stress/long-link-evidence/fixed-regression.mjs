// tests/commands/archive-stress/long-link-regression.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";

// src/contracts/errors.ts
import { getSystemErrorMap } from "node:util";
var systemErrnos = new Map([...getSystemErrorMap()].map(([errno, [name]]) => [name, errno]));

// src/contracts/filesystem.ts
var ACCESS_MODES = Object.freeze({ F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 });

// src/contracts/path.ts
import { posix } from "node:path";
var basename = posix.basename;
var dirname = posix.dirname;
var extname = posix.extname;
var joinPath = posix.join;
var isAbsolutePath = posix.isAbsolute;

// src/commands/archive/internal.ts
var DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxMembers: 1e4,
  maxPathBytes: 4096,
  maxDepth: 128,
  maxPaxBytes: 1024 * 1024,
  maxFilesFromBytes: 1024 * 1024,
  maxArgumentBytes: 64 * 1024,
  maxTextBytes: 1024 * 1024,
  maxDiagnosticBytes: 4096,
  maxPatternSteps: 1e7,
  maxBufferedFileBytes: 1024 * 1024,
  chunkSize: 64 * 1024
});
function fail(message) {
  throw new Error(message);
}
function checkPath(path, limits) {
  if (!path || path.includes("\0") || Buffer.from(path).toString("utf8") !== path) fail("invalid empty, NUL, or non-Unicode path");
  if (Buffer.byteLength(path) > limits.maxPathBytes) fail("path byte limit exceeded");
  if (path.split("/").length > limits.maxDepth + 1) fail("path depth limit exceeded");
}

// src/commands/archive/format.ts
function octal(header, offset, width, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value.toString(8).length >= width) fail("number does not fit USTAR field");
  header.set(Buffer.from(value.toString(8).padStart(width - 1, "0")), offset);
}
function splitName(name) {
  if (!/^[\x01-\x7f]*$/u.test(name)) return void 0;
  if (Buffer.byteLength(name) <= 100) return [name, ""];
  for (let offset = name.length - 2; offset > 0; offset--) {
    if (name[offset] === "/" && Buffer.byteLength(name.slice(0, offset)) <= 155 && Buffer.byteLength(name.slice(offset + 1)) <= 100) {
      return [name.slice(offset + 1), name.slice(0, offset)];
    }
  }
  return void 0;
}
function headerBytes(entry) {
  const split = splitName(entry.name);
  if (!split) fail("name does not fit USTAR header");
  if (Buffer.byteLength(entry.linkname) > 100) fail("link does not fit USTAR header");
  const header = new Uint8Array(512);
  header.set(Buffer.from(split[0]), 0);
  header.set(Buffer.from(split[1]), 345);
  octal(header, 100, 8, entry.mode);
  octal(header, 108, 8, entry.uid);
  octal(header, 116, 8, entry.gid);
  octal(header, 124, 12, entry.size);
  octal(header, 136, 12, entry.mtime);
  header.fill(32, 148, 156);
  header[156] = entry.type.charCodeAt(0);
  header.set(Buffer.from(entry.linkname), 157);
  header.set(Buffer.from("ustar\x0000"), 257);
  octal(header, 329, 8, 0);
  octal(header, 337, 8, 0);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);
  return header;
}
function paxRecord(key, value) {
  const payload2 = ` ${key}=${value}
`;
  const bytes = Buffer.byteLength(payload2);
  let size = bytes + 1;
  while (size !== bytes + String(size).length) size = bytes + String(size).length;
  return Buffer.from(`${size}${payload2}`);
}
function encodeEntry(entry, limits) {
  checkPath(entry.name, limits);
  if (entry.linkname) checkPath(entry.linkname, limits);
  const base = { ...entry };
  if (!Number.isFinite(entry.mtime) || Math.abs(entry.mtime * 1e3) > 864e13) fail("invalid source mtime");
  const records = [];
  if (!splitName(base.name)) {
    records.push(paxRecord("path", base.name));
    base.name = "PaxEntry";
  }
  if (Buffer.byteLength(base.linkname) > 100 || /[^\x01-\x7f]/u.test(base.linkname)) {
    records.push(paxRecord("linkpath", base.linkname));
    base.linkname = "PaxLink";
  }
  for (const key of ["uid", "gid", "size", "mtime"]) {
    const value = base[key];
    const maximum = key === "uid" || key === "gid" ? 2097151 : 8589934591;
    if (!Number.isFinite(value) || key !== "mtime" && (!Number.isSafeInteger(value) || value < 0)) fail(`invalid source ${key}`);
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      records.push(paxRecord(key, key === "mtime" ? decimalTime(value) : String(value)));
      base[key] = 0;
    }
  }
  if (entry.atime !== void 0) {
    if (!Number.isFinite(entry.atime) || Math.abs(entry.atime * 1e3) > 864e13) fail("invalid source atime");
    records.push(paxRecord("atime", decimalTime(entry.atime)));
  }
  if (!records.length) return [headerBytes(base)];
  const payload2 = Buffer.concat(records);
  if (payload2.length > limits.maxPaxBytes) fail("PAX header byte limit exceeded");
  const extension = headerBytes({ ...base, name: "PaxHeader", linkname: "", type: "x", size: payload2.length, mode: 420 });
  return [extension, payload2, new Uint8Array((512 - payload2.length % 512) % 512), headerBytes(base)];
}
function decimalTime(value) {
  return value.toFixed(9).replace(/(\.[0-9]*?)0+$/u, "$1").replace(/\.$/u, "");
}

// tests/commands/archive-stress/long-link-regression.test.ts
var target = `cross-${"x".repeat(116)}.bin`;
var payload = Buffer.from("independent long-link target\n");
var evidenceDirectory = resolve("tests/commands/archive-stress/long-link-evidence");
var hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function encodedLink(linkname) {
  return encodeEntry({
    name: "symbol",
    type: "2",
    linkname,
    size: 0,
    mode: 511,
    uid: 0,
    gid: 0,
    mtime: 17e8
  }, DEFAULT_ARCHIVE_LIMITS).map((bytes) => Buffer.from(bytes));
}
function field(header, offset, width) {
  return header.subarray(offset, offset + width).toString("utf8").replace(/\0.*$/su, "");
}
function expectedPax(linkname) {
  const body = ` linkpath=${linkname}
`;
  let length = Buffer.byteLength(body) + 1;
  while (length !== Buffer.byteLength(body) + String(length).length) {
    length = Buffer.byteLength(body) + String(length).length;
  }
  return Buffer.from(`${length}${body}`);
}
function archiveBytes() {
  return Buffer.concat([...encodedLink(target), Buffer.alloc(1024)]);
}
test("PAX links retain exact full targets and nonempty safe USTAR fallback", (context) => {
  assert.equal(Buffer.byteLength(target), 126);
  const original = archiveBytes();
  const parts = encodedLink(target);
  context.diagnostic(JSON.stringify({
    kind: "raw-archive",
    archiveSha256: hash(original),
    archiveBase64: original.toString("base64"),
    extensionOffset: 0,
    payloadOffset: 512,
    linkHeaderOffset: 1024,
    paxPayloadBase64: parts[1].toString("base64"),
    linkHeaderBase64: parts[3].toString("base64"),
    typeflagHex: parts[3].subarray(156, 157).toString("hex"),
    rawLinknameHex: parts[3].subarray(157, 257).toString("hex")
  }));
  for (const linkname of ["x".repeat(100), "x".repeat(101), target, "\xE9".repeat(63), "\u96EA", `${"x".repeat(99)}\xE9`]) {
    const records = encodedLink(linkname);
    const header = records.at(-1);
    const extended = Buffer.byteLength(linkname) > 100 || /[^\x01-\x7f]/u.test(linkname);
    assert.equal(header.length, 512);
    assert.equal(field(header, 0, 100), "symbol");
    assert.equal(header[156], 50);
    assert.equal(Number.parseInt(field(header, 124, 12), 8), 0);
    let checksum = 0;
    for (let offset = 0; offset < 512; offset++) checksum += offset >= 148 && offset < 156 ? 32 : header[offset];
    assert.equal(Number.parseInt(field(header, 148, 8), 8), checksum);
    if (extended) {
      assert.equal(records.length, 4);
      assert.equal(records[0][156], 120);
      assert.equal(Number.parseInt(field(records[0], 124, 12), 8), records[1].length);
      assert.deepEqual(records[1], expectedPax(linkname));
      assert.equal((records[1].length + records[2].length) % 512, 0);
      assert.ok(records[2].every((byte) => byte === 0));
      assert.equal(field(header, 157, 100), "PaxLink");
      assert.ok(header.subarray(164, 257).every((byte) => byte === 0));
    } else {
      assert.equal(records.length, 1);
      assert.equal(field(header, 157, 100), linkname);
    }
  }
});
var consumers = [
  { name: "GNU 1.35", binary: resolve("tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"), sha256: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", version: /^tar \(GNU tar\) 1\.35\n/u },
  { name: "BSD 3.5.3", binary: "/usr/bin/bsdtar", sha256: "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", version: /^bsdtar 3\.5\.3 - libarchive 3\.7\.4 /u }
];
if (process.env.ARCHIVE_LONG_LINK_NATIVE === "1") {
  for (const consumer of consumers) test(`${consumer.name}: plain AND gzip extract an exact symlink, never an empty regular file`, async (context) => {
    assert.equal(hash(await readFile(consumer.binary)), consumer.sha256);
    const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
    const run = (args) => {
      const result = spawnSync(consumer.binary, args, {
        encoding: "utf8",
        env: environment,
        timeout: 1e4,
        maxBuffer: 1024 * 1024
      });
      return { args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
    };
    const version = run(["--version"]);
    assert.equal(version.status, 0);
    assert.match(version.stdout, consumer.version);
    await mkdir(evidenceDirectory, { recursive: true });
    const temporary = await mkdtemp(join(evidenceDirectory, ".native-long-link-"));
    const observations = [];
    try {
      for (const gzip of [false, true]) {
        const output = join(temporary, gzip ? "gzip" : "plain");
        await mkdir(output);
        await writeFile(join(output, target), payload);
        const plain = archiveBytes();
        const bytes = gzip ? gzipSync(plain) : plain;
        if (gzip) assert.deepEqual(gunzipSync(bytes), plain);
        const archive = join(temporary, gzip ? "input.tar.gz" : "input.tar");
        await writeFile(archive, bytes);
        const listing = run([gzip ? "-tzf" : "-tf", archive]);
        const extraction = run([gzip ? "-xzf" : "-xf", archive, "-C", output]);
        const stat = await lstat(join(output, "symbol")).catch((error) => {
          if (error.code === "ENOENT") return void 0;
          throw error;
        });
        observations.push({
          format: gzip ? "gzip" : "plain",
          archiveSha256: hash(bytes),
          listing,
          extraction,
          type: stat?.isSymbolicLink() ? "symlink" : stat?.isFile() ? "regular" : stat ? "other" : "missing",
          size: stat?.size ?? null,
          linkTarget: stat?.isSymbolicLink() ? await readlink(join(output, "symbol")) : null,
          throughLinkBase64: stat ? (await readFile(join(output, "symbol"))).toString("base64") : null,
          targetBase64: (await readFile(join(output, target))).toString("base64"),
          entries: (await readdir(output)).sort()
        });
      }
      context.diagnostic(JSON.stringify({ kind: "native", consumer: consumer.name, binary: consumer.binary, sha256: consumer.sha256, version, observations }));
      for (const observation of observations) {
        assert.equal(observation.listing.status, 0, JSON.stringify(observation));
        assert.equal(observation.listing.stdout, "symbol\n");
        assert.equal(observation.extraction.status, 0, JSON.stringify(observation));
        assert.equal(observation.type, "symlink", JSON.stringify(observation));
        assert.equal(observation.linkTarget, target);
        assert.equal(observation.throughLinkBase64, payload.toString("base64"));
        assert.equal(observation.targetBase64, payload.toString("base64"));
        assert.deepEqual(observation.entries, [target, "symbol"].sort());
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
