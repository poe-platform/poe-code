import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const ownedRoot = fileURLToPath(new URL("../", import.meta.url));
const ownedPrefix = "tests/shell/directory-stack-independent-20260828/";
const authorPrefix = "tests/shell/directory-stack-design-20260828/final-v1/";
const originalCommit = "302351279c8ca6122c618e72768782c8ad118878";
const authorityCommit = "232c2f357a1049cbf096dbef3051445c8f7c476b";
const originalNames = ["README.md", "freeze-v1/BINDING.json", "freeze-v1/CONTRACT.md", "freeze-v1/SEAL.json", "freeze-v1/STATIC-ATTEMPTS.json", "freeze-v1/cases.json", "freeze-v1/controls.json", "freeze-v1/proofs.json", "freeze-v1/verify.mjs"].sort();
const appendixNames = ["BINDING.json", "HANDOFF.md", "SEAL.json", "STATIC-ATTEMPTS.json", "verify.mjs"].map((name) => "ratification-v1/" + name).sort();
const expectedFiles = [...originalNames, ...appendixNames].sort();
const expectedDirectories = ["freeze-v1", "ratification-v1"];
const argumentsList = process.argv.slice(2);
assert(argumentsList.length === 0 || (argumentsList.length === 2 && argumentsList[0] === "--commit" && /^[a-f0-9]{40}$/.test(argumentsList[1])), "only optional --commit FULL_BINDING_COMMIT is accepted");
const sealedCommit = argumentsList[1];
const git = (argumentsValue) => execFileSync("git", argumentsValue, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(resolve(ownedRoot, path), "utf8"));
const binding = readJson("ratification-v1/BINDING.json");
const seal = readJson("ratification-v1/SEAL.json");
const frozenBinding = readJson("freeze-v1/BINDING.json");
const frozenCases = readJson("freeze-v1/cases.json");
const frozenProofs = readJson("freeze-v1/proofs.json");
const knownTargets = new Set([...frozenCases.cases, ...frozenProofs.sourceInvariants, ...frozenProofs.positiveTypes, ...frozenProofs.negativeTypes].map((entry) => entry.id));
const counts = { declarativeRows: 138, sourceInvariants: 24, positiveTypes: 8, negativeTypes: 8, frozenStaticNegatives: 16, futureMutationFamilies: 16, futureImportNegativeFamilies: 6 };

