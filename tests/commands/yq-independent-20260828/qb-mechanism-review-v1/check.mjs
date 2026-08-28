import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "/Users/kjopek/Workspace/safe-bash";
const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...arguments_) => execFileSync("git", arguments_, { cwd: root, maxBuffer: 1048576 });
const data = load("CASES.json");
const identities = load("SOURCE_IDENTITY.json");
const window = 1023;
const maximum = Number.MAX_SAFE_INTEGER;
assert.equal(data.window, window);
assert.equal(data.schema, "yq-qb-mechanism-independent-cases/1");
assert.equal(git("rev-parse", "--show-toplevel").toString().trim(), root);

function refusal(stage) { throw new RangeError(stage); }
function checkedAddition(left, right, stage, trace) {
  if (right > maximum - left) refusal(stage);
  trace?.push(stage);
  return left + right;
}
function claimedPlan(pending, units, trace) {
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > window) refusal("pending");
  if (!Number.isSafeInteger(units) || units < 0) refusal("units");
  if (units === 0) return { checkpoints: 0, finalPending: pending, cost: 0 };
  const sum = checkedAddition(pending, units, "sum", trace);
  const checkpoints = Math.floor((sum - 1) / window);
  if (checkpoints !== 0 && window > Math.floor(maximum / checkpoints)) refusal("product");
  const covered = checkpoints * window;
  assert.ok(covered < sum);
  return { checkpoints, finalPending: sum - covered, cost: checkedAddition(units, checkpoints, "total", trace) };
}
function enumerateOrdinaryUnits(pending, units) {
  assert.ok(units <= 2048);
  let checkpoints = 0;
  let finalPending = pending;
  for (let unit = 0; unit < units; unit++) {
    if (finalPending === window) { checkpoints++; finalPending = 0; }
    finalPending++;
  }
  return { checkpoints, finalPending, cost: units + checkpoints };
}
const rowGroups = ["scheduleRows", "sequenceRows", "admissionRows", "refusalRows", "payloadRows", "mutationRows", "traceRows"];
const rows = new Map();
for (const group of rowGroups) for (const row of data[group]) {
  assert.ok(!rows.has(row.id), row.id);
  rows.set(row.id, row);
}
assert.equal(rows.size, 64);
assert.deepEqual(rowGroups.map(group => data[group].length), [16, 5, 8, 9, 4, 10, 12]);
for (const row of data.scheduleRows) {
  const expected = { checkpoints: row.checkpoints, finalPending: row.finalPending, cost: row.cost };
  assert.deepEqual(enumerateOrdinaryUnits(row.pending, row.units), expected, row.id);
  assert.deepEqual(claimedPlan(row.pending, row.units), expected, row.id);
  assert.equal(row.cost + Number(row.finalPending === window), row.terminalCloseCost, row.id);
}
for (const row of data.sequenceRows) {
  const estimate = enumerateOrdinaryUnits(row.pending, row.estimateUnits);
  const copy = enumerateOrdinaryUnits(estimate.finalPending, row.copyUnits);
  assert.equal(estimate.cost, row.estimateCost, row.id);
  assert.equal(estimate.finalPending, row.postEstimatePending, row.id);
  assert.equal(copy.cost, row.copyCost, row.id);
  assert.equal(copy.finalPending, row.finalPending, row.id);
  assert.equal(estimate.cost + copy.cost, row.combinedCost, row.id);
  assert.deepEqual(claimedPlan(estimate.finalPending, row.copyUnits), copy, row.id);
}
for (const row of data.admissionRows) {
  const schedule = rows.get(row.schedule);
  assert.equal(schedule.cost <= row.remaining, row.beforeNextAdmits, row.id);
  assert.equal(schedule.terminalCloseCost <= row.remaining, row.terminalCloseAdmits, row.id);
}
for (const row of data.refusalRows) {
  const trace = [];
  assert.throws(() => claimedPlan(row.pending, row.units, trace), error => error instanceof RangeError && error.message === row.stage, row.id);
  assert.ok(!trace.includes(row.stage), `${row.id}: refused addition must not execute`);
}
const partitionedPayload = operations => operations.reduce((total, fragments) => total + Math.ceil(fragments.reduce((sum, bytes) => sum + bytes, 0) / 1024), 0);
const mergedPayload = operations => Math.ceil(operations.flat().reduce((sum, bytes) => sum + bytes, 0) / 1024);
const fragmentedPayload = operations => operations.flat().reduce((total, bytes) => total + Math.ceil(bytes / 1024), 0);
for (const row of data.payloadRows) {
  assert.equal(partitionedPayload(row.operations), row.units, row.id);
  if (row.mergedMutation !== undefined) assert.equal(mergedPayload(row.operations), row.mergedMutation, row.id);
  if (row.fragmentMutation !== undefined) assert.equal(fragmentedPayload(row.operations), row.fragmentMutation, row.id);
}
for (const row of data.mutationRows) {
  const schedule = rows.get(row.schedule);
  const sequence = rows.get(row.sequence);
  const payload = rows.get(row.payload);
  let original;
  let mutant;
  switch (row.mutation) {
    case "charge-terminal-checkpoint-as-if-before-next":
      original = claimedPlan(schedule.pending, schedule.units).checkpoints;
      mutant = Math.floor((schedule.pending + schedule.units) / window); break;
    case "ignore-carried-pending":
      original = claimedPlan(schedule.pending, schedule.units).checkpoints;
      mutant = claimedPlan(0, schedule.units).checkpoints; break;
    case "omit-zero-unit-branch":
      original = claimedPlan(schedule.pending, schedule.units).checkpoints;
      mutant = Math.floor((schedule.pending + schedule.units - 1) / window); break;
    case "use-pre-estimation-pending":
      original = claimedPlan(sequence.postEstimatePending, sequence.copyUnits).cost;
      mutant = claimedPlan(sequence.pending, sequence.copyUnits).cost; break;
    case "call-real-tick-again-after-reserve":
      original = schedule.cost; mutant = schedule.cost + schedule.checkpoints; break;
    case "silently-reset-final-pending":
      original = claimedPlan(schedule.finalPending, row.nextUnits).cost;
      mutant = claimedPlan(0, row.nextUnits).cost; break;
    case "merge-distinct-payload-operations":
      original = partitionedPayload(payload.operations); mutant = mergedPayload(payload.operations); break;
    case "charge-each-execution-fragment":
      original = partitionedPayload(payload.operations); mutant = fragmentedPayload(payload.operations); break;
    case "check-after-unsafe-addition": {
      const input = rows.get(row.refusal);
      const trace = [];
      assert.throws(() => claimedPlan(input.pending, input.units, trace));
      assert.equal(trace.length, row.expectedUnsafeAdditions);
      const uncheckedSum = input.pending + input.units;
      assert.equal(Number(!Number.isSafeInteger(uncheckedSum)), row.mutantUnsafeAdditions);
      continue;
    }
    case "omit-reserved-checkpoint-cost":
      original = schedule.cost; mutant = schedule.units; break;
    default: assert.fail(row.mutation);
  }
  assert.equal(original, row.expected, row.id);
  assert.equal(mutant, row.mutant, row.id);
  assert.notEqual(mutant, original, row.id);
}
for (const row of data.traceRows) {
  assert.ok(row.events.length >= 2 && row.events.every(event => typeof event === "string"));
  assert.equal(typeof row.basis, "string");
  assert.equal(typeof row.expect.outcome, "string");
  assert.equal(row.expect.refund, 0);
  if (row.stage === "reservation-active") assert.equal(row.expect.interleaving, false);
}
assert.equal(rows.get("T06").expect.allocation, false);
assert.equal(rows.get("T07").expect.publication, false);
assert.equal(rows.get("T03").expect.pendingReset, false);
assert.equal(rows.get("T04").expect.pendingReset, false);
assert.equal(rows.get("T05").expect.pendingReset, false);
assert.deepEqual(data.execution, { product: 0, native: 0, authorChecker: 0, existingCheckers: 0 });

