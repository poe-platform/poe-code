import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owner = "tests/plugins/du-public-author";
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(join(root, owner, "evidence-v1/MANIFEST.json")));
const compressed = Buffer.from(readFileSync(join(root, owner, "evidence-v1/RAW.json.gz.base64"), "utf8"), "base64");
assert.equal(digest(compressed), manifest.compressedSha256);
const payload = gunzipSync(compressed); assert.equal(digest(payload), manifest.payloadSha256);
const captured = new Map(JSON.parse(payload).entries.map(entry => [entry.name, Buffer.from(entry.base64, "base64")]));
const final = JSON.parse(captured.get("final/REPORT.json"));
const original = JSON.parse(captured.get("original-packed-attempt/REPORT.json"));
assert.equal(final.status, "pass"); assert.equal(original.status, "fail");
const candidate = final.candidate;
const html = "aff899aa94ed0c57a936b08fd36d185688f5c0bb";
const freeze = "1bd1048b0075adf9ee1ebf041e299122f72c3459";
const freezePath = "tests/integration/du-public-independent-20260827/MANIFEST.json";
const freezeBytes = git("show", `${freeze}:${freezePath}`);
assert.deepEqual(readFileSync(join(root, freezePath)), freezeBytes, "independent freeze remains unchanged");
function identity(path) { return { path, sha256: digest(readFileSync(join(root, path))) }; }
function literalNames(commit, path) {
  const source = git("show", `${commit}:${path}`).toString();
  const literal = /const expected = (\[[\s\S]*?\])\.sort\(\);/u.exec(source)?.[1];
  assert.ok(literal, path); return JSON.parse(literal.replace(/,\s*\]$/u, "]"));
}
const names = literalNames(candidate, `${owner}/consumer.ts.fixture`);
const htmlNames = literalNames(html, "tests/plugins/html-to-markdown-public-author/consumer.ts.fixture");
assert.equal(names.length, 75); assert.equal(new Set(names).size, 75); assert.equal(htmlNames.length, 74);
assert.deepEqual([...htmlNames, "du"].sort(), [...names].sort());
const policy = identity(`${owner}/POLICY.md`);
const lifecycleKeys = ["headZero", "firstReadCancel", "validationAndStderr", "admissionObservation", "accountedWrites", "execSettlement", "disposeOverlap", "isolationAndOpaqueBoundary"];
const publicObservations = [];
for (const command of final.commands.filter(row => row.name.startsWith("runtime-"))) {
  const record = JSON.parse(captured.get(`final/${command.log}`));
  const lines = record.stdout.trim().split("\n").map(line => JSON.parse(line));
  const loaded = lines.find(line => line.loadBindings);
  assert.ok(loaded); assert.ok(!loaded.loadBindings.some(([path]) => /\/shell\/cancellation\.js$/u.test(path)));
  publicObservations.push({ name: command.name, status: record.status, observations: lines.filter(line => !line.loadBindings), loadedModules: loaded.loadBindings.length, runtime: loaded.version, execPath: loaded.execPath });
}
const tools = final.runtimes.map(runtime => ({ path: runtime.executable, sha256: runtime.sha256, version: runtime.identity.version }));
for (const tool of tools) assert.equal(digest(readFileSync(tool.path)), tool.sha256);
const receipt = {
  schemaVersion: 1,
  state: "author-completed-candidate; different-agent replay and root mapping acceptance pending",
  scope: "DU75 public/default wiring and explicit owned-output adoption; no whole gate",
  candidateCommit: candidate, candidateTree: final.tree,
  sourceCommit: "b2b4604f09f351d8130c0f2a3349e85f4b4c45e1",
  fixtureMigrationCommit: "9cccda89e185b80f31d011797b97a27c47a691ff",
  sourceInventory: final.inputBindings.map(({ blob, ...entry }) => ({ ...entry, gitBlob: blob })),
  buildInputsSha256: final.buildInputsSha256,
  scopedArchiveSha256: final.archiveSha256,
  package: { metadataSha256: final.package.metadataSha256, tarballSha256: final.package.tarballSha256, authorArtifactPath: final.package.tarball },
  packageFiles: Object.fromEntries(final.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])),
  emittedFiles: Object.fromEntries(final.emitted.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])),
  freezeCommit: freeze, freezeManifest: { path: freezePath, sha256: digest(freezeBytes) },
  html74Checkpoint: { commit: html, names: htmlNames, evidence: identity("tests/plugins/html-to-markdown-public-author/evidence-v1/MANIFEST.json"), tarballSha256: "d9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7" },
  declared75Inventory: { names, evidence: { path: `${owner}/consumer.ts.fixture`, sha256: digest(git("show", `${candidate}:${owner}/consumer.ts.fixture`)) } },
  sourcePathsAndPolicy: policy,
  aggregateDuOptions: { ...policy, propertyPath: "AgentCommandsOptions.du", type: 'Omit<DuCommandsOptions, "replace">', topLevelReplaceAuthoritative: true },
  diagnostics: { ...policy, unknownAllocation: { exitCode: 1, stdout: "", stderr: 'du: "/payload": allocated bytes unknown; total suppressed\n' }, invalidOption: { exitCode: 1, stdout: "", stderr: "du: unrecognized option '--not-a-du-option'\n" }, entryLimit: { exitCode: 1, stdout: "", stderr: "du: du entry limit exceeded\n" }, oneByteOutputLimit: { exitCode: 1, stdout: "", stderr: "" } },
  outputOperationIntegration: { ...policy, ...Object.fromEntries(lifecycleKeys.map(key => [key, { ...policy, section: key }])) },
  authorSupervisor: { path: `${owner}/verify-public.mjs`, sha256: digest(git("show", `${candidate}:${owner}/verify-public.mjs`)), commit: candidate },
  tools, tooling: final.tooling,
  admissionPolicy: { ...policy, mode: "scoped-committed-archive", postRunDetectsNewEntries: true, scopedInputCount: final.inputBindings.length, independentSupervisorNotSuppliedByAuthor: true },
  rootReplayAuthorization: null,
  independentRunnerStatus: "Frozen29-case inventory is unchanged; this author has not run or approved its17 blocked specifications.",
  sourceCounts: final.sourceCounts, authorCommands: final.commands, authorChecks: final.checks,
  publicObservations,
  originalAttempt: { candidate: original.candidate, sourceCounts: original.sourceCounts, failures: original.failures, tarballSha256: original.package.tarballSha256 },
  packageDeltaQualification: { addedPrivateSource: "src/shell/cancellation.ts", authorCommit: "67472272", emittedFiles: ["dist/shell/cancellation.js", "dist/shell/cancellation.js.map", "dist/shell/cancellation.d.ts", "dist/shell/cancellation.d.ts.map"], semanticAcceptance: false, observedMainThreadLoaded: false },
  captureTool: { ...identity("tests/plugins/html-to-markdown-public-author/capture.mjs"), note: "read-only generic capture helper; exclusive writes only to this new DU evidence directory" },
};
const output = join(root, owner, "evidence-v1/REVIEW-HANDOFF.json");
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path: output, sha256: digest(readFileSync(output)), candidate, sourceInputs: final.inputBindings.length, names: names.length, toolCount: tools.length, status: receipt.state }));
