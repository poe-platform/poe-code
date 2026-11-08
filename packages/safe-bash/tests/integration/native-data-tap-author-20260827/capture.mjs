import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [output, finalDirectory, failedDirectory] = process.argv.slice(2);
assert.ok(output && finalDirectory && failedDirectory, "explicit new output and both original run directories required");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = [];
for (const [label, directory] of [["final", finalDirectory], ["setup-failed", failedDirectory]]) {
  for (const name of readdirSync(directory).filter(name => /\.(?:json|jsonl|mjs)$/u.test(name)).sort()) {
    const path = join(directory, name), bytes = readFileSync(path);
    entries.push({ name: `${label}/${name}`, source: resolve(path), bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") });
  }
}
const supervisor = readFileSync(new URL("./replay.mjs", import.meta.url));
entries.push({ name: "final/supervisor.mjs", source: new URL("./replay.mjs", import.meta.url).href, bytes: supervisor.length, sha256: digest(supervisor), base64: supervisor.toString("base64") });
const final = JSON.parse(readFileSync(join(finalDirectory, "REPORT.json")));
assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
const payload = Buffer.from(JSON.stringify({ schema: 1, entries }) + "\n"), compressed = gzipSync(payload, { level: 9 });
mkdirSync(output);
writeFileSync(join(output, "RAW.json.gz.base64"), compressed.toString("base64") + "\n", { flag: "wx" });
writeFileSync(join(output, "MANIFEST.json"), JSON.stringify({ schema: 1, candidate: final.candidate, baseline: final.baseline, fixtureMapping: final.fixtureMapping, payloadBytes: payload.length, payloadSha256: digest(payload), compressedSha256: digest(compressed), entries: entries.map(({ base64: _bytes, ...entry }) => entry) }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, candidate: final.candidate, entries: entries.length, compressedBytes: compressed.length }));
