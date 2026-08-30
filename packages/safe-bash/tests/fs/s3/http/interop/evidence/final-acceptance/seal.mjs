import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = "/tmp/safe-bash-s3-final-acceptance-qaoTRB";
const destination = "tests/fs/s3/http/interop/evidence/final-acceptance";
const cohorts = JSON.parse(readFileSync(join(root, "cohorts.json")));
assert.ok(cohorts.finalTransport && cohorts.finalFallback, "required final committed-source replays are not complete");
assert.ok(!existsSync(destination));
const digest = value => createHash("sha256").update(value).digest("hex");
const entries = new Map();
const put = (name, content) => entries.set(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
const pack = (directory, names) => names.map(name => {
  const bytes = readFileSync(join(directory, name));
  return { name, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") };
});
const walk = (directory, prefix = "") => readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(directory, join(prefix, entry.name)) : [join(prefix, entry.name)]);
for (const [name, directory] of Object.entries(cohorts.services)) {
  const shutdown = JSON.parse(readFileSync(join(directory, "shutdown.json")));
  assert.equal(shutdown.code, 0);
  assert.ok(shutdown.ownedDataRemoved && shutdown.ownedHomeRemoved);
  assert.ok(!existsSync(join(directory, "data")) && !existsSync(join(directory, "home")));
  put(`services/${name}.json`, JSON.stringify({ directory, artifacts: pack(directory, walk(directory).sort()) }, null, 2) + "\n");
}
for (const [name, directory] of Object.entries(cohorts.builds)) {
  const names = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "manifest-before.json"))), JSON.parse(readFileSync(join(directory, "manifest-after.json"))));
  put(`builds/${name}.json`, JSON.stringify({ directory, artifacts: pack(directory, names.sort()),
    httpSource: pack(join(directory, "archive/src/fs/s3/http"), readdirSync(join(directory, "archive/src/fs/s3/http")).sort()) }, null, 2) + "\n");
}
const final = JSON.parse(readFileSync(join(cohorts.finalTransport, "provenance.json")));
const fallback = JSON.parse(readFileSync(join(cohorts.finalFallback, "provenance.json")));
assert.ok(final.httpMatchesPinnedCommit && fallback.httpMatchesPinnedCommit);
assert.deepEqual(final.httpBefore, fallback.httpBefore);
assert.equal(JSON.parse(readFileSync(join(cohorts.finalTransport, "transport.exit.json"))).status, 0);
assert.equal(JSON.parse(readFileSync(join(cohorts.finalFallback, "fallback.exit.json"))).status, 0);
assert.equal(JSON.parse(readFileSync(join(cohorts.finalTransport, "http-worktree-after.json"))).unchanged, true);
assert.equal(JSON.parse(readFileSync(join(cohorts.finalFallback, "http-worktree-after.json"))).unchanged, true);
put("download.json", JSON.stringify(pack(cohorts.download, ["official.sha256sum", "download.json"]), null, 2) + "\n");
const fixturePath = "tests/fs/s3/http/interop/transport-check.mjs";
const baseline = execFileSync("git", ["show", `b93005a:${fixturePath}`]).toString();
const candidate = readFileSync(fixturePath, "utf8");
assert.equal(candidate.replace('allowInsecureHttp: true, listUrlEncoding: "form",', 'allowInsecureHttp: true,'), baseline);
put("fixture-delta.json", JSON.stringify({ baseline: "b93005a", baselineSha256: digest(baseline), candidateSha256: digest(candidate),
  soleDelta: 'Explicit constructor listUrlEncoding: "form"; all original18 assertions unchanged',
  baselineBase64: Buffer.from(baseline).toString("base64"), candidateBase64: Buffer.from(candidate).toString("base64") }, null, 2) + "\n");
const binary = join(cohorts.download, "minio");
assert.ok(lstatSync(binary).isFile());
assert.equal(digest(readFileSync(binary)), "7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4");
rmSync(binary);
put("shutdown-and-cleanup.json", JSON.stringify({ binary, binaryRemoved: true, services: Object.entries(cohorts.services)
  .map(([cohort, directory]) => ({ cohort, ...JSON.parse(readFileSync(join(directory, "shutdown.json"))) })), time: new Date().toISOString() }, null, 2) + "\n");
for (const name of ["REPORT.md", "cohorts.json", "seal.mjs"]) put(name, readFileSync(join(root, name)));
put("SHA256SUMS", [...entries].map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join(""));
let patch = "*** Begin Patch\n";
for (const [name, bytes] of entries) {
  const text = bytes.toString("utf8"); assert.ok(Buffer.from(text).equals(bytes)); assert.ok(text.endsWith("\n"));
  patch += `*** Add File: ${destination}/${name}\n` + text.slice(0, -1).split("\n").map(line => "+" + line + "\n").join("");
}
patch += "*** End Patch\n";
execFileSync("apply_patch", [], { input: patch, maxBuffer: 4 * 1024 * 1024 });
for (const [name, bytes] of entries) assert.ok(readFileSync(join(destination, name)).equals(bytes), name);
console.log(JSON.stringify({ files: entries.size, bytes: [...entries.values()].reduce((total, bytes) => total + bytes.length, 0) }));
