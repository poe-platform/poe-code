import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const here = new URL("./", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const hash = path => createHash("sha256").update(readFileSync(new URL(path, new URL("../../../../", import.meta.url)))).digest("hex");
const write = (name, data) => writeFileSync(new URL(name, here), `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
const previous = JSON.parse(readFileSync(new URL("../fix/candidate-source.json", here), "utf8"));
const changed = ["src/commands/streams.ts", "tests/commands/streams.test.ts"];
const hashes = {};
for (const [path, expected] of Object.entries(previous.hashes)) {
  hashes[path] = hash(path);
  if (!changed.includes(path)) assert.equal(hashes[path], expected, `preserved previous binding: ${path}`);
}
const preserved = git("ls-tree", "-r", "--name-only", "b32b336465962cd169d52583ec5d45bdc570a840", "--", "tests/stress/byte-ownership-20260827/fix").split("\n");
for (const path of preserved) {
  const original = execFileSync("git", ["show", `b32b336465962cd169d52583ec5d45bdc570a840:${path}`], { cwd: root });
  hashes[path] = hash(path);
  assert.equal(hashes[path], createHash("sha256").update(original).digest("hex"), `immutable first candidate: ${path}`);
}
assert.equal(git("status", "--porcelain", "--", ...changed), "");
write("candidate-source.json", {
  at: new Date().toISOString(), codeCommit: git("log", "-1", "--format=%H", "--", ...changed),
  observedHead: git("rev-parse", "HEAD"), previousCodeCommit: "7a517cecab21d9fbff204df01a6a2ad2712a7673",
  holdoutFreeze: "b1c823af09c1cc4bf9a13225ef0ae9c170d22d80", node: process.version,
  platform: process.platform, arch: process.arch, hashes, originalFixtureHashes: previous.originalFixtureHashes,
  preservedFirstCandidateArtifacts: preserved.length, sourceScopeStatus: "clean", evidenceStatus: "in progress",
});
for (const [name, source] of [
  ["canonical-before.tap", "/tmp/byte-helper-trim-before.tap"],
  ["canonical-after.tap", "/tmp/byte-helper-trim-after.tap"],
  ["typecheck.txt", "/tmp/byte-helper-trim-typecheck.txt"],
  ["adjacent.tap", "/tmp/byte-helper-trim-adjacent.tap"],
]) copyFileSync(source, new URL(name, here));
const commands = [
  ["original20", process.execPath, ["--unhandled-rejections=strict", "--import", "./tests/stress/byte-ownership-20260827/trim-fix/binding.mjs", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "tests/stress/byte-ownership-20260827/ownership.test.ts"], 0],
  ["previous-binding-rejects", process.execPath, ["tests/stress/byte-ownership-20260827/fix/binding.mjs"], 1],
  ["original-binding-rejects", process.execPath, ["tests/stress/byte-ownership-20260827/binding.mjs"], 1],
];
const results = [];
for (const [name, command, args, expected] of commands) {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  writeFileSync(new URL(`${name}.txt`, here), result.stdout + result.stderr, { flag: "wx" });
  results.push({ name, command, args, started, finished: new Date().toISOString(), exitCode: result.status, expected });
  assert.equal(result.status, expected, name);
}
write("replay-results.json", results);
console.log(JSON.stringify(results, null, 2));
