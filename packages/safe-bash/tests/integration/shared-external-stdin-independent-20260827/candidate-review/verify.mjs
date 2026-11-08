import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async filename => JSON.parse(await readFile(path.join(here, filename), "utf8"));
const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here }).toString().trim();
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const seal = await json("SEAL.json");
const entries = [];
async function visit(relative) {
  const full = path.join(here, relative);
  const stat = await lstat(full);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) {
    const names = (await readdir(full)).sort();
    assert.ok(names.length, `unexpected empty directory ${relative}`);
    for (const name of names) await visit(path.join(relative, name));
  } else {
    assert.ok(stat.isFile());
    const bytes = await readFile(full);
    entries.push({ path: relative, size: bytes.length, sha256: hash(bytes) });
  }
}
await visit("evidence");
entries.sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(entries, seal.files, "immutable capture bytes/inventory changed, including new entries");
const freeze = await json("FREEZE.json");
assert.equal(hash(await readFile(path.join(here, "run.mjs"))), freeze.adapterSha256);
assert.equal(seal.candidate, freeze.candidate);
const owned = "tests/integration/shared-external-stdin-independent-20260827/candidate-review";
assert.ok(git(["show", `${seal.mainAdapterCommit}:${owned}/run.mjs`]).equals(await readFile(path.join(here, "run.mjs"))));
for (const filename of ["supplement.mjs", "column-close.mjs"]) assert.ok(git(["show", `${seal.supplementAdapterCommit}:${owned}/${filename}`]).equals(await readFile(path.join(here, filename))));
const authentication = await json("evidence/replay/authentication.json");
const after = await json("evidence/replay/integrity-after.json");
assert.equal(authentication.candidate, seal.candidate);
const archivePaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md", "AGENTS.md"];
const sourcePaths = git(["ls-tree", "-rz", seal.candidate, "--", ...archivePaths]).toString().split("\0").filter(Boolean).map(line => line.split("\t")[1]);
assert.deepEqual(authentication.archive.tree.map(entry => entry.path), sourcePaths);
for (const entry of authentication.archive.tree) {
  assert.equal(hash(git(["show", `${seal.candidate}:${entry.path}`])), entry.sha256);
  assert.equal(authentication.buildBefore.find(item => item.path === entry.path)?.sha256, entry.sha256);
}
assert.deepEqual(after.buildAfter, authentication.buildBefore);
assert.deepEqual(after.consumerAfter, authentication.consumerBefore);
assert.equal(after.sourceArchiveSha256, authentication.archive.sha256);
assert.equal(after.packageSha256, authentication.pack.sha256);
assert.equal(after.runtimeSha256, authentication.runtime.sha256);
assert.equal(after.ownedActiveChildren, 0);
const expected = { original32: [32, 24], provisional35: [35, 33] };
const commands = await json("evidence/replay/commands.json");
assert.ok(commands.every(command => command.closed && !command.expired && !command.overLimit));
for (const cohort of freeze.cohorts) {
  for (const file of cohort.files) {
    const captured = await json(`evidence/replay/${cohort.name}-${file.path}.json`);
    const bytes = Buffer.from(captured.bytesBase64, "base64");
    assert.equal(hash(bytes), file.sha256);
    assert.ok(bytes.equals(git(["show", `${cohort.fixtureCommit}:tests/integration/shared-external-stdin-independent-20260827/${file.path}`])));
    assert.equal(authentication.consumerBefore.find(entry => entry.path === `${cohort.name}/${file.path}`)?.sha256, file.sha256);
  }
  const report = await json(`evidence/replay/${cohort.name}-cohort.json`);
  assert.deepEqual([report.count, report.passes], expected[cohort.name]);
  assert.equal(report.rows.filter(row => row.pass).length, report.passes);
  const behaviorCommands = commands.filter(command => command.label.startsWith(`${cohort.name}-`) && !command.label.startsWith(`${cohort.name}-control-`));
  assert.equal(behaviorCommands.length, report.count);
  assert.ok(behaviorCommands.every(command => command.args.includes("--unhandled-rejections=strict")));
  for (const row of report.rows) {
    const command = behaviorCommands.find(entry => entry.label === `${cohort.name}-${row.id}`);
    assert.equal(command.status, row.status);
    assert.equal(row.pass, row.status === 0 && row.result?.pass === true);
  }
  const swallow = await json(`evidence/replay/${cohort.name}-control-bad-swallow.json`);
  assert.equal(swallow.pass, false);
  assert.ok(swallow.failure.message.includes("expected rejection"));
  const unhandled = commands.find(entry => entry.label === `${cohort.name}-control-late-unhandled`);
  assert.equal(unhandled.status, 1);
  assert.ok(unhandled.stderr.includes("independent-late-return"));
}
const loads = await json("evidence/replay/loaded-modules.json");
let loadedCount = 0;
for (const receipt of loads) {
  const bytes = await readFile(path.join(here, `evidence/replay/${receipt.label}.loads.jsonl`));
  assert.equal(hash(bytes), receipt.sha256);
  assert.deepEqual(bytes.toString().trim().split("\n").map(line => JSON.parse(line)), receipt.modules);
  for (const entry of receipt.modules) assert.equal(authentication.consumerBefore.find(item => item.path === path.relative(authentication.consumer, entry.filename))?.sha256, entry.sha256);
  assert.ok(receipt.modules.some(entry => entry.filename === path.join(authentication.consumer, "node_modules/virtual-bash/dist/index.js")));
  loadedCount += receipt.modules.length;
}
const supplementary = await json("evidence/supplement/authentication.json");
const supplementaryAfter = await json("evidence/supplement/integrity-after.json");
assert.deepEqual(supplementaryAfter.after, supplementary.before);
assert.equal(supplementaryAfter.originalSourceAndConsumerUnchanged, true);
assert.equal(supplementaryAfter.ownedActiveChildren, 0);
for (const entry of supplementary.before.filter(item => item.path.startsWith("node_modules/virtual-bash/"))) assert.deepEqual(entry, authentication.consumerBefore.find(item => item.path === entry.path));
for (const input of supplementary.inputs) {
  const bytes = Buffer.from(input.sourceBytesBase64, "base64");
  assert.equal(hash(bytes), input.sha256);
  assert.ok(bytes.equals(git(["show", `${input.commit}:${input.path}`])));
}
for (const receipt of supplementaryAfter.loaded) {
  const bytes = await readFile(path.join(here, `evidence/supplement/${receipt.label}.loads.jsonl`));
  assert.equal(hash(bytes), receipt.sha256);
  assert.deepEqual(bytes.toString().trim().split("\n").map(line => JSON.parse(line)), receipt.modules);
  for (const entry of receipt.modules) assert.equal(supplementary.before.find(item => item.path === path.relative(supplementary.consumer, entry.filename))?.sha256, entry.sha256);
  loadedCount += receipt.modules.length;
}
const supplementSummary = await json("evidence/supplement/summary.json");
assert.deepEqual(supplementSummary.focused, { status: 0, tests: 22, pass: 22, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(supplementSummary.original34.counts, { observations: 34, verified: 25, unexpected: 9, retainedDefectRows: 0 });
assert.deepEqual(supplementSummary.original34.unhandled, []);
assert.deepEqual(supplementSummary.column6, { status: 1, count: 6, passes: 0 });
const column = await json("evidence/supplement/column-targeted6.json");
assert.ok(column.rows.every(row => !row.pass && row.observed.stderr === "column: EFBIG: column input limit exceeded\n" && row.failure.message.includes("column: input limit exceeded")));
const supplementCommands = await json("evidence/supplement/commands.json");
assert.ok(supplementCommands.every(command => command.closed && !command.expired && !command.overLimit));
const originalEntries = entries.length;
await visit("falsy-evidence");
const falsySeal = await json("falsy-SEAL.json");
assert.deepEqual(entries.slice(originalEntries).sort((left, right) => left.path.localeCompare(right.path)), falsySeal.files);
const falsy = await json("falsy-evidence/authentication.json");
const falsyAfter = await json("falsy-evidence/integrity-after.json");
assert.equal(falsy.candidate, seal.candidate);
assert.equal(falsy.freezeCommit, falsySeal.fixtureCommit);
for (const filename of ["falsy-probe.mjs", "falsy-run.mjs"]) assert.ok(git(["show", `${falsy.freezeCommit}:${owned}/${filename}`]).equals(await readFile(path.join(here, filename))));
assert.deepEqual(falsyAfter.after, falsy.before);
assert.equal(falsyAfter.originalSourceAndConsumerUnchanged, true);
assert.equal(falsyAfter.ownedActiveChildren, 0);
for (const entry of falsy.before.filter(item => item.path.startsWith("node_modules/virtual-bash/"))) assert.deepEqual(entry, authentication.consumerBefore.find(item => item.path === entry.path));
const falsyLoads = (await readFile(path.join(here, "falsy-evidence/loads.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
assert.deepEqual(falsyLoads, falsyAfter.loaded);
for (const entry of falsyLoads) assert.equal(falsy.before.find(item => item.path === path.relative(falsy.consumer, entry.filename))?.sha256, entry.sha256);
loadedCount += falsyLoads.length;
assert.deepEqual(await json("falsy-evidence/summary.json"), { count: 5, passes: 5, failures: [], status: 0, closed: true, ownedActiveChildren: 0 });
const falsyCommand = await json("falsy-evidence/command.json");
assert.ok(falsyCommand.closed && !falsyCommand.expired && !falsyCommand.overLimit && falsyCommand.args.includes("--unhandled-rejections=strict"));
console.log(`Verified ${entries.length} immutable files and ${loadedCount} loaded-byte receipts: original 24/32, provisional 33/35, four controls detected; author22 22/22, original34 25 matches/nine changed; column supplement 0/6 retained fixture failures; separate authorized falsy 5/5. Cleanup zero; no automatic rebaseline or full acceptance.`);
