import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { directory, json, flush, putJson } from "./common.mjs";

export async function fileHash(path) {
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
export async function auditArchive(base) {
  const manifest = json(join(base, "MANIFEST.json"));
  assert.deepEqual(await fileHash(join(base, manifest.archive.path)), { bytes: manifest.archive.bytes, sha256: manifest.archive.sha256 });
  const stream = createReadStream(join(base, manifest.archive.path)).pipe(createGunzip({ chunkSize: 65536 }));
  let incomplete = "", current, bytes = 0, total = 0, index = 0, hash;
  for await (const chunk of stream) {
    const lines = (incomplete + chunk.toString()).split("\n"); incomplete = lines.pop(); assert.ok(incomplete.length <= 100000);
    for (const line of lines) {
      assert.ok(line.length <= 100000); const row = JSON.parse(line);
      if (row.kind === "file") { assert.equal(current, undefined); current = row; bytes = 0; hash = createHash("sha256"); }
      else if (row.kind === "chunk") { assert.ok(current); const value = Buffer.from(row.base64, "base64"); assert.ok(value.length <= 65536); bytes += value.length; total += value.length; assert.ok(total <= 2147483648); hash.update(value); }
      else {
        assert.equal(row.kind, "end"); assert.equal(row.path, current.path); assert.equal(row.bytes, current.bytes); assert.equal(bytes, row.bytes); assert.equal(row.sha256, hash.digest("hex"));
        const { kind, ...entry } = row; assert.deepEqual(entry, manifest.entries[index++]); current = undefined;
      }
    }
  }
  assert.equal(current, undefined); assert.equal(incomplete, ""); assert.equal(index, manifest.entries.length); assert.equal(total, manifest.totalRawBytes);
  return { status: "pass", entries: index, bytes: total, archive: manifest.archive };
}
export async function archiveRaw(commit) {
  const rawDirectory = join(directory, "work/run-001/raw"), entries = [], before = readdirSync(rawDirectory).sort();
  let totalRawBytes = 0;
  async function* records() {
    for (const name of before) {
      const path = join(rawDirectory, name), stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink());
      const hash = createHash("sha256"); let bytes = 0;
      yield JSON.stringify({ kind: "file", path: name, mode: stat.mode & 0o777, bytes: stat.size }) + "\n";
      for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
        bytes += chunk.length; totalRawBytes += chunk.length; assert.ok(totalRawBytes <= 2147483648);
        hash.update(chunk); yield JSON.stringify({ kind: "chunk", base64: chunk.toString("base64") }) + "\n";
      }
      assert.equal(bytes, stat.size);
      const row = { path: name, mode: stat.mode & 0o777, bytes, sha256: hash.digest("hex") }; entries.push(row);
      yield JSON.stringify({ kind: "end", ...row }) + "\n";
    }
  }
  const path = join(directory, "RAW.jsonl.gz");
  await pipeline(Readable.from(records()), createGzip({ level: 9 }), createWriteStream(path, { flags: "wx", mode: 0o644 })); flush(path);
  assert.deepEqual(readdirSync(rawDirectory).sort(), before);
  for (const row of entries) assert.deepEqual(await fileHash(join(rawDirectory, row.path)), { bytes: row.bytes, sha256: row.sha256 });
  putJson(join(directory, "MANIFEST.json"), { schema: "expr-r21-composed-raw/1", commit, archive: { path: "RAW.jsonl.gz", ...await fileHash(path) }, totalRawBytes, entries });
  return auditArchive(directory);
}
