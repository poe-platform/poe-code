import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = "/Users/kjopek/Workspace/safe-bash";
const directory = fileURLToPath(new URL(".", import.meta.url));
const ownedPath = "tests/commands/yq-independent-20260828/query-budget/";
const git = (...arguments_) => execFileSync("git", arguments_, { cwd: root, maxBuffer: 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
assert.equal(directory, `${root}/${ownedPath}`);
assert.equal(git("rev-parse", "--show-toplevel").toString().trim(), root);

const manifest = load("SOURCE_IDENTITY.json");
const packet = load("CASES.json");
assert.equal(manifest.schema, "yq-independent-query-budget-source-identity/1");
assert.equal(packet.schema, "yq-independent-query-budget-cases/1");
assert.equal(manifest.binding.baselineCommit, "5137a74ec855a32d8a8860eb66b62eb44d11e290");
assert.equal(manifest.binding.baselineTree, "48e5ae39ce98e1c8e416bae77da40d88b75e1db5");
assert.equal(git("rev-parse", `${manifest.binding.baselineCommit}^{tree}`).toString().trim(), manifest.binding.baselineTree);
assert.equal(manifest.entries.length, 32);
const selected = new Map();
const identityKeys = new Set();
let selectedBytes = 0;
for (const entry of manifest.entries) {
  assert.match(entry.revision, /^[0-9a-f]{40}$/u);
  assert.match(entry.gitBlob, /^[0-9a-f]{40}$/u);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(!entry.path.startsWith("/") && !entry.path.split("/").includes(".."));
  assert.ok(!entry.path.endsWith("AGENTS.md"));
  const key = `${entry.revision}:${entry.path}`;
  assert.ok(!identityKeys.has(key), key);
  identityKeys.add(key);
  const bytes = git("show", key);
  assert.equal(bytes.length, entry.bytes, key);
  assert.equal(digest(bytes), entry.sha256, key);
  assert.equal(git("rev-parse", key).toString().trim(), entry.gitBlob, key);
  selectedBytes += bytes.length;
  selected.set(key, bytes);
}
const readPinned = (revision, path) => {
  const bytes = selected.get(`${revision}:${path}`);
  assert.ok(bytes, path);
  return JSON.parse(bytes);
};
const finalRevision = "5783b8e03912f7774d2a86ba1dae9de778121273";
const finalPath = "tests/commands/yq-design-20260828/final-contract-v1/contract.json";
assert.equal(digest(selected.get(`${finalRevision}:${finalPath}`)), "1b2cf2740586d6847286d5a28788beb748d09e8b2181f02e6476d3b7634cefb8");
const contract = readPinned(finalRevision, finalPath);
const adoption = readPinned("cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707", "tests/commands/yq-design-20260828/final-adoption-v1/adoption.json");
assert.equal(contract.authority.fixedSourceBaseline, manifest.binding.baselineCommit);
assert.equal(adoption.implementationAuthorized, false);
const expectedCaps = {
  maxArgvEntries: 4096,
  maxArgvUtf8Bytes: 65536,
  maxVfsOperandPathBytes: 16384,
  maxInputBytes: 67108864,
  maxDocumentBytes: 8388608,
  maxValueBytes: 8388608,
  maxScalarBytes: 1048576,
  maxQuerySourceBytes: 8192,
  maxDepth: 128,
  maxAstDepth: 64,
  maxSteps: 1000000,
  maxResults: 100000,
  maxCollectionSize: 100000,
  maxDocuments: 1024,
  maxAnchorsPerDocument: 1024,
  maxAliasReferences: 1024,
  maxDocumentNodes: 100000,
  maxOutputBytes: 16777216,
  diagnosticReserveBytes: 4096,
  stdoutCapBytes: 16773120,
  maxDisplayedFilenameBytes: 256,
};
assert.deepEqual(contract.fixedPrivateCaps.values, expectedCaps);
assert.deepEqual(contract.defaultBudgetMapping, {
  maxInputBytes: 67108864, maxValueBytes: 8388608, maxOutputBytes: 16777216,
  maxSourceBytes: 8192, maxDepth: 128, maxAstDepth: 64, maxSteps: 1000000,
  maxResults: 100000, maxCollectionSize: 100000,
});
assert.equal(expectedCaps.maxOutputBytes - expectedCaps.diagnosticReserveBytes, expectedCaps.stdoutCapBytes);
const catalogue = new Map(contract.diagnostics.catalogue.map(entry => [entry.code, entry]));
assert.equal(contract.diagnostics.catalogue.length, 54);
assert.equal(catalogue.size, 54);
assert.deepEqual(catalogue.get("ALIAS_DUPLICATE_ANCHOR").status, 5);
assert.equal(adoption.diagnostics.reservedConflict.state, "RESERVED_UNREACHABLE_UNDER_ADOPTED_REUSE_PROFILE");
assert.equal(contract.exactInformation.version, "virtual-bash restricted YAML profile\n");
assert.equal(Buffer.byteLength(contract.exactInformation.version), 37);
assert.equal(digest(contract.exactInformation.version), "68ebf73287a74c37f4f2c532cb8f3e53a697b07982fbf2293bebb5e0e5b2b5bb");
assert.equal(Buffer.byteLength(contract.exactInformation.help), 501);
assert.equal(digest(contract.exactInformation.help), "97238372eed5e2358540baadbb7e5eac1c81d14dde163a1b7fd05d9048521f65");
assert.deepEqual(packet.execution, { product: 0, native: 0, dependencies: 0 });
const cases = new Map();
const layerCounts = {};
for (const entry of packet.cases) {
  assert.match(entry.id, /^[A-Z][0-9]{2}$/u);
  assert.ok(!cases.has(entry.id), entry.id);
  cases.set(entry.id, entry);
  assert.equal(typeof entry.basis, "string");
  assert.ok(entry.expect && typeof entry.expect === "object");
  assert.ok(entry.input !== undefined || entry.query !== undefined || entry.queryRecipe !== undefined || entry.argv !== undefined || entry.recipe !== undefined || entry.layer === "admission-state", entry.id);
  layerCounts[entry.layer] = (layerCounts[entry.layer] ?? 0) + 1;
  if (entry.expect.code) {
    assert.ok(catalogue.has(entry.expect.code), entry.id);
    assert.equal(entry.expect.status, catalogue.get(entry.expect.code).status, entry.id);
    assert.notEqual(entry.expect.code, "ALIAS_DUPLICATE_ANCHOR", entry.id);
  }
  if (entry.layer === "blocked-choice") {
    assert.equal(entry.expect.blocked, true);
    assert.equal(typeof entry.expect.choice, "string");
    assert.equal(entry.expect.status, undefined);
  }
  if (entry.layer === "admission-state") {
    for (const value of [entry.before, entry.incoming, entry.limit]) assert.ok(Number.isSafeInteger(value) && value >= 0);
    const admitted = entry.incoming <= entry.limit - entry.before;
    assert.equal(admitted, entry.expect.admitted, entry.id);
    if (admitted) assert.equal(entry.before + entry.incoming, entry.expect.after, entry.id);
  }
  if (entry.queryRecipe?.kind === "identity-padding") {
    const source = `.${" ".repeat(entry.queryRecipe.spaces)}`;
    assert.ok(source.length <= 8193);
    assert.equal(Buffer.byteLength(source), entry.queryRecipe.spaces + 1);
  }
}
assert.equal(cases.size, 62);
assert.equal(layerCounts["blocked-choice"], 2);
assert.equal(layerCounts.dependency, 1);
const checkpointCase = cases.get("B01");
const nullArray = Array.from({ length: checkpointCase.recipe.members }, () => null);
assert.equal(Buffer.byteLength(JSON.stringify(nullArray)), checkpointCase.expect.compactBytes);
assert.equal(nullArray.length + 1, checkpointCase.expect.visitedNodes);
const reservation = cases.get("B02").recipe;
assert.ok(reservation.reservedCopiedUnits <= reservation.remainingSteps);
assert.ok(reservation.reservedCopiedUnits + reservation.laterCheckpointSteps > reservation.remainingSteps);
assert.equal(cases.get("P01").candidate, manifest.binding.lengthCandidate);
console.log(JSON.stringify({
  result: "STATIC_PACKET_CHECKS_PASS_NOT_PRODUCT_ACCEPTANCE",
  caseCount: cases.size,
  layerCounts,
  selectedGitInputs: identityKeys.size,
  selectedBytes,
  privateCaps: Object.keys(expectedCaps).length,
  diagnosticEntries: catalogue.size,
  manifestSha256: digest(readFileSync(new URL("SOURCE_IDENTITY.json", import.meta.url))),
  casesSha256: digest(readFileSync(new URL("CASES.json", import.meta.url))),
  checks: ["selected immutable Git bytes/blobs/SHA256", "fixed caps and mapping", "54-code catalogue binding", "help/version bytes", "case schema/unique IDs/status-code consistency", "bounded synthetic admission/output arithmetic"],
  productExecutions: 0, nativeOracleExecutions: 0, dependencyChanges: 0,
  evidenceWrites: 0, lengthAcceptance: "pending Plato",
}, null, 2));
