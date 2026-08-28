import assert from "node:assert/strict";
import { lstatSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { directory, repository, read, digest, json } from "./common.mjs";
import { reader, metadata } from "../component-execution-v3/stream-reader.mjs";

export function pinsForRun() {
  const overlay = json(join(directory, "PINS.json"));
  const bytes = read(join(repository, overlay.basePins.path));
  assert.equal(digest(bytes), overlay.basePins.sha256);
  return { ...JSON.parse(bytes), ...overlay };
}
export async function authenticateHistory(receipt) {
  const pins = pinsForRun();
  const load = reader(repository, pins.history.flatMap(group => group.entries), receipt);
  for (const group of pins.history) {
    const listing = await metadata(repository, ["ls-tree", "-rlz", group.commit, "--", group.prefix], receipt);
    assert.deepEqual(listing.split("\0").filter(Boolean).map(line => line.split("\t")[1]).sort(), group.entries.map(row => row.path).sort());
    const localNames = readdirSync(join(repository, group.prefix)).filter(name => name !== "work").sort();
    assert.deepEqual(localNames, group.entries.map(row => row.path.slice(group.prefix.length + 1)).sort(), "historical new-entry guard");
    for (const row of group.entries) {
      assert.equal(lstatSync(join(repository, row.path)).mode & 0o777, 0o644);
      assert.equal(digest(read(join(repository, row.path))), row.sha256);
      await load(row.commit, row.path, async () => {});
    }
  }
  const previous = dirname(join(repository, pins.basePins.path));
  const manifestBytes = read(join(previous, "MANIFEST.json"));
  assert.equal(digest(manifestBytes), "f2344a8bac78bf32599ba78b73eafa98e8102cf53976e5628b3d9bbf1b2af5c3");
  const manifest = JSON.parse(manifestBytes);
  const compressed = Buffer.from(read(join(previous, "RAW.json.gz.base64")).toString().trim(), "base64");
  assert.equal(compressed.length, manifest.compressedBytes); assert.equal(digest(compressed), manifest.compressedSha256);
  const payload = gunzipSync(compressed, { maxOutputLength: manifest.payloadBytes });
  assert.equal(payload.length, manifest.payloadBytes); assert.equal(digest(payload), manifest.payloadSha256);
  const entries = JSON.parse(payload).entries;
  assert.deepEqual(entries.map(({ base64, ...row }) => row), manifest.entries);
  for (const row of entries) { const bytes = Buffer.from(row.base64, "base64"); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); }
  const qualification = json(join(previous, "ADMISSION.json"));
  assert.equal(qualification.status, "qualified"); assert.equal(qualification.controls.pass, 16); assert.equal(qualification.allChildrenClosed, true);
  const finalization = json(join(previous, "FINALIZATION.json")); assert.equal(finalization.status, "pass"); assert.equal(finalization.readerChildCount, 2295);
  return { status: "qualified-evidence-reused", priorPass: 16, priorPlanned: 16, newReaderControls: 0, evidenceCommit: pins.priorEvidence, readerSha256: pins.reader.sha256, manifestSha256: digest(manifestBytes), rawEntriesAuthenticated: entries.length, noReplayClaim: true };
}
