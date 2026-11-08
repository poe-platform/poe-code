import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { resolve } from "node:path";
import {
  applyUnifiedPatch,
  assertExactRevision,
  verifyGitBase,
  verifyInventoryRecords,
} from "./overlay.mjs";

const checks = [];
const ok = name => checks.push({ name, status: "ok" });
const repository = resolve(new URL("../../../../", import.meta.url).pathname);
const { delta, patchBytes, patched } = await verifyGitBase(repository);
ok("exact immutable base, candidate, manifest, patch and one-file delta authenticate");

const syntax = spawnSync(process.execPath, ["--check", "--input-type=module", "-"], { input: patched, encoding: null });
assert.equal(syntax.status, 0, syntax.stderr.toString());
ok("complete patched harness parses without product imports");

function extract(source, begin, end) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  assert.ok(start >= 0 && finish > start, `missing extraction markers ${begin} / ${end}`);
  return source.slice(start + begin.length, finish);
}

const source = patched.toString("utf8");
const lineageRegion = extract(source, "// V9_LINEAGE_OVERLAY_BEGIN", "// V9_LINEAGE_OVERLAY_END");
const lineageContext = vm.createContext({ assert });
vm.runInContext(`${lineageRegion}\nglobalThis.api = { frozenLineageCaseIds, buildLineageByCaseId, lineageForCaseId, lineageByCaseId };`, lineageContext);
const { frozenLineageCaseIds, buildLineageByCaseId, lineageForCaseId, lineageByCaseId } = lineageContext.api;

const counts = Object.fromEntries([...lineageByCaseId.values()].reduce((entries, lineage) => {
  entries.set(lineage, (entries.get(lineage) ?? 0) + 1);
  return entries;
}, new Map()));
assert.deepEqual(JSON.parse(JSON.stringify(counts)), {
  "historical-frozen-derived": 31,
  "postfreeze-lifecycle-addition": 2,
  "v5-observer-policy-control": 7,
});
assert.equal(lineageByCaseId.size, 40);
ok("stable 40-ID map yields exactly 31 historical, 2 lifecycle and 7 observer records");

const originalTitle = "content-read and deterministic file-atime listing mutant trips independent guards";
const changedTitle = "arbitrary renamed display title with no lineage words";
assert.notEqual(originalTitle, changedTitle);
assert.equal(lineageForCaseId("V5-024"), "v5-observer-policy-control");
assert.equal(lineageForCaseId("V5-024"), "v5-observer-policy-control");
ok("V5-024 classification is unchanged by display-title mutation");

const cloneGroups = () => Object.fromEntries(Object.entries(frozenLineageCaseIds).map(([lineage, ids]) => [lineage, [...ids]]));
{
  const groups = cloneGroups();
  groups["v5-observer-policy-control"].push("V5-001");
  assert.throws(() => buildLineageByCaseId(groups), /duplicate frozen case ID/u);
}
ok("duplicate stable ID is rejected");
{
  const groups = cloneGroups();
  groups["postfreeze-lifecycle-addition"] = groups["postfreeze-lifecycle-addition"].filter(id => id !== "V5-040");
  assert.throws(() => buildLineageByCaseId(groups), /must contain exactly V5-001 through V5-040/u);
}
ok("missing stable ID is rejected");
{
  const groups = cloneGroups();
  groups["postfreeze-lifecycle-addition"][1] = "V5-bad";
  assert.throws(() => buildLineageByCaseId(groups), /malformed frozen case ID/u);
}
ok("malformed stable ID is rejected");
assert.throws(() => lineageForCaseId("V5-041"), /unknown recorded case ID/u);
ok("unknown stable ID is rejected");
{
  const groups = cloneGroups();
  groups["not-a-frozen-lineage"] = [];
  assert.throws(() => buildLineageByCaseId(groups), /invalid frozen lineage category/u);
}
ok("invalid lineage category is rejected");