function validate(document) {
  assert.equal(document.version, 1);
  assert.equal(document.kind, "additive-exact-ratification-static-only");
  assert.equal(document.authorityCommit, authorityCommit);
  assert.equal(document.originalFreezeCommit, originalCommit);
  assert.equal(document.packetCommit, "053505fcb5b63d8872991eb09655bc927dd7080d");
  assert.equal(document.semanticReview.result, "no-substantive-contradiction");
  assert.equal(document.semanticReview.role, "manual comparison; verifier authenticates references/mappings, not automated semantic equivalence");
  assert.deepEqual(document.resolvedGate, { durableAuthorRatification: authorityCommit, ratified: ["R1", "R2", "R3", "R4"], originalFilesModified: false });
  assert.deepEqual(document.runtimeGates, { acceptedLetBinding: null, exactAcceptedCdLetBase: null, exactStackCandidate: null, freshRootStackGo: false, stackRuntimeWindowReleased: false, authorIdleWindowRelease: "LET-first-only-not-stack-authorization", driverAndTypePreseals: "still-required", sourceInstalledMovedAuthentication: "still-required" });
  assert.deepEqual(document.unchangedCounts, counts);
  assert.deepEqual(document.history, { nativeOriginal: 34, virtualOriginal: 34, virtualMatches: 0, topologyNativeOnly: 4, grammarNativeOnly: 8, grammarVirtualRuns: 0 });
  assert.deepEqual(document.semanticReview.comparisons.map((entry) => entry.id), Array.from({ length: 12 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`));
  for (const comparison of document.semanticReview.comparisons) {
    assert(comparison.authority && comparison.finding && comparison.frozen.length > 0);
    for (const target of comparison.frozen) assert(knownTargets.has(target), `invalid comparison target ${target}`);
  }
  assert.deepEqual(document.originalFreeze.map((entry) => entry.path.slice(ownedPrefix.length)).sort(), originalNames);
  for (const reference of document.originalFreeze) assert.equal(reference.commit, originalCommit);
  assert.equal(document.ratificationArtifacts.length, 4);
  assert.equal(document.parentArtifacts.length, 10);
  assert.equal(document.pinnedSources.length, 5);
  assert.deepEqual(document.pinnedSources.map((entry) => entry.path).sort(), ["src/fs/webdav/README.md", "src/fs/webdav/webdav.ts", "src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/types.ts"]);
  for (const reference of [...document.ratificationArtifacts, ...document.parentArtifacts]) assert.equal(reference.commit, authorityCommit);
  for (const [key, value] of Object.entries({ originalFiles: 9, appendixFiles: 5, ratificationArtifacts: 4, parentHistoricalArtifacts: 10, pinnedSourceBlobs: 5, comparisonAreas: 12, newGuardNegatives: 8 })) assert.equal(document.staticScope[key], value, key);
}

function membership(files, directories) {
  assert.deepEqual([...files].sort(), expectedFiles, "full append-aware membership");
  assert.deepEqual([...directories].sort(), expectedDirectories, "including added/empty directories");
}

function assertHash(bytes, expected) {
  assert.equal(digest(bytes), expected, "SHA256 mismatch");
}

function authenticateLocal() {
  assert(lstatSync(ownedRoot).isDirectory());
  assert(!lstatSync(ownedRoot).isSymbolicLink());
  const files = [];
  const directories = [];
  function walk(prefix) {
    for (const name of readdirSync(resolve(ownedRoot, prefix))) {
      const path = prefix ? prefix + "/" + name : name;
      const info = lstatSync(resolve(ownedRoot, path));
      assert(!info.isSymbolicLink(), `unexpected symlink ${path}`);
      if (info.isDirectory()) {
        directories.push(path);
        assert(expectedDirectories.includes(path), `unlisted directory ${path}`);
        walk(path);
      } else {
        assert(info.isFile(), `nonregular member ${path}`);
        assert.equal(info.mode & 0o777, 0o644, `mode ${path}`);
        files.push(path);
      }
    }
  }
  walk("");
  membership(files, directories);
  assert.equal(seal.version, 1);
  assert.deepEqual(seal.files, appendixNames);
  assert.deepEqual(Object.keys(seal.sha256).sort(), appendixNames.filter((path) => path !== "ratification-v1/SEAL.json"));
  for (const path of appendixNames) {
    const bytes = readFileSync(resolve(ownedRoot, path));
    if (path !== "ratification-v1/SEAL.json") assertHash(bytes, seal.sha256[path]);
  }
  for (const reference of binding.originalFreeze) {
    const path = reference.path.slice(ownedPrefix.length);
    const bytes = readFileSync(resolve(ownedRoot, path));
    assertHash(bytes, reference.sha256);
    assert.deepEqual(bytes, git(["show", `${originalCommit}:${reference.path}`]), `original unchanged ${path}`);
  }
  if (sealedCommit) {
    const treeLines = git(["ls-tree", "-r", sealedCommit, "--", ownedPrefix]).toString("utf8").trim().split("\n");
    const paths = treeLines.map((entry) => {
      assert.match(entry, /^100644 blob /, "committed regular-file mode");
      return entry.slice(entry.indexOf("\t") + 1).slice(ownedPrefix.length);
    });
    membership(paths, expectedDirectories);
    for (const path of expectedFiles) assert.deepEqual(readFileSync(resolve(ownedRoot, path)), git(["show", `${sealedCommit}:${ownedPrefix}${path}`]), `committed bytes ${path}`);
  }
}

function authenticateReferences() {
  const references = [...binding.originalFreeze, ...binding.ratificationArtifacts, ...binding.parentArtifacts, ...binding.pinnedSources];
  assert.equal(references.length, 28);
  for (const reference of references) {
    const bytes = git(["show", `${reference.commit}:${reference.path}`]);
    assert.equal(bytes.length, reference.bytes);
    assertHash(bytes, reference.sha256);
    const tree = git(["ls-tree", reference.commit, "--", reference.path]).toString("utf8").trim();
    assert.equal(tree, `${reference.mode} blob ${reference.blob}\t${reference.path}`);
  }
  const originalTree = git(["ls-tree", "-r", "--name-only", originalCommit, "--", ownedPrefix]).toString("utf8").trim().split("\n").map((path) => path.slice(ownedPrefix.length));
  assert.deepEqual(originalTree.sort(), originalNames);
  const authorSeal = JSON.parse(git(["show", `${authorityCommit}:${authorPrefix}ratification-v1/SEAL.json`]).toString("utf8"));
  assert.deepEqual(authorSeal.ratified, ["R1", "R2", "R3", "R4"]);
  assert.equal(authorSeal.implementationAuthorized, false);
  assert.equal(authorSeal.runtimeWindow, "released for LET first");
  assert.equal(authorSeal.futureLetComposition, null);
  assert.equal(authorSeal.packetCommit, binding.packetCommit);
  for (const [name, sha256] of Object.entries(authorSeal.artifacts)) assert.equal(binding.ratificationArtifacts.find((entry) => entry.path === authorPrefix + "ratification-v1/" + name)?.sha256, sha256);
  for (const [name, sha256] of Object.entries(authorSeal.parentArtifacts)) assert.equal(binding.parentArtifacts.find((entry) => entry.path === posix.normalize(authorPrefix + name))?.sha256, sha256);
  assert.equal(Object.keys(authorSeal.parentArtifacts).length, 10);
  for (const source of binding.pinnedSources) {
    const original = frozenBinding.references.find((entry) => entry.path === source.path && entry.commit === source.commit);
    assert(original, `source absent from original frozen references ${source.path}`);
    assert.equal(source.blob, original.blob);
    assert.equal(source.sha256, original.sha256);
  }
  assert.equal(frozenBinding.gates.durableAuthorRatification, null, "historical gate remains unedited");
  assert.deepEqual({ declarativeRows: frozenBinding.counts.publicCases, sourceInvariants: frozenBinding.counts.sourceInvariants, positiveTypes: frozenBinding.counts.positiveTypes, negativeTypes: frozenBinding.counts.negativeTypes, frozenStaticNegatives: frozenBinding.counts.staticControls, futureMutationFamilies: frozenBinding.counts.productMutantFamilies, futureImportNegativeFamilies: frozenBinding.counts.futureImportNegativeFamilies }, counts);
  assert.equal(frozenCases.cases.length, counts.declarativeRows);
  assert.equal(frozenProofs.sourceInvariants.length, counts.sourceInvariants);
  assert.equal(frozenProofs.positiveTypes.length, counts.positiveTypes);
  assert.equal(frozenProofs.negativeTypes.length, counts.negativeTypes);
}

function negativeControls() {
  const rejected = [];
  const rejects = (name, operation) => {
    assert.throws(operation, { name: "AssertionError" }, `negative did not reject ${name}`);
    rejected.push(name);
  };
  rejects("RN01", () => membership(expectedFiles.slice(1), expectedDirectories));
  rejects("RN02", () => membership([...expectedFiles, "ratification-v1/extra.txt"], expectedDirectories));
  const altered = Buffer.from(readFileSync(resolve(ownedRoot, "README.md")));
  altered[0] ^= 1;
  rejects("RN03", () => assertHash(altered, binding.originalFreeze.find((entry) => entry.path === ownedPrefix + "README.md").sha256));
  const mutations = [
    ["RN04", (value) => { value.authorityCommit = originalCommit; }],
    ["RN05", (value) => { value.runtimeGates.stackRuntimeWindowReleased = true; }],
    ["RN06", (value) => { value.unchangedCounts.declarativeRows = 139; }],
    ["RN07", (value) => { value.history.virtualMatches = 34; }],
    ["RN08", (value) => { value.semanticReview.comparisons[0].frozen = ["I99"]; }]
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(binding);
    mutate(changed);
    rejects(name, () => validate(changed));
  }
  assert.equal(rejected.length, 8);
  return rejected;
}

authenticateLocal();
validate(binding);
authenticateReferences();
const rejected = negativeControls();
authenticateLocal();
process.stdout.write(`${JSON.stringify({ status: "static-only-pass", at: new Date().toISOString(), originalFreezeCommit: originalCommit, authorityCommit, sealedCommit: sealedCommit ?? null, unchangedOriginalFiles: 9, appendixFiles: 5, ratificationArtifactsAuthenticated: 4, parentArtifactsIndependentlyRehashed: 10, pinnedSourceBlobsIndependentlyRehashed: 5, totalReferenceRecords: 28, comparisonAreas: 12, semanticReview: "manual comparison found no substantive contradiction; not automated equivalence", countsUnchanged: counts, newStaticNegativesRejected: rejected, fullMembershipCheckedBeforeAndAfter: true, addedFilesDirectoriesSymlinksRejected: true, implementationInspections: 0, productRuns: 0, nativeOracleRuns: 0, providerRequests: 0, typeCompiles: 0, cohortRuns: 0, stackRuntimeAuthorized: false }, null, 2)}\n`);
