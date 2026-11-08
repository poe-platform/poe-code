import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const owned = "tests/shell-stress/canonical-profile-migration";
const read = name => JSON.parse(readFileSync(`${owned}/${name}`));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function publish(name, value) {
  const path = `${owned}/${name}`;
  assert.equal(existsSync(path), false);
  execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${path}\n${JSON.stringify(value, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`], { maxBuffer: 1024 * 1024 });
}
const inputs = read("inputs.json");
const native = read("native.json");
const execution = read("product.json");
const product = JSON.parse(execution.product.stdout);
assert.equal(product.rows.length, 88);
assert.equal(native.rows.length, 352);
const effects = entries => Object.fromEntries(Object.entries(entries).map(([path, row]) => [path, { type: row.type, ...(row.hex !== undefined ? { hex: row.hex } : {}) }]));
const comparisons = [];
for (const profile of native.profiles) for (const invocationName of ["shell-stress", "shell"]) {
  const rows = product.rows.map(actual => {
    const expected = native.rows.find(row => row.profile === profile.id && row.invocationName === invocationName && row.cohort === actual.cohort && row.name === actual.name);
    assert.ok(expected);
    const differingFields = ["status", "stdoutHex", "stderrHex"].filter(key => actual[key] !== expected[key]);
    if (!isDeepStrictEqual(effects(actual.after), effects(expected.after))) differingFields.push("fileTypesAndBytes");
    return { cohort: actual.cohort, name: actual.name, differingFields, fullModeEffectsEqual: isDeepStrictEqual(actual.after, expected.after), native: expected, safeplugin: actual };
  });
  comparisons.push({ profile: profile.id, invocationName, total: rows.length, exactExistingTuple: rows.filter(row => row.differingFields.length === 0).length, exactIncludingModes: rows.filter(row => row.differingFields.length === 0 && row.fullModeEffectsEqual).length, rows });
}
const discoveryPath = "tests/shell/invocation-discovery-fixes-native.json";
const closurePath = "tests/shell-stress/invocation-closure/native-preparation.json";
const discovery = JSON.parse(inputs.originals[discoveryPath].text);
const closure = JSON.parse(inputs.originals[closurePath].text);
assert.equal(discovery.casesSha256, inputs.originals["tests/shell/invocation-discovery-fixes-cases.ts"].sha256);
assert.equal(closure.cohortHash, inputs.originals["tests/shell-stress/invocation-closure/cases.ts"].sha256);
assert.deepEqual(discovery.profiles.map(profile => profile.observations.length), [52, 52]);
assert.deepEqual(closure.profiles.map(profile => profile.rows.length), [26, 26]);
for (const proof of [discovery, closure]) for (const profile of proof.profiles) assert.ok(native.profiles.some(pin => pin.executable === profile.executable && pin.sha256 === (profile.executableHash ?? profile.expectedHash)));
const policy = {
  "query-V-verbose": { status: 0, stdout: "printf is a registered command\nclosurefn is a function\nclosurefn () \n{ \n    :\n}\nclosuretool is /work/tools/closuretool\n", stderrHex: "" },
  "type-multiple-status": { status: 0, stdout: "command\nfunction\nfile\nmixed:1\nprintf is a registered command\nclosuretool is tools/closuretool\n", stderrHex: "" },
};
const closureRun = execution.runs.find(run => run.path.endsWith("invocation-closure/holdout.test.ts"));
for (const [id, expected] of Object.entries(policy)) {
  expected.stdoutHex = Buffer.from(expected.stdout).toString("hex");
  const match = closureRun.stdout.match(new RegExp(`id=${id}; pid=\\d+; stdoutHex=([0-9a-f]+)`));
  assert.ok(match);
  const actual = JSON.parse(Buffer.from(match[1], "hex").toString());
  assert.equal(actual.exitCode, expected.status);
  assert.equal(actual.stdoutHex, expected.stdoutHex);
  assert.equal(actual.stderrHex, expected.stderrHex);
}
const inventory = inputs.failures.map(row => {
  const original = { path: row.path, testName: row.name, sourceAssertionLine: row.originalSourceLine, classification: row.classification, rawOriginalFailure: row.observed };
  if (row.classification === "historical-bash32-profile") {
    const [, mode, name] = row.name.split("/");
    return { ...original, kind: "uniform-primary-discovery-profile", originalNative: discovery.profiles[1].observations.find(candidate => candidate.mode === mode && candidate.name === name), proposedNative: discovery.profiles[0].observations.find(candidate => candidate.mode === mode && candidate.name === name), change: "Canonical execution uses the entire GNU-5.3 profile, not selected rows; historical strict52 retained in separately executable profile and immutable capture. No expected bytes rewritten." };
  }
  if (row.classification === "registered-command-label") {
    const id = row.name.replace("closure primary: ", "");
    return { ...original, kind: "safeplugin-not-native-parity", nativePrimary: closure.profiles[0].rows.find(candidate => candidate.id === id), nativeHistorical: closure.profiles[1].rows.find(candidate => candidate.id === id), proposedPolicyTuple: policy[id], change: "Two explicit full literal safeplugin tuples, not blanket builtin-word replacement; preserve primary/native bytes as mismatch evidence and keep status/stderr/path checks." };
  }
  const cohort = row.path.includes("current-gaps") ? "current-gaps" : "differential";
  const name = row.name.replace(/^(?:Bash differential|remaining-gap independent Bash): /u, "");
  return { ...original, kind: "uniform-primary-and-invocation-protocol", originalHistorical: native.rows.find(candidate => candidate.profile === "Bash3.2-historical" && candidate.invocationName === "shell-stress" && candidate.cohort === cohort && candidate.name === name), proposedNative: native.rows.find(candidate => candidate.profile === "GNU5.3-primary" && candidate.invocationName === "shell" && candidate.cohort === cohort && candidate.name === name), product: product.rows.find(candidate => candidate.cohort === cohort && candidate.name === name), change: "Uniform -c EXACT_SCRIPT shell protocol across complete72+5+11 cohorts; only invocation-name argument changes, not script text/line numbering/diagnostic bytes. Existing tuple assertions remain exact." };
});
assert.equal(inventory.length, 27);
const oldNativePath = "tests/integration/full-gate-20260827/evidence/native/report.json";
const oldNativeBytes = readFileSync(oldNativePath);
publish("historical-fullgate-native.json", { path: oldNativePath, sha256: hash(oldNativeBytes), original: JSON.parse(oldNativeBytes) });
publish("comparison.json", { comparisons, reusedDiscovery: { path: discoveryPath, sha256: inputs.originals[discoveryPath].sha256, observations: 104 }, reusedClosure: { path: closurePath, sha256: inputs.originals[closurePath].sha256, observations: 52 }, modeQualification: "Existing canonical Observation/Snapshot helpers assert file kinds/content, not modes. Forty GNU-aligned rows additionally expose mode differences (native umask022 versus VFS stored modes). Raw full modes retained; 88/88 refers ONLY to existing tuple fields, not full mode parity. No mode waiver/source fix authorized." });
publish("proposal.json", { status: "PREPARATION ONLY; stop for root profile/scope confirmation before any existing-test edit", sourceCommit: inputs.sourceCommit, inventory, counts: { unchangedArchive: { tests: 235, pass: 208, fail: 27, skip: 0, cancel: 0, todo: 0 }, historicalRouting: inputs.routingCount, rawNativeFresh: 352, reusedNativeObservations: 156, productActorRows: 88, proposedCanonical: { discovery: 60, differential: 78, currentGaps: 11, closure: 34, total: 183 }, separatedHistoricalDiscovery: { total: 52, currentStrictFailures: 16 }, note: "52 historical discovery profile comparisons move out of the canonical current-profile denominator, not silently become passes. All 52 logical discovery inputs remain in primary; original strict capture and executable historical profile remain. This denominator change requires root confirmation." }, plannedFiles: [
  { path: "tests/shell/invocation-discovery-fixes.test.ts", change: "Select full named GNU-5.3 profile after hash/name/cohort integrity checks; retain all8 host/safety controls. Separate full historical52 into new owned explicit historical runner preserving strict comparisons and losses; no fixture/native-file edit." },
  { path: "tests/shell-stress/differential.test.ts", change: "Use new owned frozen-primary observation/identity helper in place of ambient /bin/bash reference imports; retain runVirtualScript/sourceEvidence and every equality/syntax/effect assertion.72 differential+5 syntax+1 provenance groups unchanged." },
  { path: "tests/shell-stress/current-gaps/compatibility.test.ts", change: "Use the same frozen-primary helper for all11 original inputs; keep exact complete equality, not status-only or stderr normalization." },
  { path: "tests/shell-stress/invocation-closure/holdout.test.ts", change: "Name only two explicit cases safeplugin and compare their full policy tuples, leaving all other primary/host rows and exact diagnostics/status guards intact. Keep original native evidence/cases/probe/support unchanged." },
  { path: "tests/shell-stress/canonical-profile-migration/**", change: "Add immutable exact native primary tuples, input hashes, explicit profile loader and historical strict runner; canonical tests need no binary install/network/ambient Bash. Native recapture remains explicit, pin-verified and separate." },
], requiredRootDecisions: ["Confirm27 total=25 historical+2 registry labels, not29.", "Confirm current-profile canonical denominator183 plus separate historical discovery52 (16 losses), without counting historical artifact checks as parity passes.", "Confirm explicit uniform shell invocation-name protocol and primary GNU5.3 frozen native tuples for all88 inputs; preserve raw shell-stress captures.", "Acknowledge40 supplementary mode mismatches, outside existing tuple assertions; no FS/source/mode policy acceptance implied.", "Independent canonical-profile-review owner freezes controls separately; its fixtures were not inspected." ], docs: [
  { url: "https://www.gnu.org/s/bash/manual/html_node/Invoking-Bash.html", basis: "The first argument after the -c command string supplies $0; protocol name alignment is explicit, not a diagnostic rewrite." },
  { url: "https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html", basis: "command -V describes resolution; type -t native categories include builtin/file/function. The custom registry command category is separately declared safeplugin behavior, not native Bash parity." },
], limits: ["No assertions, original helpers, fixtures, reports, native artifacts, source or manifests edited.", "Unchanged canonical archive tests and explicit all-input actor only; no global/fullgate/kernel/first-read/custom5 lifecycle reruns.", "Trace covers actual public src/index for the all-input actor; legacy child scrub limits remain explicit.", "Existing old results and current frozen6e results stay separate; no acceptance/fullBash/parity claim."] });
console.log(JSON.stringify({ inventory: inventory.length, comparisons: comparisons.map(({ profile, invocationName, total, exactExistingTuple, exactIncludingModes }) => ({ profile, invocationName, total, exactExistingTuple, exactIncludingModes })), unchangedTests: execution.runs.map(({ path, counts }) => ({ path, counts })) }, null, 2));
