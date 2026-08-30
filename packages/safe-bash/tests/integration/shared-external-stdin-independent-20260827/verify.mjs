import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "evidence");
const seal = JSON.parse(await readFile(path.join(here, "SEAL.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = async filename => JSON.parse(await readFile(path.join(root, filename), "utf8"));
const inventory = [];
async function visit(relative) {
  const full = path.join(root, relative);
  const stat = await lstat(full);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) { inventory.push({ path: relative || ".", kind: "directory" }); for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name)); }
  else { const bytes = await readFile(full); inventory.push({ path: relative, kind: "file", size: bytes.length, sha256: hash(bytes) }); }
}
await visit("");
assert.deepEqual(inventory, seal.inventory, "sealed evidence changed, lost or gained entries");
let loadCount = 0;
for (const attempt of seal.attempts) {
  const directory = `attempt-${attempt.id}`;
  const authentication = await read(`${directory}/authentication.json`);
  assert.equal(authentication.baseline, seal.baseline);
  assert.equal(authentication.fixtureCommit, attempt.fixture);
  for (const entry of authentication.archive.tree) {
    const blob = execFileSync("git", ["show", `${seal.baseline}:${entry.path}`], { cwd: here, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(hash(blob), entry.sha256, `exact committed source ${entry.path}`);
  }
  for (const filename of ["cases.mjs", "probe.mjs", "loader.mjs"]) {
    const captured = await readFile(path.join(root, directory, `${filename}.txt`));
    const committed = execFileSync("git", ["show", `${attempt.fixture}:tests/integration/shared-external-stdin-independent-20260827/${filename}`], { cwd: here });
    assert.ok(captured.equals(committed));
  }
  const commands = await read(`${directory}/commands.json`);
  assert.ok(commands.every(command => command.closed && !command.expired && !command.overLimit));
  if (attempt.id === 1) { assert.equal(commands.at(-1).status, 1); continue; }
  const after = await read(`${directory}/integrity-after.json`);
  assert.deepEqual(after.buildAfter, authentication.buildBefore);
  assert.deepEqual(after.consumerAfter, authentication.consumerBefore);
  assert.equal(after.sourceArchiveSha256, authentication.archive.sha256);
  assert.equal(after.packageSha256, authentication.pack.sha256);
  assert.equal(after.runtimeSha256, authentication.runtime.sha256);
  assert.equal(after.ownedActiveChildren, 0);
  const loads = await read(`${directory}/loaded-modules.json`);
  for (const receipt of loads) {
    const bytes = await readFile(path.join(root, directory, `${receipt.label}.loads.jsonl`));
    assert.equal(hash(bytes), receipt.sha256);
    const rows = bytes.toString().trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows, receipt.modules);
    assert.equal(rows.length, receipt.count);
    for (const loaded of rows) {
      const relative = path.relative(authentication.consumer, loaded.filename);
      assert.equal(authentication.consumerBefore.find(entry => entry.path === relative)?.sha256, loaded.sha256);
      assert.equal(after.consumerAfter.find(entry => entry.path === relative)?.sha256, loaded.sha256);
    }
    loadCount += rows.length;
  }
  const summary = await read(`${directory}/summary.json`);
  const cohort = await read(`${directory}/baseline-cohort.json`);
  assert.equal(cohort.count, attempt.id === 2 ? 32 : 35);
  assert.equal(cohort.rows.filter(row => row.pass).length, attempt.id === 2 ? 18 : 25);
  assert.equal(summary.controlsDetected, 2);
  assert.equal(summary.watchdogExpiries, 0);
  const swallow = await read(`${directory}/control-bad-swallow.json`);
  assert.equal(swallow.pass, false);
  assert.ok(swallow.failure.message.includes("expected rejection"));
  const unhandled = commands.find(command => command.label === "control-late-unhandled");
  assert.equal(unhandled.status, 1);
  assert.ok(unhandled.stderr.includes("independent-late-return"));
  const controlStart = commands.findIndex(command => command.label === "control-bad-swallow");
  assert.equal(commands.slice(0, controlStart).filter(command => command.args.includes("--unhandled-rejections=strict")).length, cohort.count);
}
console.log(`Verified immutable original/provisional evidence: ${inventory.filter(entry => entry.kind === "file").length} files, ${loadCount} loaded-module receipts; original 18/32, provisional 25/35; no candidate acceptance.`);