const sourceBytes = new Map();
assert.equal(identities.entries.length, 20);
for (const entry of identities.entries) {
  assert.match(entry.revision, /^[0-9a-f]{40}$/u);
  assert.ok(!entry.path.startsWith("/") && !entry.path.split("/").includes("..") && !entry.path.endsWith("AGENTS.md"));
  const key = `${entry.revision}:${entry.path}`;
  assert.ok(!sourceBytes.has(key));
  const bytes = git("show", key);
  assert.equal(digest(bytes), entry.sha256, key);
  assert.equal(bytes.length, entry.bytes, key);
  assert.equal(git("rev-parse", key).toString().trim(), entry.gitBlob, key);
  sourceBytes.set(key, bytes);
}
const authorPath = "tests/commands/yq-design-20260828/qb-policy-v1/README.md";
const base = sourceBytes.get(`89e403e080ba2ac051bcc19a634d9e964620152d:${authorPath}`);
const latest = sourceBytes.get(`6620463abdf7e952aaa855abfba13159a6c5cc83:${authorPath}`);
assert.equal(digest(latest), "96a7ae5aa36cec464a28d9ba09cfcd9791cb0dd09e80a51a6fc203cdd87b7ac6");
assert.ok(latest.subarray(0, base.length).equals(base));
const expectedBasePaths = ["README.md", "check-accounting.mjs", "controls.json", "identity.json"].map(name => `tests/commands/yq-design-20260828/qb-policy-v1/${name}`);
const expectedClarificationPaths = ["README.md", "identity.json"].map(name => `tests/commands/yq-design-20260828/qb-policy-v1/${name}`);
assert.deepEqual(identities.baseChangedPaths, expectedBasePaths);
assert.deepEqual(identities.clarificationChangedPaths, expectedClarificationPaths);
for (const [revision, expected] of [[identities.binding.authorBase, expectedBasePaths], [identities.binding.authorClarification, expectedClarificationPaths]]) {
  assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", revision).toString().trim().split("\n"), expected);
}
assert.ok(sourceBytes.get("5137a74ec855a32d8a8860eb66b62eb44d11e290:src/commands/structured/limits.ts").equals(sourceBytes.get("74361026502d76b8c2b696f9c60e410ac9b78d95:src/commands/structured/limits.ts")));
console.log(JSON.stringify({
  status: "STATIC_CHECKS_PASS_ROOT_TERMINAL_POLICY_HELD",
  originalRows: rows.size,
  arithmeticAndMutationRows: 52,
  traceSchemaRecordsOnly: 12,
  detectedArithmeticMutations: data.mutationRows.length,
  selectedGitInputs: sourceBytes.size,
  casesSha256: digest(readFileSync(new URL("CASES.json", import.meta.url))),
  identitySha256: digest(readFileSync(new URL("SOURCE_IDENTITY.json", import.meta.url))),
  policySelected: false,
  runtimeCancellationTests: 0,
  productExecutions: 0,
  nativeExecutions: 0,
  authorCheckerExecutions: 0,
  existingCheckerExecutions: 0,
  evidenceWrites: 0,
  qualification: "Arithmetic and static trace/source checks only; author's 23 rows not run or counted; no implementation proof.",
}, null, 2));
