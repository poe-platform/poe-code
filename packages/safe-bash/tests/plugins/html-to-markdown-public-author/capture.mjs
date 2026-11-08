import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [output, finalDirectory, initialDirectory, ...historicalTaps] = process.argv.slice(2);
assert.ok(output && finalDirectory && initialDirectory, "explicit new output, final run and original run directories required");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = [];
function capture(path, name) {
  const bytes = readFileSync(path);
  entries.push({ name, source: resolve(path), bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") });
}
for (const [name, directory] of [["final", finalDirectory], ["original-packed-attempt", initialDirectory]]) {
  for (const filename of readdirSync(directory).filter(path => path.endsWith(".json")).sort()) capture(join(directory, filename), `${name}/${filename}`);
  for (const filename of ["permissions-0/current-consumer-permission-admission.json", "permissions-1/current-consumer-permission-admission.json"]) capture(join(directory, filename), `${name}/${filename}`);
}
for (const path of historicalTaps) capture(path, `prior-source-attempts/${basename(path)}`);
const final = JSON.parse(readFileSync(join(finalDirectory, "REPORT.json")));
assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
const payload = Buffer.from(JSON.stringify({ schema: 1, entries }) + "\n"), compressed = gzipSync(payload, { level: 9 });
mkdirSync(output);
writeFileSync(join(output, "RAW.json.gz.base64"), compressed.toString("base64") + "\n", { flag: "wx" });
writeFileSync(join(output, "MANIFEST.json"), JSON.stringify({ schema: 1, candidate: final.candidate, tree: final.tree, package: { metadataSha256: final.package.metadataSha256, tarballSha256: final.package.tarballSha256 }, payloadBytes: payload.length, payloadSha256: digest(payload), compressedSha256: digest(compressed), entries: entries.map(({ base64: _bytes, ...entry }) => entry) }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, candidate: final.candidate, entries: entries.length, payloadBytes: payload.length, compressedBytes: compressed.length }));
