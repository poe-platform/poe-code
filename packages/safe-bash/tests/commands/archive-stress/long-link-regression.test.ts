import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeEntry } from "../../../src/commands/archive/format.js";
import { DEFAULT_ARCHIVE_LIMITS } from "../../../src/commands/archive/internal.js";

const target = `cross-${"x".repeat(116)}.bin`;
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