const reportRegion = extract(source, "// V9_RECEIPT_AND_LINEAGE_ASSERTIONS_BEGIN", "// V9_RECEIPT_AND_LINEAGE_ASSERTIONS_END");
const records = Array.from({ length: 40 }, (_, index) => {
  const id = `V5-${String(index + 1).padStart(3, "0")}`;
  return {
    id,
    name: id === "V5-024" ? changedTitle : `synthetic focused receipt ${id}`,
    category: "focused-control",
    lineage: lineageForCaseId(id),
    pass: true,
    failures: [],
    target: {},
    observation: { retained: id },
  };
});

function runReport(inputRecords) {
  const program = [
    'import assert from "node:assert/strict";',
    `const results = ${JSON.stringify(inputRecords)};`,
    'const moduleRoot = "/synthetic-focused-module-root";',
    'const loadedFiles = [{ path: "/synthetic/module.js", bytes: 1, sha256: "00" }];',
    reportRegion,
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = result.stdout.toString();
  let receipt;
  try { receipt = JSON.parse(stdout); } catch (error) { throw new Error(`report stdout is not one complete JSON receipt: ${error.message}`); }
  return { result, receipt, stdout };
}

const accepted = runReport(records);
assert.equal(accepted.result.status, 0, accepted.result.stderr.toString());
assert.equal(accepted.receipt.results.length, 40);
assert.deepEqual(accepted.receipt.summary.byLineage, {
  "historical-frozen-derived": { total: 31, passed: 31, failed: 0 },
  "v5-observer-policy-control": { total: 7, passed: 7, failed: 0 },
  "postfreeze-lifecycle-addition": { total: 2, passed: 2, failed: 0 },
});
ok("exact extracted report region accepts the stable 31/2/7 receipt");

const wrongCategoryRecords = structuredClone(records);
wrongCategoryRecords[23].lineage = "historical-frozen-derived";
wrongCategoryRecords[23].observation.fullStats = "x".repeat(512 * 1024);
const wrongCategory = runReport(wrongCategoryRecords);
assert.notEqual(wrongCategory.result.status, 0);
assert.equal(wrongCategory.receipt.results.length, 40);
assert.equal(wrongCategory.receipt.results[23].observation.retained, "V5-024");
assert.equal(wrongCategory.receipt.results[23].observation.fullStats.length, 512 * 1024);
assert.equal(wrongCategory.receipt.summary.byLineage["historical-frozen-derived"].total, 32);
assert.match(wrongCategory.result.stderr.toString(), /32 !== 31/u);
ok("wrong category remains nonzero after emitting a complete 40-result JSON receipt");

const wrongCount = runReport(records.slice(0, 39));
assert.notEqual(wrongCount.result.status, 0);
assert.equal(wrongCount.receipt.results.length, 39);
assert.match(wrongCount.result.stderr.toString(), /actual Shell lifecycle|postfreeze lifecycle additions/u);
ok("wrong record count remains nonzero after emitting a complete JSON receipt");

assert.throws(
  () => assertExactRevision(repository, delta.candidate.commit, delta.base.commit),
  /revision must resolve to exact/u,
);
ok("wrong base revision is rejected");

const exactBaseInventory = [delta.changedFile.base, ...delta.untouchedFiles].map(record => ({ ...record }));
verifyInventoryRecords(exactBaseInventory, exactBaseInventory, "focused exact base");
const modifiedUntouched = exactBaseInventory.map(record => ({ ...record }));
modifiedUntouched.find(record => record.path === "CASE_MAP.md").sha256 = "0".repeat(64);
assert.throws(
  () => verifyInventoryRecords(modifiedUntouched, exactBaseInventory, "focused modified untouched"),
  /inventory differs from authenticated manifest delta/u,
);
ok("modified untouched-file hash is rejected");

const wrongHarness = Buffer.from(patched.subarray(0, delta.changedFile.base.bytes));
assert.throws(() => applyUnifiedPatch(wrongHarness, patchBytes), /wrong base verify-v5 bytes/u);
ok("overlay application rejects non-base harness bytes");

process.stdout.write(`${JSON.stringify({
  schema: 1,
  scope: "focused lineage, receipt and overlay authentication controls only",
  productImported: false,
  wholeCohortRun: false,
  checks,
}, null, 2)}\n`);
