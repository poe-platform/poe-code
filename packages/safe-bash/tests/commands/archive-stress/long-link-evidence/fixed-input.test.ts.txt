import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { encodeEntry } from "../../../src/commands/archive/format.js";
import { DEFAULT_ARCHIVE_LIMITS } from "../../../src/commands/archive/internal.js";

const target = `cross-${"x".repeat(116)}.bin`;
const payload = Buffer.from("independent long-link target\n");
const evidenceDirectory = resolve("tests/commands/archive-stress/long-link-evidence");
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function encodedLink(linkname: string): Buffer[] {
  return encodeEntry({
    name: "symbol", type: "2", linkname, size: 0, mode: 0o777,
    uid: 0, gid: 0, mtime: 1_700_000_000,
  }, DEFAULT_ARCHIVE_LIMITS).map(bytes => Buffer.from(bytes));
}

function field(header: Buffer, offset: number, width: number): string {
  return header.subarray(offset, offset + width).toString("utf8").replace(/\0.*$/su, "");
}

function expectedPax(linkname: string): Buffer {
  const body = ` linkpath=${linkname}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (length !== Buffer.byteLength(body) + String(length).length) {
    length = Buffer.byteLength(body) + String(length).length;
  }
  return Buffer.from(`${length}${body}`);
}

function archiveBytes(): Buffer {
  return Buffer.concat([...encodedLink(target), Buffer.alloc(1024)]);
}

test("PAX links retain exact full targets and nonempty safe USTAR fallback", context => {
  assert.equal(Buffer.byteLength(target), 126);
  const original = archiveBytes();
  const parts = encodedLink(target);
  context.diagnostic(JSON.stringify({
    kind: "raw-archive", archiveSha256: hash(original), archiveBase64: original.toString("base64"),
    extensionOffset: 0, payloadOffset: 512, linkHeaderOffset: 1024,
    paxPayloadBase64: parts[1]!.toString("base64"),
    linkHeaderBase64: parts[3]!.toString("base64"),
    typeflagHex: parts[3]!.subarray(156, 157).toString("hex"),
    rawLinknameHex: parts[3]!.subarray(157, 257).toString("hex"),
  }));
  for (const linkname of ["x".repeat(100), "x".repeat(101), target, "é".repeat(63), "雪", `${"x".repeat(99)}é`]) {
    const records = encodedLink(linkname);
    const header = records.at(-1)!;
    const extended = Buffer.byteLength(linkname) > 100 || /[^\x01-\x7f]/u.test(linkname);
    assert.equal(header.length, 512);
    assert.equal(field(header, 0, 100), "symbol");
    assert.equal(header[156], 0x32);
    assert.equal(Number.parseInt(field(header, 124, 12), 8), 0);
    let checksum = 0;
    for (let offset = 0; offset < 512; offset++) checksum += offset >= 148 && offset < 156 ? 32 : header[offset]!;
    assert.equal(Number.parseInt(field(header, 148, 8), 8), checksum);
    if (extended) {
      assert.equal(records.length, 4);
      assert.equal(records[0]![156], 0x78);
      assert.equal(Number.parseInt(field(records[0]!, 124, 12), 8), records[1]!.length);
      assert.deepEqual(records[1], expectedPax(linkname));
      assert.equal((records[1]!.length + records[2]!.length) % 512, 0);
      assert.ok(records[2]!.every(byte => byte === 0));
      assert.equal(field(header, 157, 100), "PaxLink");
      assert.ok(header.subarray(164, 257).every(byte => byte === 0));
    } else {
      assert.equal(records.length, 1);
      assert.equal(field(header, 157, 100), linkname);
    }
  }
});

const consumers = [
  { name: "GNU 1.35", binary: resolve("tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"), sha256: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", version: /^tar \(GNU tar\) 1\.35\n/u },
  { name: "BSD 3.5.3", binary: "/usr/bin/bsdtar", sha256: "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", version: /^bsdtar 3\.5\.3 - libarchive 3\.7\.4 /u },
];

if (process.env.ARCHIVE_LONG_LINK_NATIVE === "1") {
  for (const consumer of consumers) test(`${consumer.name}: plain AND gzip extract an exact symlink, never an empty regular file`, async context => {
    assert.equal(hash(await readFile(consumer.binary)), consumer.sha256);
    const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
    const run = (args: string[]) => {
      const result = spawnSync(consumer.binary, args, {
        encoding: "utf8", env: environment, timeout: 10_000, maxBuffer: 1024 * 1024,
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
        const stat = await lstat(join(output, "symbol")).catch(error => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        observations.push({
          format: gzip ? "gzip" : "plain", archiveSha256: hash(bytes), listing, extraction,
          type: stat?.isSymbolicLink() ? "symlink" : stat?.isFile() ? "regular" : stat ? "other" : "missing",
          size: stat?.size ?? null, linkTarget: stat?.isSymbolicLink() ? await readlink(join(output, "symbol")) : null,
          throughLinkBase64: stat ? (await readFile(join(output, "symbol"))).toString("base64") : null,
          targetBase64: (await readFile(join(output, target))).toString("base64"),
          entries: (await readdir(output)).sort(),
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
