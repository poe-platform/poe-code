import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, owner, digest, git, read, json, putJson, inventory } from "./common.mjs";

const freezeCommit = "eaca395fd0f90051676798971750515d04b0c005";
const inputs = json(join(directory, "INPUTS.json"));
const freezeManifest = json(join(directory, "FREEZE.json"));
const raw = read(join(directory, "EXECUTION.raw.txt"));
assert.match(raw.toString(), /spawnSync \/usr\/bin\/git ENOBUFS/u);
assert.match(raw.toString(), /component-execution-v1\/LAYOUTS\.json/u);
assert.equal(existsSync(join(directory, "work/run-001")), false);
const indexBefore = await streamedGitDigest(null, null);
async function streamedGitDigest(ref, path) {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["--no-replace-objects", ...(ref === null ? ["ls-files", "--stage", "-z"] : ["show", `${ref}:${path}`])], { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => { bytes += chunk.length; hash.update(chunk); });
    let errorText = ""; child.stderr.on("data", chunk => { errorText += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (status, signal) => status === 0 && signal === null ? resolve() : reject(new Error(`read-only Git stream failed ${status}/${signal}: ${errorText}`)));
  });
  return { bytes, sha256: hash.digest("hex") };
}
const frozen = [];
for (const entry of [...freezeManifest.entries, { path: "FREEZE.json", sha256: digest(read(join(directory, "FREEZE.json"))) }]) {
  const path = `${owner}/component-execution-v1/${entry.path}`;
  const committed = await streamedGitDigest(freezeCommit, path);
  assert.equal(committed.sha256, entry.sha256, path);
  assert.equal(digest(read(join(repository, path))), committed.sha256, path);
  frozen.push({ path, ...committed, status: "unchanged", productPass: false });
}
const original = [];
for (const entry of inputs.original) {
  const committed = await streamedGitDigest(entry.commit, entry.path);
  assert.equal(committed.sha256, entry.sha256); assert.equal(digest(read(join(repository, entry.path))), entry.sha256);
  original.push({ path: entry.path, sha256: entry.sha256, status: "unchanged", productPass: false });
}
assert.deepEqual(inventory(join(repository, owner, "component-admission-v1")), inputs.admissionFiles);
for (const runtime of inputs.runtimes) assert.equal(digest(read(runtime.executable)), runtime.sha256);
for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
assert.deepEqual(await streamedGitDigest(null, null), indexBefore);
const postcheck = { schema: "expr-independent-abort-readonly-postcheck-v1", capturedAt: new Date().toISOString(), freezeCommit,
  scope: "Post-failure read-only streaming Git integrity inspection, NOT a replacement runner, admission pass, candidate execution or retry", frozen, original,
  admission: { files: inputs.admissionFiles.length, status: "unchanged", productPass: false }, toolClosures: { status: "unchanged", newEntriesChecked: true, productPass: false },
  noRunDirectory: true, indexUnchangedDuringPostcheck: true, productPasses: 0 };
putJson(join(directory, "POSTCHECK.json"), postcheck);
const contexts = ["installed-node22", "installed-node24", "moved-node22", "moved-node24"].map(label => ({ label,
  cases: Array.from({ length: 26 }, (_, index) => ({ id: `R${String(index + 1).padStart(2, "0")}`, executed: false, status: "unrun", reason: "frozen recipe authentication aborted before candidate preparation" })),
  runtimeVariantCount: 28, controlsExecuted: 0, typeInvocations: 0, installed: false, moved: false, workerCreations: 0 }));
