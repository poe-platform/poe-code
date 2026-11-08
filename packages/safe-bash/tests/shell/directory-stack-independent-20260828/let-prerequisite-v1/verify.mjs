import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = fileURLToPath(new URL("../", import.meta.url));
const prefix = "tests/shell/directory-stack-independent-20260828/";
const addition = "let-prerequisite-v1/";
const prior = "6852585ccf36ca1a92f74bb4f78316860163a111";
const baseline = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const dav = "ca1d33424b94a21ae0f40a36412fd8191611e2df";
const acceptedCD = "4641075df5355a91c83bf5b2cc3a88dfaf1f5153";
const acceptedLET = "c26892c3a1a419311c9cf46a6c2976e696e00624";
const evidence = "08b0553148afdfdb95edd722a2cdd7f63935d470";
const packageHash = "21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace";
const runtimeHash = "eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193";
const composedHash = "3e3a2fe381e11540213285e14e2a9a55a72bdbdd";
const evidencePrefix = "tests/shell/let-independent-20260828/";
const names = ["BINDING.json", "HANDOFF.md", "SEAL.json", "STATIC-ATTEMPTS.json", "verify.mjs"].map(name => addition + name).sort();
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--commit" && /^[a-f0-9]{40}$/.test(args[1])));
const sealedCommit = args[1] ?? null;
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = name => JSON.parse(readFileSync(resolve(owned, name), "utf8"));
const committedJSON = path => JSON.parse(git(["show", `${evidence}:${evidencePrefix}${path}`]));
const binding = json(addition + "BINDING.json");
const seal = json(addition + "SEAL.json");
const readiness = json("executor-preparation-v1/READINESS.json");
const priorNames = git(["ls-tree", "-r", "--name-only", prior, "--", prefix]).toString().trim().split("\n").map(path => path.slice(prefix.length)).sort();
assert.equal(priorNames.length, 44);
const allNames = [...priorNames, ...names].sort();
const expectedDirectories = [...new Set(allNames.flatMap(name => { const result = []; let parent = dirname(name); while (parent !== ".") { result.push(parent); parent = dirname(parent); } return result; }))].sort();
const positives = [];
const negatives = [];
function check(id, operation) { operation(); positives.push(id); }
function snapshot() {
  const files = {};
  const directories = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const key = relative(owned, path);
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), `symlink refused: ${key}`);
      if (stat.isDirectory()) { directories[key] = stat.mode & 0o7777; visit(path); }
      else { assert(stat.isFile(), `nonregular refused: ${key}`); const bytes = readFileSync(path); files[key] = { mode: stat.mode & 0o7777, bytes: bytes.length, sha256: sha256(bytes) }; }
    }
  }
  visit(owned);
  return { files, directories };
}
function membership(tree) {
  assert.deepEqual(Object.keys(tree.files).sort(), allNames);
  assert.deepEqual(Object.keys(tree.directories).sort(), expectedDirectories);
  assert.deepEqual(tree.directories, seal.directoryModes);
  for (const entry of Object.values(tree.files)) assert.equal(entry.mode, 0o644);
}
function authenticate(reference) {
  assert.match(reference.commit, /^[a-f0-9]{40}$/);
  assert.equal(git(["ls-tree", reference.commit, "--", reference.path]).toString().trim(), `${reference.mode} blob ${reference.blob}\t${reference.path}`);
  const bytes = git(["show", `${reference.commit}:${reference.path}`]);
  assert.equal(bytes.length, reference.bytes); assert.equal(sha256(bytes), reference.sha256);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), reference.blob);
}
function validate(value) {
  assert.equal(value.previousPreparationCommit, prior);
  assert.equal(value.acceptedLet.commit, acceptedLET);
  assert.equal(value.acceptedLet.commitTree, "e6fca9203a2d6be96e389f94a277e422b8f9f395");
  assert.equal(value.acceptedLet.evidenceCommit, evidence);
  assert.equal(value.acceptedLet.runtime.blob, "9e70a9d556e46ecf23b977a048f089b1c0d25e5c");
  assert.equal(value.acceptedLet.runtime.sha256, runtimeHash);
  assert.equal(value.composition.baseline, baseline); assert.equal(value.composition.dav, dav);
  assert.equal(value.composition.acceptedCD, acceptedCD); assert.equal(value.composition.runtimeFrom, acceptedLET);
  assert.equal(value.composition.shellFrom, baseline); assert.equal(value.composition.composedTree, composedHash);
  assert.deepEqual(value.composition.replacements, ["src/fs/webdav/README.md", "src/fs/webdav/webdav.ts", "src/shell/runtime.ts"]);
  assert.equal(value.prerequisitePackage.sha256, packageHash);
  assert.equal(value.prerequisitePackage.role, "accepted-LET-prerequisite-only-not-future-stack-package");
  assert.equal(value.rootUpdate.acceptedLet, true); assert.equal(value.rootUpdate.authorStackImplementationGo, true);
  assert.equal(value.rootUpdate.authorStackWindowReleased, true); assert.equal(value.rootUpdate.author, "Poincare");
  assert.deepEqual(value.rootUpdate.permittedProductionDelta, ["src/shell/runtime.ts", "src/shell/shell.ts"]);
  assert.equal(value.rootUpdate.reviewerStackExecutionAuthorized, false);
  assert.equal(value.rootUpdate.exactStackCandidate, null); assert.equal(value.rootUpdate.exactStackEvidence, null);
  assert.deepEqual(value.originalCounts, { rows: 138, invariants: 24, positiveTypes: 8, negativeTypes: 8, mutationFamilies: 16, importNegativeFamilies: 6 });
  assert.equal(value.readiness.preparedAdaptersUnexecuted, 124); assert.equal(value.readiness.boundedAdapterGaps, 14);
  assert.deepEqual(value.readiness.gaps, readiness.cases.filter(entry => entry.status === "bounded-adapter-gap"));
  assert.deepEqual(value.readiness.sourceInvariantIds, readiness.invariants.map(entry => entry.id));
  assert.equal(value.readiness.sourceInvariantRole, "pinned-source-proof-pending-exact-candidate");
  assert.equal(value.readiness.dynamicPrivateMeasurements, false);
  for (const count of Object.values(value.zeroExecution)) assert.equal(count, 0);
}
function composedTree(tree, prefix, overrides, visited) {
  const chunks = git(["ls-tree", "-z", tree]).toString().split("\0").filter(Boolean).map(entry => {
    const parsed = /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t(.*)$/s.exec(entry); assert(parsed);
    const [, rawMode, type, original, name] = parsed;
    const path = prefix + name;
    let object = original;
    if (overrides.has(path)) { assert.equal(type, "blob"); object = overrides.get(path); visited.add(path); }
    else if (type === "tree" && [...overrides.keys()].some(candidate => candidate.startsWith(path + "/"))) object = composedTree(original, path + "/", overrides, visited);
    return Buffer.concat([Buffer.from(`${rawMode.replace(/^0+/, "")} ${name}\0`), Buffer.from(object, "hex")]);
  });
  const payload = Buffer.concat(chunks);
  return createHash("sha1").update(`tree ${payload.length}\0`).update(payload).digest("hex");
}
const before = snapshot();
check("P01", () => {
  membership(before); assert.deepEqual(seal.files, names);
  assert.deepEqual(Object.keys(seal.sha256).sort(), names.filter(name => name !== addition + "SEAL.json"));
  for (const [name, digest] of Object.entries(seal.sha256)) assert.equal(before.files[name].sha256, digest);
  assert.deepEqual(binding.immutablePriorFiles.map(entry => entry.path.slice(prefix.length)).sort(), priorNames);
  for (const entry of binding.immutablePriorFiles) { assert.equal(entry.commit, prior); authenticate(entry); assert.deepEqual(before.files[entry.path.slice(prefix.length)], { mode: Number.parseInt(entry.mode, 8) & 0o7777, bytes: entry.bytes, sha256: entry.sha256 }); }
  if (sealedCommit) {
    const entries = git(["ls-tree", "-r", sealedCommit, "--", prefix]).toString().trim().split("\n");
    assert.deepEqual(entries.map(entry => entry.slice(entry.indexOf("\t") + 1).slice(prefix.length)).sort(), allNames);
    for (const entry of entries) assert.match(entry, /^100644 blob /);
    for (const name of allNames) assert.deepEqual(readFileSync(resolve(owned, name)), git(["show", `${sealedCommit}:${prefix}${name}`]));
  }
});
check("P02", () => { validate(binding); assert.equal(git(["rev-parse", `${acceptedLET}^{tree}`]).toString().trim(), binding.acceptedLet.commitTree); assert.equal(git(["rev-parse", `${evidence}^{tree}`]).toString().trim(), binding.acceptedLet.evidenceTree); });
check("P03", () => {
  assert.deepEqual(binding.pinnedSources.map(entry => [entry.commit, entry.path]), [[acceptedLET, "src/shell/runtime.ts"], [baseline, "src/shell/shell.ts"], [dav, "src/fs/webdav/webdav.ts"], [dav, "src/fs/webdav/README.md"], [acceptedCD, "src/shell/runtime.ts"]]);
  for (const entry of binding.pinnedSources) authenticate(entry);
  assert.deepEqual(binding.acceptedLet.runtime, binding.pinnedSources[0]);
});
const verified = committedJSON("final-review/VERIFIED.json");
const report = committedJSON("actual-amendments-01/REPORT.json");
const manifest = committedJSON("final-review/EVIDENCE-MANIFEST.json");
check("P04", () => {
  assert.deepEqual(binding.evidenceFiles.map(entry => entry.path), ["final-review/HANDOFF.md", "final-review/VERIFIED.json", "final-review/EVIDENCE-MANIFEST.json", "actual-amendments-01/REPORT.json"].map(path => evidencePrefix + path));
  for (const entry of [...binding.evidenceFiles, binding.prerequisitePackage]) { assert.equal(entry.commit, evidence); authenticate(entry); const member = manifest.files[entry.path.slice(evidencePrefix.length)]; if (member) assert.deepEqual(member, { sha256: entry.sha256, bytes: entry.bytes, mode: Number.parseInt(entry.mode, 8) & 0o7777 }); }
  assert.equal(verified.candidate, acceptedLET); assert.equal(report.options.candidate, acceptedLET);
  assert.equal(verified.runtimeSha256, runtimeHash); assert.equal(report.runtimeCandidateSha256, runtimeHash);
});
check("P05", () => {
  const baseTree = git(["rev-parse", `${baseline}^{tree}`]).toString().trim(); assert.equal(baseTree, binding.composition.baselineTree);
  assert.equal(composedTree(baseTree, "", new Map(), new Set()), baseTree);
  const overrides = new Map(binding.pinnedSources.slice(0, 4).filter(entry => entry.commit !== baseline).map(entry => [entry.path, entry.blob]));
  const visited = new Set(); assert.equal(composedTree(baseTree, "", overrides, visited), composedHash);
  assert.deepEqual([...visited].sort(), binding.composition.replacements);
});
check("P06", () => {
  const expectedPaths = [...git(["ls-tree", "-r", "--name-only", baseline, "--", "src"]).toString().trim().split("\n"), "README.md", "package-lock.json", "package.json", "tsconfig.build.json", "tsconfig.json"].sort();
  assert.equal(expectedPaths.length, 265); assert.deepEqual(report.composition.map(entry => entry.path).sort(), expectedPaths);
  assert.deepEqual(Object.keys(report.sourceSelected).sort(), expectedPaths);
  for (const entry of report.composition) {
    const revision = entry.path === "src/shell/runtime.ts" ? acceptedCD : binding.composition.replacements.includes(entry.path) ? dav : baseline;
    assert.equal(entry.revision, revision);
    authenticate({ ...entry, commit: revision, mode: entry.mode.toString(8) });
    assert.equal(report.sourceSelected[entry.path], entry.path === "src/shell/runtime.ts" ? runtimeHash : entry.sha256);
  }
  assert.deepEqual(report.strippedExactlyAcceptedCD, { revision: acceptedCD, sha256: binding.pinnedSources[4].sha256 });
});
check("P07", () => {
  assert.equal(binding.prerequisitePackage.reportedMembers, 846); assert.equal(report.pack.sha256, packageHash);
  assert.equal(report.pack.entries, 846); assert.equal(report.pack.metadata.entryCount, 846);
  assert.equal(Object.keys(report.candidateEmitted).length, 846);
  assert.deepEqual(report.pack.metadata.files.map(entry => entry.path).sort(), Object.keys(report.candidateEmitted).sort());
  assert.equal(verified.fullPackMembers, 846); assert.equal(verified.selectedInputs, 265);
  for (const entry of verified.packageHashes) { assert.equal(entry.sha256, packageHash); assert.equal(entry.members, 846); }
});
check("P08", () => {
  for (const layout of ["source", "moved"]) {
    assert.deepEqual(verified.cohorts[layout].original, { count: 84, pass: 81, failed: ["P39", "P58", "S26"] });
    assert.deepEqual(verified.cohorts[layout].qualifiedSupportedProfile, { carriedUnchangedPasses: 81, versionedSupplementPasses: 3, total: 84, nounsetSupported: false });
  }
  assert.equal(verified.families, 22); assert.deepEqual(verified.regressions, { pass: 167, total: 167, skipped: 0 });
  assert.deepEqual(binding.historicalLetReferences.typeResults, verified.typeResults);
  assert.deepEqual(verified.originalMutants, { killed: 6, total: 7, survivor: "ineffective M3" });
  assert.equal(binding.historicalLetReferences.nounsetSupported, false);
});
check("P09", () => {
  assert.deepEqual(binding.originalCounts, readiness.originalCounts);
  assert.deepEqual(readiness.statusCounts, { prepared: 124, gaps: 14 });
  const template = json("executor-preparation-v1/AUTHORIZATION-TEMPLATE.json");
  assert.equal(template.kind, "NOT-AUTHORIZED-TEMPLATE"); assert.equal(template.rootStackGo, false); assert.equal(template.stackWindowReleased, false);
  assert.equal(json("executor-preparation-v1/BINDING.json").candidate, null);
  assert.equal(binding.rootUpdate.authorStackImplementationGo, true); assert.equal(binding.rootUpdate.reviewerStackExecutionAuthorized, false);
});
const mutations = [
  ["N01", value => { value.acceptedLet.commit = "HEAD"; }],
  ["N02", value => { value.composition.composedTree = "0".repeat(40); }],
  ["N03", value => { value.prerequisitePackage.role = "future-stack-package"; }],
  ["N04", value => { value.rootUpdate.authorStackImplementationGo = false; }],
  ["N05", value => { value.rootUpdate.reviewerStackExecutionAuthorized = true; }],
  ["N06", value => { value.readiness.gaps.pop(); }],
  ["N07", value => { value.readiness.dynamicPrivateMeasurements = true; }],
  ["N08", value => { value.originalCounts.rows = 139; }]
];
for (const [id, mutate] of mutations) { const value = structuredClone(binding); mutate(value); assert.throws(() => validate(value), { name: "AssertionError" }); negatives.push(id); }
const appended = structuredClone(before); appended.files["unexpected.txt"] = { mode: 0o644, bytes: 0, sha256: sha256(Buffer.alloc(0)) };
assert.throws(() => membership(appended), { name: "AssertionError" }); negatives.push("N09");
const changedMode = structuredClone(before); changedMode.files[priorNames[0]].mode = 0o755;
assert.throws(() => membership(changedMode), { name: "AssertionError" }); negatives.push("N10");
check("P10", () => { const after = snapshot(); membership(after); assert.deepEqual(after, before); });
process.stdout.write(JSON.stringify({ status: "static-only-pass", at: new Date().toISOString(), sealedCommit, immutablePriorFiles: 44, additiveFiles: 5, positiveGroups: positives, negativeControlsRejected: negatives, evidenceDocuments: 4, compressedPackageBlobs: 1, pinnedSourceReferences: 5, precursorReferencesAuthenticated: 265, selectedCompositionInputsAuthenticated: 265, reportedPackageMembers: 846, packageMemberRole: "committed-report-metadata-not-new-tar-parse", acceptedLET, letCommitTree: binding.acceptedLet.commitTree, composedTree: composedHash, packageSha256: packageHash, originalCounts: binding.originalCounts, preparedAdaptersUnexecuted: 124, boundedAdapterGaps: 14, sourceInvariantsPending: 24, rootAuthorStackGo: true, rootAuthorWindowReleased: true, reviewerStackExecutionAuthorized: false, exactStackCandidate: null, execution: binding.zeroExecution }, null, 2) + "\n");
