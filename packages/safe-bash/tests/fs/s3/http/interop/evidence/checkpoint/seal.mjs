import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/tmp/safe-bash-s3-interop-RUbpyd";
const destination = "tests/fs/s3/http/interop/evidence/checkpoint";
assert.ok(!existsSync(destination));
const digest = value => createHash("sha256").update(value).digest("hex");
const entries = new Map();
const put = (name, content) => entries.set(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
const pack = (directory, names) => names.map(name => { const bytes = readFileSync(join(directory, name));
  return { name, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") }; });
const walk = (directory, prefix = "") => readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(directory, join(prefix, entry.name)) : [join(prefix, entry.name)]);
const services = [
  ["startup-resolved-listener", "/tmp/safe-bash-s3-service-VTTL9e"],
  ["startup-ipv6-listener", "/tmp/safe-bash-s3-service-CJJi0p"],
  ["native-curl-guards", "/tmp/safe-bash-s3-service-fy6UbM"],
  ["reference-guards", "/tmp/safe-bash-s3-service-3lazpO"],
  ["final-guards", "/tmp/safe-bash-s3-service-gIK3hu"],
  ["initial-transport", "/tmp/safe-bash-s3-service-6y3HrE"],
  ["corrected-transport", "/tmp/safe-bash-s3-service-wu5gdD"],
  ["expanded-transport", "/tmp/safe-bash-s3-service-08wGJL"],
];
for (const [name, directory] of services) {
  const shutdown = JSON.parse(readFileSync(join(directory, "shutdown.json")));
  assert.equal(shutdown.code, 0); assert.equal(shutdown.ownedDataRemoved, true); assert.equal(shutdown.ownedHomeRemoved, true);
  assert.ok(!existsSync(join(directory, "data")) && !existsSync(join(directory, "home")));
  put(`services/${name}.json`, JSON.stringify({ directory, artifacts: pack(directory, walk(directory).sort()) }, null, 2) + "\n");
}
for (const [name, directory] of [["initial", "/tmp/safe-bash-s3-http-interop-dZzdr6"], ["corrected", "/tmp/safe-bash-s3-http-interop-AsHRqf"],
  ["expanded", "/tmp/safe-bash-s3-http-interop-uWX4Fy"]]) {
  const names = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "manifest-before.json"))), JSON.parse(readFileSync(join(directory, "manifest-after.json"))));
  put(`builds/${name}.json`, JSON.stringify({ directory, artifacts: pack(directory, names.sort()),
    httpSource: pack(join(directory, "archive/src/fs/s3/http"), readdirSync(join(directory, "archive/src/fs/s3/http")).sort()) }, null, 2) + "\n");
}
put("download-original.json", JSON.stringify(pack(root, ["download.headers", "official.sha256sum", "version.txt", "version.stderr"]), null, 2) + "\n");
put("download-script.json", JSON.stringify(pack("/tmp/safe-bash-minio-download-VArwOg", ["official.sha256sum", "download.json"]), null, 2) + "\n");
const removed = [];
for (const path of [join(root, "minio"), "/tmp/safe-bash-minio-download-VArwOg/minio"]) {
  assert.ok(lstatSync(path).isFile());
  const sha256 = digest(readFileSync(path));
  assert.equal(sha256, "7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4");
  rmSync(path); removed.push({ path, sha256, removed: true });
}
put("shutdown-and-cleanup.json", JSON.stringify({ servers: services.map(([cohort, directory]) => ({ cohort,
  ...JSON.parse(readFileSync(join(directory, "shutdown.json"))) })), downloadedBinaries: removed, time: new Date().toISOString() }, null, 2) + "\n");
put("REPORT.md", readFileSync(join(root, "REPORT.md")));
put("seal.mjs", readFileSync(join(root, "seal.mjs")));
put("source-review-handoff.txt", readFileSync("/tmp/safe-bash-s3-http-interop-handoff.txt"));
const sources = readdirSync("src/fs/s3/http").filter(name => name.endsWith(".ts")).sort()
  .map(name => ({ path: "src/fs/s3/http/" + name, sha256: digest(readFileSync("src/fs/s3/http/" + name)) }));
put("current-source-observation.json", JSON.stringify({ time: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  source: sources, note: "Current source observation only; test snapshots are separately frozen in builds/expanded.json",
  node: process.version, typescript: JSON.parse(readFileSync("node_modules/typescript/package.json")).version,
  status: execFileSync("git", ["status", "--short"]).toString() }, null, 2) + "\n");
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