const report = { schema: "expr-independent-component-aborted-v1", authorizationDate: "2026-08-28", finishedAt: new Date().toISOString(), freezeCommit,
  candidate: inputs.candidate, candidateTree: inputs.tree, inputsSha256: digest(read(join(directory, "INPUTS.json"))),
  freezeManifestSha256: digest(read(join(directory, "FREEZE.json"))), layoutsSha256: digest(read(join(directory, "LAYOUTS.json"))),
  disposition: "HARNESS PREFLIGHT ABORT; NO CANDIDATE EXECUTION; NO RETRY OR FROZEN RECIPE CHANGE",
  P01: { status: "unexecuted", buildExecuted: false, packExecuted: false, completeSelectedInputsAuthenticatedInPreparation: 357,
    requiredWholepackSha256: inputs.package.tarballSha256, reproducedWholepack: false, authorpackRuntimeProof: false,
    authorpackReadOnlyLayoutPlanning: true, failureIsNotAProductBuildFailure: true },
  firstFailure: { phase: "frozen-recipe-authentication", code: "ENOBUFS", command: "/usr/bin/git --no-replace-objects show eaca395fd0f90051676798971750515d04b0c005:tests/integration/expr-public-independent-20260827/component-execution-v1/LAYOUTS.json",
    configuredGitMaxBuffer: 4194304, actualLayoutsBytes: read(join(directory, "LAYOUTS.json")).length,
    gitSignalInThrownReceipt: "SIGTERM", nodeExitStatus: 1, rawPath: "EXECUTION.raw.txt", rawSha256: digest(raw),
    explanation: "The exact absolute load manifest exceeds the frozen common.mjs Git reader's 4 MiB buffer. run.mjs aborts before work/run-001 creation and before its try/finally report writer." },
  evidenceWriterFirstFailure: { code: "ENOBUFS", command: "git ls-files --stage -z", candidateExecuted: false, sourcePreserved: "finalize-abort.mjs", verbatimToolOutputTranscription: "POSTCHECK-ATTEMPT-1.raw.txt", correction: "Separate read-only finalize-abort-v2.mjs streams index hashes; frozen runner is unchanged and not retried" },
  preparationFailure: { phase: "shell-wrapper-after-successful-preparation", error: "zsh:33: read-only variable: status", productExecuted: false, evidence: "PREPARATION-NOTES.md" },
  contexts, counts: { plannedRuntimeContexts: 4, plannedRuntimeIdsPerContext: 26, plannedRuntimeAssertions: 104,
    executed: 0, pass: 0, fail: 0, unrun: 104, controlsExecuted: 0, typeInvocations: 0, workerCreations: 0,
    candidateBuildInvocations: 0, packInvocations: 0, runtimeNaturalSettlements: 0, supervisedRuntimeKills: 0 },
  packageProtocols: Array.from({ length: 8 }, (_, index) => ({ id: `P0${index + 1}`, status: "unrun" })),
  R25: "UNRUN: no EXEC-only boundary or silent-ready qualification evidence",
  R26: "UNRUN: no direct/Shell cancellation, sibling, reason identity or cleanup evidence",
  readOnlyPostcheck: { originalNineUnchanged: true, admissionFiveUnchanged: true, freeze21Unchanged: true, toolsUnchangedWithNewEntryChecks: true, productPasses: 0 },
  sourceScope: inputs.sourceScope,
  holds: ["accepted-DU75 prerequisite HELD/unrescored; selected base is not accepted", "HTML admission and HTML34 HELD", "whole76/global acceptance HELD", "original acceptance-gated consumer HELD", "P01 independently reproduced wholepack NOT established"],
  nextAuthorizationNeeded: "Authorize a separately versioned/refrozen bounded streaming Git authentication recipe before any further attempt. Preserve this first failure; do not modify/retry v1 or count the postcheck as executable admission." };
putJson(join(directory, "REPORT.json"), report);
const evidenceNames = ["EXECUTION.raw.txt", "POSTCHECK.json", "REPORT.json", "REPORT.md", "finalize-abort.mjs", "finalize-abort-v2.mjs", "POSTCHECK-ATTEMPT-1.raw.txt"];
const evidence = evidenceNames.map(path => ({ path, bytes: read(join(directory, path)).length, sha256: digest(read(join(directory, path))) }));
putJson(join(directory, "MANIFEST.json"), { schema: "expr-independent-abort-evidence-v1", freezeCommit, freezeManifestSha256: report.freezeManifestSha256, inputsSha256: report.inputsSha256,
  layoutsSha256: report.layoutsSha256, evidence, counts: report.counts, P01: report.P01, holds: report.holds,
  selfReference: "Manifest hash is supplied separately; explicit-path evidence commit authenticates this file." });
console.log(JSON.stringify({ checkpoint: "abort-evidence-finalized", freezeCommit, actualLayoutsBytes: report.firstFailure.actualLayoutsBytes,
  counts: report.counts, postcheckSha256: digest(read(join(directory, "POSTCHECK.json"))), manifestSha256: digest(read(join(directory, "MANIFEST.json"))), reportSha256: digest(read(join(directory, "REPORT.json"))) }));

