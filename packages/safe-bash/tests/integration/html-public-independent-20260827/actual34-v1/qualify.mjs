import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileHash, frozen, git, here, inventory, json, parse, repository, sha256 } from "./common.mjs";
import { supervise } from "./supervisor.mjs";
const [commit] = process.argv.slice(2);
assert.match(commit, /^[a-f0-9]{40}$/u);
const manifest = parse(join(here, "MANIFEST.json"));
assert.equal(sha256(git(["show", `${commit}:${relative(repository, join(here, "MANIFEST.json"))}`])), fileHash(join(here, "MANIFEST.json")));
for (const [path, hash] of Object.entries(manifest.files)) {
  assert.equal(fileHash(join(here, path)), hash);
  assert.equal(sha256(git(["show", `${commit}:${relative(repository, join(here, path))}`])), hash);
}
const output = join(here, "qualification-01"), work = join(here, "node_modules/qualification-work");
mkdirSync(output); mkdirSync(work, { recursive: true });
for (const name of ["audit-loader.mjs", "harness-fixture.mjs"]) cpSync(join(here, name), join(work, name));
cpSync(join(frozen, "loader.mjs"), join(work, "loader.mjs"));
const map = inventory(work);
json(join(work, "load-map.json"), map);
const env = { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, HTML_FIXTURE_ROOT: work };
const rows = [];
const args = ["--experimental-loader", "./loader.mjs", "--experimental-loader", "./audit-loader.mjs", "./harness-fixture.mjs"];
for (const [name, mode, expected] of [["positive", "positive", 0], ["natural-exit7", "exit7", 7]]) {
  const raw = await supervise(join(output, name), process.execPath, args, { cwd: work, env: { ...env, HTML_QUALIFICATION_MODE: mode } });
  assert.equal(raw.code, expected); assert.match(raw.stderr, /HTML_ACTUAL_LOAD:.*harness-fixture\.mjs/u);
  if (!expected) assert.match(raw.stdout, /HTML_HARNESS_ONLY_POSITIVE/u);
  rows.push({ name, expected, actual: raw.code, closed: raw.closed });
}
await assert.rejects(supervise(join(output, "deadline"), process.execPath, ["./harness-fixture.mjs"], { cwd: work, env: { ...env, HTML_QUALIFICATION_MODE: "hang" }, timeoutMs: 300 }), /BOUNDARY:SUPERVISOR_STOP/u);
const timeout = parse(join(output, "deadline/RAW.json"));
assert.equal(timeout.stopReason, "external-deadline-not-product-pass"); assert.equal(timeout.closed, true); assert.equal(timeout.ps.members.length, 0);
rows.push({ name: "deadline", status: "expected supervisor rejection; intentional harness kill, not product settlement", signals: timeout.signals });
writeFileSync(join(work, "load-map.json"), JSON.stringify({ ...map, "harness-fixture.mjs": "0".repeat(64) }));
const corrupt = await supervise(join(output, "wrong-load-hash"), process.execPath, args, { cwd: work, env });
assert.equal(corrupt.code, 1); assert.match(corrupt.stderr, /BOUNDARY:ACTUAL_LOAD_HASH:harness-fixture\.mjs/u); assert.ok(!corrupt.stdout.includes("HTML_HARNESS_ONLY_POSITIVE"));
rows.push({ name: "wrong-load-hash", status: "expected denial before fixture execution" });
json(join(output, "RESULT.json"), { status: "HARNESS_ONLY_4_EXPECTED", commit, manifestSha256: fileHash(join(here, "MANIFEST.json")), rows, productLoads: 0, runtimeCases: 0, at: new Date().toISOString(), frozenLoaderSha256: fileHash(join(frozen, "loader.mjs")) });
console.log(JSON.stringify({ status: "HARNESS_ONLY_4_EXPECTED", productLoads: 0 }));
