import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), root);
const directory = "tests/commands/yq-independent-20260828/normative";
const readJson = (path) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root });
const isAncestor = (ancestor, descendant) => {
  try {
    git("merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
};
const identity = readJson(`${directory}/selected-inputs.json`);
const packet = readJson(`${directory}/cases.json`);
const fullSha = /^[0-9a-f]{40}$/u;
const expectedPaths = [
  "src/commands/yq/DESIGN.md",
  "tests/commands/yq-design-20260828/initial-profile-v1/README.md",
  "tests/commands/yq-design-20260828/initial-profile-v1/decisions.json",
  "tests/commands/yq-design-20260828/final-contract-v1/README.md",
  "tests/commands/yq-design-20260828/final-contract-v1/contract.json",
  "tests/commands/yq-design-20260828/final-adoption-v1/README.md",
  "tests/commands/yq-design-20260828/final-adoption-v1/adoption.json",
  "src/commands/structured/numbers.ts",
];

assert.equal(identity.schemaVersion, 1);
assert.equal(identity.files.length, 8);
assert.deepEqual(identity.files.map((entry) => entry.path), expectedPaths);
assert.match(identity.inspectedHead, fullSha);
const currentHead = git("rev-parse", "HEAD").toString().trim();
const sourceBytes = new Map();
const currentDifferences = [];
for (const entry of identity.files) {
  assert.match(entry.commit, fullSha);
  assert.match(entry.gitBlob, fullSha);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
  const reference = `${entry.commit}:${entry.path}`;
  const bytes = git("show", reference);
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(digest(bytes), entry.sha256, entry.path);
  assert.equal(git("rev-parse", reference).toString().trim(), entry.gitBlob);
  assert.equal(entry.headIdenticalAtInspection, true);
  assert.equal(entry.worktreeIdenticalAtInspection, true);
  assert.ok(bytes.equals(git("show", `${identity.inspectedHead}:${entry.path}`)));
  const expectedAncestry = entry.commit === identity.fixedSource.commit ? identity.fixedSource.ancestorOfInspectedHead : true;
  assert.equal(isAncestor(entry.commit, identity.inspectedHead), expectedAncestry);
  const headIdentical = bytes.equals(git("show", `${currentHead}:${entry.path}`));
  const worktreeIdentical = bytes.equals(readFileSync(`${root}/${entry.path}`));
  if (!headIdentical || !worktreeIdentical) currentDifferences.push({ path: entry.path, headIdentical, worktreeIdentical });
  sourceBytes.set(entry.path, bytes);
}
const chain = [...identity.ancestry.historicalChain, identity.ancestry.finalContract, identity.ancestry.rootAdoption];
for (const [index, commit] of chain.entries()) {
  assert.match(commit, fullSha);
  git("merge-base", "--is-ancestor", commit, identity.inspectedHead);
  if (index > 0) git("merge-base", "--is-ancestor", chain[index - 1], commit);
}

const contractPath = "tests/commands/yq-design-20260828/final-contract-v1/contract.json";
const adoptionPath = "tests/commands/yq-design-20260828/final-adoption-v1/adoption.json";
const contract = JSON.parse(sourceBytes.get(contractPath).toString());
const adoption = JSON.parse(sourceBytes.get(adoptionPath).toString());
assert.equal(adoption.authority.finalContract.commit, identity.ancestry.finalContract);
assert.equal(adoption.authority.finalContract.contract.sha256, digest(sourceBytes.get(contractPath)));
assert.equal(adoption.authority.finalContract.readme.sha256, digest(sourceBytes.get(expectedPaths[3])));
assert.equal(contract.authority.initialProfileReadme.sha256, digest(sourceBytes.get(expectedPaths[1])));
assert.equal(contract.authority.initialProfileDecisions.sha256, digest(sourceBytes.get(expectedPaths[2])));
assert.equal(contract.numericAmendments.baselineBinding.gitBlob, identity.files[7].gitBlob);
assert.equal(contract.diagnostics.catalogue.length, 54);
const catalogue = new Map(contract.diagnostics.catalogue.map((entry) => [entry.code, entry]));
assert.equal(catalogue.size, 54);
assert.equal(adoption.diagnostics.catalogueEntries, 54);
assert.equal(adoption.diagnostics.reservedConflict.code, "ALIAS_DUPLICATE_ANCHOR");
assert.equal(adoption.diagnostics.reservedConflict.state, "RESERVED_UNREACHABLE_UNDER_ADOPTED_REUSE_PROFILE");
const fixedInformation = {
  help: { bytes: 501, sha256: "97238372eed5e2358540baadbb7e5eac1c81d14dde163a1b7fd05d9048521f65" },
  version: { bytes: 37, sha256: "68ebf73287a74c37f4f2c532cb8f3e53a697b07982fbf2293bebb5e0e5b2b5bb" },
};
for (const [field, expected] of Object.entries(fixedInformation)) {
  const text = contract.exactInformation[field];
  assert.equal(Buffer.byteLength(text), expected.bytes);
  assert.equal(digest(text), expected.sha256);
  assert.equal(adoption.exactInformation[field].utf8Bytes, expected.bytes);
  assert.equal(adoption.exactInformation[field].sha256, expected.sha256);
}
assert.equal(contract.exactInformation.version, "virtual-bash restricted YAML profile\n");
const informationForms = [
  ["--help"], ["-h"], ["--version"],
  ["eval", "--help"], ["eval", "-h"], ["eval", "--version"],
  ["e", "--help"], ["e", "-h"], ["e", "--version"],
];
assert.deepEqual(contract.cliAmendments.informationForms, informationForms);

const validKinds = new Set(["documents", "decimal", "failure", "information", "blocked"]);
const validTopics = new Set(["quoted", "block", "grammar", "tags-keys-core", "anchors", "streams", "numbers", "cli"]);
const allowedCaseFields = new Set(["id", "topic", "argv", "input", "inputHex", "yaml", "basis", "expected"]);
const expectedFields = {
  documents: new Set(["kind", "documents", "stdout"]),
  decimal: new Set(["kind", "decimalText", "doubleText", "exactMathematicalIntegral"]),
  failure: new Set(["kind", "status", "category", "code", "completedPrefixDocuments"]),
  information: new Set(["kind", "field", "status", "inputAcquisition"]),
  blocked: new Set(["kind", "finding", "choice"]),
};
const validateJsonValue = (value) => {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") return assert.ok(value.isWellFormed());
  if (typeof value === "number") return assert.ok(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
  assert.equal(typeof value, "object");
  for (const [key, child] of Object.entries(value)) {
    assert.ok(key.isWellFormed());
    validateJsonValue(child);
  }
};
assert.equal(packet.schemaVersion, 1);
assert.equal(packet.status, "synthetic-precode-data-only");
assert.deepEqual(packet.execution, { product: 0, nativeOracle: 0, yamlParser: 0 });
assert.equal(packet.cases.length, 80);
assert.deepEqual(packet.defaults.argv, ["-o", "json", "-c", "."]);
const identifiers = new Set();
const counts = { documents: 0, failure: 0, blocked: 0, decimal: 0, information: 0 };
const blocked = [];
const observedInformationForms = [];
for (const fixture of packet.cases) {
  for (const field of Object.keys(fixture)) assert.ok(allowedCaseFields.has(field), `${fixture.id}:${field}`);
  assert.match(fixture.id, /^[QBGTASNC][0-9]{2}$/u);
  assert.ok(!identifiers.has(fixture.id));
  identifiers.add(fixture.id);
  assert.ok(validTopics.has(fixture.topic));
  assert.equal(typeof fixture.yaml, "string");
  assert.ok(Array.isArray(fixture.basis) && fixture.basis.length > 0);
  for (const binding of fixture.basis) assert.ok(Object.hasOwn(packet.bindings, binding));
  assert.notEqual(Object.hasOwn(fixture, "input"), Object.hasOwn(fixture, "inputHex"));
  if (Object.hasOwn(fixture, "input")) {
    assert.equal(typeof fixture.input, "string");
    assert.ok(fixture.input.isWellFormed());
  } else {
    assert.match(fixture.inputHex, /^(?:[0-9a-f]{2})+$/u);
  }
  const argv = fixture.argv ?? packet.defaults.argv;
  assert.ok(Array.isArray(argv));
  for (const argument of argv) assert.ok(typeof argument === "string" && argument.isWellFormed());
  const expected = fixture.expected;
  assert.ok(validKinds.has(expected.kind));
  for (const field of Object.keys(expected)) assert.ok(expectedFields[expected.kind].has(field), `${fixture.id}:${field}`);
  counts[expected.kind]++;
  if (expected.kind === "documents") {
    assert.ok(Array.isArray(expected.documents));
    validateJsonValue(expected.documents);
    if (Object.hasOwn(expected, "stdout")) assert.equal(typeof expected.stdout, "string");
  } else if (expected.kind === "decimal") {
    assert.equal(typeof expected.decimalText, "string");
    assert.equal(typeof expected.doubleText, "string");
    assert.equal(typeof expected.exactMathematicalIntegral, "boolean");
  } else if (expected.kind === "failure") {
    assert.ok(catalogue.has(expected.code));
    assert.notEqual(expected.code, "ALIAS_DUPLICATE_ANCHOR");
    assert.equal(expected.category, catalogue.get(expected.code).category);
    assert.equal(expected.status, catalogue.get(expected.code).status);
    if (expected.completedPrefixDocuments) validateJsonValue(expected.completedPrefixDocuments);
  } else if (expected.kind === "information") {
    assert.ok(expected.field === "help" || expected.field === "version");
    assert.equal(expected.status, 0);
    assert.equal(expected.inputAcquisition, false);
    assert.equal(expected.field, argv.at(-1) === "--version" ? "version" : "help");
    observedInformationForms.push(argv);
  } else {
    assert.match(expected.finding, /^N[1-4]$/u);
    assert.ok(typeof expected.choice === "string" && expected.choice.length > 0);
    blocked.push([fixture.id, expected.finding]);
  }
}
assert.deepEqual(counts, { documents: 34, failure: 32, blocked: 4, decimal: 1, information: 9 });
assert.deepEqual(blocked, [["Q11", "N3"], ["G03", "N1"], ["T13", "N4"], ["N07", "N2"]]);
assert.deepEqual(observedInformationForms, informationForms);
console.log(JSON.stringify({
  status: "PREPARATION_ONLY_OK",
  selectedFiles: 8,
  caseRecords: 80,
  caseKinds: counts,
  finiteCatalogueEntries: 54,
  currentHead,
  selectedCurrentDifferences: currentDifferences,
  productRuns: 0,
  nativeOracleRuns: 0,
  yamlParserRuns: 0,
  writes: 0,
  caveat: "Schema and selected-byte checks only; no YAML semantics, runtime acceptance, full-tree integrity or append-proof claim.",
}, null, 2));
