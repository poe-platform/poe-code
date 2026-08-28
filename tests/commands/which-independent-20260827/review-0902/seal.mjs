import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const patch = (filename, text) => {
  assert.equal(fs.existsSync(filename), false, "Immutable output already exists");
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${filename}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
};
const readCapture = name => JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(own, name), "utf8"), "base64")));
const initial = readCapture("initial-01.json.gz.base64");
const diagnostic = readCapture("diagnostic-02.json.gz.base64");
let originalRunner = fs.readFileSync(path.join(own, "run.mjs"), "utf8");
const reverseDelta = [
  ['path.join(root, "fixtures", overrides.entry ?? "cohort-v1.mjs")', 'path.join(root, "fixtures/cohort-v1.mjs")'],
  ['  fs.copyFileSync(path.join(own, "controls.mjs"), path.join(snapshot, "fixtures/controls.mjs"));\n', ''],
  ['  runtime("postfreeze-source-controls", snapshot, "source", undefined, { entry: "controls.mjs" });\n', ''],
  ['  runtime("postfreeze-moved-controls", moved, "moved", undefined, { entry: "controls.mjs" });\n', '']
];
for (const [before, after] of reverseDelta) {
  assert.equal(originalRunner.split(before).length, 2);
  originalRunner = originalRunner.replace(before, after);
}
assert.equal(hash(originalRunner), initial.evidenceInputs["run.mjs"]);
const historicalFiles = Object.fromEntries(Object.keys(initial.evidenceInputs).map(filename => {
  const bytes = filename === "run.mjs" ? Buffer.from(originalRunner) : fs.readFileSync(path.join(own, filename));
  assert.equal(hash(bytes), initial.evidenceInputs[filename]);
  return [filename, bytes.toString("base64")];
}));
patch(path.join(own, "initial-harness.json.gz.base64"), gzipSync(JSON.stringify({ classification: "Exact initial harness reconstructed from recorded four-edit delta and verified against original hashes", files: historicalFiles, reverseDelta }), { level: 9 }).toString("base64"));
for (const [filename, digest] of Object.entries(diagnostic.evidenceInputs)) assert.equal(hash(fs.readFileSync(path.join(own, filename))), digest, filename);
const parser = "src/shell/parser.ts";
assert.equal(hash(git("show", `${diagnostic.revision}:${parser}`)), hash(git("show", `${diagnostic.freeze}:${parser}`)));
const processText = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
const activeOwnedProcesses = processText.split("\n").filter(line => [initial.scratch, diagnostic.scratch].some(root => line.includes(root)));
assert.deepEqual(activeOwnedProcesses, []);
const evidenceFiles = ["initial-01.json.gz.base64", "diagnostic-02.json.gz.base64", "initial-harness.json.gz.base64"];
const runnerFiles = ["run.mjs", "guard.mjs", "negative-plan.json", "controls.mjs", "seal.mjs", "verify.mjs", "REPORT.md"];
const seal = {
  classification: "Independent WHICH module review; unchanged original freeze remains 25/26 runtime groups per layout",
  sealedAt: new Date().toISOString(), candidate: diagnostic.revision, authorEvidence: "0a8a77b674e22cdac69778e0d4acddf626a297c9", fixtureFreeze: diagnostic.freeze,
  sourceHashes: Object.fromEntries(["src/commands/which/index.ts", "src/commands/which/options.ts", "src/commands/which/which.ts", parser].map(filename => [filename, diagnostic.sourceHashes[filename]])),
  evidenceHashes: Object.fromEntries(evidenceFiles.map(filename => [filename, hash(fs.readFileSync(path.join(own, filename)))])),
  harnessHashes: Object.fromEntries(runnerFiles.map(filename => [filename, hash(fs.readFileSync(path.join(own, filename)))])),
  results: { originalSource: { passed: 25, failed: 1, skipped: 0, failure: "B18" }, originalMoved: { passed: 25, failed: 1, skipped: 0, failure: "B18" },
    distinctFrozenFamilies: 28, sourceTypeFamiliesPassed: 4, movedTypeFamiliesPassed: 4, typeRuntimeOverlap: ["T02", "T03"],
    supplementarySource: { passed: 6, failed: 0 }, supplementaryMoved: { passed: 6, failed: 0 },
    runtimeMutantsRejected: { assertionFailures: 7, forbiddenOperationTrap: 1 }, typeMutationRejected: "TM01 TS2578 only", loaderViolationsRejected: 3,
    scopedBuildStatus: 0, authenticatedProductModulesPerFrozenLayout: 170, emittedEntries: Object.keys(diagnostic.emittedHashes).length,
    nativeRuns: 0, whichProductDefectsFound: 0, originalFreezeFullyPassing: false },
  B18: { originalScript: "function-only() { true; }; which true registered-only function-only tool", actualExitCode: 2, actualStdout: "", actualStderr: "shell: Invalid function name at offset 13\n", whichDispatches: 0,
    frozenExpected: { exitCode: 1, stdout: "/a/tool\n", stderr: "" }, parserUnchangedSinceFreeze: true,
    separateValidIdentifierControl: { exitCode: 1, stdout: "/a/tool\n", stderr: "", whichDispatches: 1 }, amendmentApplied: false },
  cleanup: { removedRoots: [initial.scratch, diagnostic.scratch], allAbsent: [initial.scratch, diagnostic.scratch].every(root => !fs.existsSync(root)), activeOwnedProcesses },
  recommendation: "Approve scoped module semantics if root accepts qualification; do not rescore original B18. A separate two-token function_only fixture amendment requires root approval.",
  limitations: ["no FreeBSD or Darwin which binary qualification", "no public/root/default wiring", "no full project gate", "no deployed remote-provider proof", "no host execution or atomic identity/access lease", "no opaque cancellation preemption or RSS guarantee"]
};
patch(path.join(own, "REVIEW.json"), JSON.stringify(seal, null, 2));
console.log(JSON.stringify({ reviewSha256: hash(fs.readFileSync(path.join(own, "REVIEW.json"))), candidate: seal.candidate, results: seal.results, cleanup: seal.cleanup }, null, 2));
