import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, load, owner, record, repository, sha } from "./common.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const originalEvidence = "19da254941847de60e80ea18407332bbe10b5265";
const originalRunner = "91464989ff4c563195330cc3a7cacc4500c0bad0";
const originalProposal = "37b89260c16e51dbf3f825f111d5f5b3c5ea32e8";
const phase1 = "65a887ac7aa0e361216b827f9fedee20389bc609";
const phase2 = "bbb7f807f70c4db7014eee1f151a0ff51ee2a8a2";
const read = filename => readFileSync(filename, "utf8");
function frozenTree(commit, path, count) {
  const paths = git(repository, "ls-tree", "-r", "--name-only", commit, "--", path).toString().trim().split("\n");
  assert.equal(paths.length, count);
  return paths.map(filename => {
    const expected = git(repository, "show", `${commit}:${filename}`);
    const actual = record(join(repository, filename));
    assert.equal(actual.sha256, sha(expected), filename);
    return { path: filename, commit, ...actual };
  });
}
function section(text, start, end) {
  const first = text.indexOf(start);
  assert.ok(first >= 0, start);
  const last = text.indexOf(end, first);
  assert.ok(last > first, end);
  return text.slice(first, last);
}
export function verifyProfile() {
  const originalFiles = frozenTree(originalEvidence, owner, 74);
  const proposalFiles = frozenTree(originalProposal, `${owner}/validity-proposal`, 5);
  const signedRoot = "tests/integration/safejs-owned-output-prototype-review/validity-independent";
  const signed = [];
  for (const [commit, path] of [[phase1, `${signedRoot}/SIGNATURE.json`], [phase2, `${signedRoot}/phase2/REPORT.md`], [phase2, `${signedRoot}/phase2/SIGNATURE.json`]]) {
    const bytes = git(repository, "show", `${commit}:${path}`);
    assert.equal(record(join(repository, path)).sha256, sha(bytes));
    signed.push({ commit, path, sha256: sha(bytes) });
  }
  const cases = load(join(directory, "CASES.json"));
  const originalCasesText = git(repository, "show", `${originalEvidence}:${owner}/CASES.json`).toString();
  const originalCases = JSON.parse(originalCasesText);
  const proposed = load(join(repository, owner, "validity-proposal/PROPOSALS.json"));
  const revision = load(join(directory, "REVISION.json"));
  assert.equal(revision.originalEvidenceCommit, originalEvidence);
  assert.equal(revision.proposalCommit, originalProposal);
  assert.equal(revision.signedPhase1, phase1);
  assert.equal(revision.signedPhase2, phase2);
  assert.equal(revision.noPromotion, true);
  assert.deepEqual(revision.cohort, { rows: 11, workflows: 6, unchangedControls: 8, revisedBindings: 3 });
  assert.equal(read(join(directory, "CASES.json")), originalCasesText.replace('"maxRedirects": 0', '"maxRedirects": 1').replace('"maxRetries": 0', '"maxRetries": 1'));
  assert.deepEqual(cases.rows, originalCases.rows);
  assert.equal(cases.rows.length, 11);
  assert.deepEqual(cases.defaultSafeJsLimits, originalCases.defaultSafeJsLimits);
  assert.deepEqual(cases.containment, originalCases.containment);
  assert.deepEqual(cases.commonInputs, originalCases.commonInputs);
  assert.deepEqual(cases.errors, originalCases.errors);
  const revisedIds = ["L05-execution-error", "L06-curl-open", "L06-curl-consumer-closed"];
  assert.deepEqual(Object.keys(revision.variants), revisedIds);
  const selector = revision.variants[revisedIds[0]];
  const proposedSelector = proposed.proposals.find(entry => entry.proposalId === "L05-S1");
  assert.equal(selector.variantId, proposedSelector.futureVariantId);
  assert.equal(selector.publicSource, proposedSelector.inertSourceDelta.after);
  assert.equal(Buffer.byteLength(selector.publicSource), 13);
  assert.equal(Buffer.from(selector.publicSource.slice(cases.commonInputs.publicShellCommand.length)).toString("hex"), "0a29");
  assert.equal(selector.selectorDiagnostic, proposedSelector.newExactSelectorExpectation.attemptedDiagnostic);
  assert.equal(selector.selectorDiagnosticBytes, 37);
  assert.equal(Buffer.byteLength(selector.selectorDiagnostic), 37);
  assert.deepEqual(selector.expectedDiagnosticAttempts, ["safejs: execution:L05-execution-error\n", "shell: line 1: execution:L05-execution-error\n", "shell: line 1: cleanup:L05-execution-error\n", selector.selectorDiagnostic]);
  const proposedCurl = proposed.proposals.find(entry => entry.proposalId === "L06-C1");
  assert.deepEqual(cases.curlInputs.limits, proposedCurl.constructor.limits);
  assert.deepEqual(revisedIds.slice(1).map(id => revision.variants[id].variantId), proposedCurl.futureVariantIds);
  for (const id of revisedIds.slice(1)) assert.equal(revision.variants[id].publicSource, cases.commonInputs.publicShellCommand);
  assert.deepEqual(cases.rows.find(row => row.id === "L06-curl-open").expect, proposedCurl.unchangedExpectations.open);
  assert.deepEqual(cases.rows.find(row => row.id === "L06-curl-consumer-closed").expect, proposedCurl.unchangedExpectations.closed);
  assert.deepEqual(cases.rows.find(row => row.id === "L05-execution-error").expect, proposedSelector.unchangedPublicExpectation);
  for (const filename of ["common.mjs", "guard.mjs"]) assert.equal(sha(readFileSync(join(directory, filename))), sha(git(repository, "show", `${originalRunner}:${owner}/execution-v1/${filename}`)));
  const originalChild = git(repository, "show", `${originalRunner}:${owner}/execution-v1/child.mjs`).toString();
  const child = read(join(directory, "child.mjs"));
  const originalSections = [
    ["const deferred = () => {", 'try {\n  const product = await import("virtual-bash");'],
    ['try {\n  const product = await import("virtual-bash");', '  outer.commands.register({ name: "owned-guest"'],
    ['  outer.commands.register({ name: "owned-guest"', '      if (row.workflow === "L06") {'],
    ['        inner.commands.register({ name: "owned-curl"', '  const publicStdout = {'],
    ['  const publicStdout = {', '  const publicStderr = {'],
    ['  check("actual engine and supported helper admission"', '  report.classification = report.assertions.every'],
  ].map(([start, end], index) => {
    const original = section(originalChild, start, end);
    assert.ok(child.includes(original), `Original helper/engine/resource/input/assertion block ${index} changed`);
    return { start, end, bytes: Buffer.byteLength(original), sha256: sha(original) };
  });
  const unchangedControls = cases.rows.filter(row => !revisedIds.includes(row.id)).map(row => ({ id: row.id, sha256: sha(JSON.stringify(row)) }));
  assert.equal(unchangedControls.length, 8);
  const guests = [...new Set(cases.rows.map(row => row.guest))].map(path => ({ path, ...record(join(repository, owner, path)) }));
  return { originalEvidence, originalRunner, originalProposal, originalFiles: originalFiles.length, originalInventorySha256: sha(JSON.stringify(originalFiles)),
    proposalFiles: proposalFiles.length, proposalInventorySha256: sha(JSON.stringify(proposalFiles)), signed, unchangedControls,
    allElevenOriginalRowObjectsAndExpectationsIdentical: true, onlyCasesByteDelta: ["maxRedirects: 0 -> 1", "maxRetries: 0 -> 1"],
    originalSections, guests, rowBranchIdsUnchanged: true, errorConstructionUnchanged: child.includes('const executionError = new Error(`execution:${row.id}`);\nconst cleanupError = new Error(`cleanup:${row.id}`);'),
    revisionSha256: record(join(directory, "REVISION.json")).sha256, casesSha256: record(join(directory, "CASES.json")).sha256,
    runtimeOrPrivateExecutionDuringThisVerification: false, noPromotion: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyProfile(), null, 2));
