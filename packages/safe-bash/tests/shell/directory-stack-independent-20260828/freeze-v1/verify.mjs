import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const ownedRoot = fileURLToPath(new URL("../", import.meta.url));
const ownedPrefix = "tests/shell/directory-stack-independent-20260828/";
const freezePrefix = "freeze-v1/";
const argumentsList = process.argv.slice(2);
assert(argumentsList.length === 0 || (argumentsList.length === 2 && argumentsList[0] === "--commit" && /^[a-f0-9]{40}$/.test(argumentsList[1])), "only optional --commit FULL_COMMIT is accepted");
const sealedCommit = argumentsList[1];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (argumentsValue) => execFileSync("git", argumentsValue, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const readJson = (name) => JSON.parse(readFileSync(resolve(ownedRoot, freezePrefix, name), "utf8"));
const documents = { binding: readJson("BINDING.json"), cases: readJson("cases.json"), proofs: readJson("proofs.json"), controls: readJson("controls.json") };
const seal = readJson("SEAL.json");
const expectedCounts = { publicCases: 138, areas: { transition: 20, grammar: 42, display: 10, state: 14, middleware: 8, failure: 12, limits: 16, "cancellation-output": 12, discovery: 4 }, sourceInvariants: 24, positiveTypes: 8, negativeTypes: 8, staticControls: 16, productMutantFamilies: 16, futureImportNegativeFamilies: 6, references: 25 };
const inventory = ["README.md", "freeze-v1/BINDING.json", "freeze-v1/CONTRACT.md", "freeze-v1/SEAL.json", "freeze-v1/STATIC-ATTEMPTS.json", "freeze-v1/cases.json", "freeze-v1/controls.json", "freeze-v1/proofs.json", "freeze-v1/verify.mjs"].sort();
const identifiers = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
const assertIds = (items, expected) => {
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, "duplicate identifier");
  assert.deepEqual(items.map((item) => item.id).sort(), expected.sort(), "independent exact identifier inventory");
};

function validate(data) {
  const { binding, cases, proofs, controls } = data;
  for (const document of Object.values(data)) assert.equal(document.version, 1);
  assert.equal(binding.kind, "independent-precode-static-only");
  assert.equal(binding.authorFinal, "053505fcb5b63d8872991eb09655bc927dd7080d");
  assert.equal(binding.grammarPreseal, "23fca35fc5d7c749a7273015b802aef6376096a2");
  assert.equal(binding.acceptedCD.candidate, "4641075df5355a91c83bf5b2cc3a88dfaf1f5153");
  assert.equal(binding.acceptedCD.evidence, "2585f78dcd5cfd2ea454977462c57b23f7044a12");
  assert.equal(binding.acceptedCD.final, "192ab78b4202be5afc92ffc12a72816da98ddfe0");
  assert.equal(binding.acceptedCD.base, "5137a74ec855a32d8a8860eb66b62eb44d11e290");
  assert.equal(binding.acceptedCD.provider, "ca1d33424b94a21ae0f40a36412fd8191611e2df");
  assert.equal(binding.acceptedCD.composedTree, "b820fa91a3bcc904005c690d48038d9a3900cede");
  assert.equal(binding.acceptedCD.packageSha256, "06ea635b201a1296268adaa452a2419682f92ec93906cb9083e327dc69f85914");
  assert.deepEqual([binding.history.nativeOriginal, binding.history.virtualOriginal, binding.history.virtualMatches, binding.history.topologyNativeOnly, binding.history.grammarNativeOnly, binding.history.grammarVirtualRuns], [34, 34, 0, 4, 8, 0]);
  assert.deepEqual(binding.gates, { durableAuthorRatification: null, exactNewBase: null, exactCandidate: null, rootGo: false, runtimeWindowReleased: false, runnableDriverPreseal: null, typeFixturePreseal: null });
  assert.equal(binding.policy.freshExecTail, true);
  assert.equal(binding.policy.publicationStamp, "private fresh Symbol immediately after actual stack cwd assignment before checked PWD");
  assert.equal(binding.policy.separateWorkCounters, true);
  assert.equal(binding.policy.diagnosticScope, "owned-payload-not-whole-line");
  assert.deepEqual(binding.policy.productDelta, ["src/shell/runtime.ts", "src/shell/shell.ts"]);
  assert.deepEqual(binding.policy.limits, { tailEntries: 4096, rememberedBytes: 4194304, pathBytes: 65536, argumentBytes: 65536, usedHomeBytes: 65536, stackWork: 8388608, cdLookupWork: 8388608, displayBytes: 8388608, yieldSteps: 128, chunkBytes: 16384, diagnosticPayloadBytes: 65792, truncationPrefixBytes: 65780, truncationSuffixBytes: 12 });
  assert.deepEqual(binding.proofRoles, { publicCases: "future-runtime-obligations-not-executed", privateInvariants: "pinned-source-proof-not-runtime-measurement", types: "future-exact-declaration-fixture-and-compile-gated", staticControls: "in-memory-fixture-guard-controls-not-product-mutants" });
  assert.deepEqual(binding.counts, expectedCounts);
  assert.equal(binding.references.length, expectedCounts.references);
  assertIds(cases.cases, [...identifiers("B", 20), ...identifiers("G", 42), ...identifiers("D", 10), ...identifiers("S", 14), ...identifiers("M", 8), ...identifiers("F", 12), ...identifiers("L", 16), ...identifiers("C", 12), ...identifiers("A", 4)]);
  for (const [area, count] of Object.entries(expectedCounts.areas)) assert.equal(cases.cases.filter((row) => row.area === area).length, count, area);
  for (const row of cases.cases) {
    assert(row.argv || row.argvRecipe || row.script || row.schedule || row.recipe, `missing concrete input ${row.id}`);
    assert(row.expect && Object.keys(row.expect).length > 0, `missing expected result ${row.id}`);
    if (row.argv) assert(row.argv.every((value) => typeof value === "string"), `nonliteral argv ${row.id}`);
    if (row.expect.status !== undefined) assert([0, 1, 2, 141].includes(row.expect.status), `unexpected mapped status ${row.id}`);
  }
  const rowById = new Map(cases.cases.map((row) => [row.id, row]));
  assert.deepEqual(rowById.get("F02").expect.full, ["/c", "/a", "/c"]);
  assert.deepEqual(rowById.get("F08").expect.full, ["/search/leaf"]);
  assert.deepEqual(rowById.get("F09").expect.full, ["/search/leaf", "leaf", "/a"]);
  assert.equal(rowById.get("G09").expect.stdout, "/old\n/old /c\n");
  assert.equal(rowById.get("G14").expect.status, 1);
  assert.equal(rowById.get("G15").expect.status, 0);
  assert.equal(rowById.get("G23").expect.status, 2);
  assert.equal(rowById.get("G29").expect.status, 1);
  assert.equal(rowById.get("G30").expect.status, 2);
  assert.equal(rowById.get("L01").expect.diagnosticPayload, "pushd: directory stack exceeds 4096 entries");
  assert.equal(rowById.get("L15").expect.diagnosticPayload, "pushd: directory stack exceeds 4194304 UTF-8 bytes");
  assertIds(proofs.sourceInvariants, identifiers("I", 24));
  assertIds(proofs.positiveTypes, identifiers("TP", 8));
  assertIds(proofs.negativeTypes, identifiers("TN", 8));
  assertIds(controls.staticControls, identifiers("N", 16));
  assertIds(controls.productMutants, identifiers("U", 16));
  assertIds(controls.futureImportNegatives, identifiers("Q", 6));
  assert.equal(proofs.kind, "source-and-future-type-obligations-not-measured");
  assert.deepEqual(proofs.diagnosticPayloadTemplates, ["NAME: directory stack exceeds 4096 entries", "NAME: directory stack exceeds 4194304 UTF-8 bytes", "NAME: path exceeds 65536 UTF-8 bytes", "NAME: argument exceeds 65536 UTF-8 bytes", "NAME: HOME exceeds 65536 UTF-8 bytes", "NAME: helper work limit exceeded", "NAME: display exceeds 8388608 UTF-8 bytes"]);
  assert.match(proofs.typeGate, /^No compile fixtures or compiler runs in this freeze\./);
  assert.match(proofs.typeGate, /not missing imports/);
  const allTargets = new Set([...rowById.keys(), ...proofs.sourceInvariants.map((row) => row.id), ...proofs.negativeTypes.map((row) => row.id)]);
  const mutantIds = new Set(controls.productMutants.map((row) => row.id));
  for (const invariant of proofs.sourceInvariants) {
    assert(invariant.require && invariant.proof && invariant.controls.length > 0);
    for (const control of invariant.controls) assert(mutantIds.has(control), `unknown control ${control}`);
  }
  for (const mutant of controls.productMutants) {
    assert(mutant.mutation && mutant.role && mutant.killBy.length > 0);
    for (const target of mutant.killBy) assert(allTargets.has(target), `unknown kill target ${target}`);
  }
}

function assertMembership(names) {
  assert.deepEqual([...names].sort(), inventory, "exact frozen file membership including additions");
}

function assertDigest(bytes, expected) {
  assert.equal(digest(bytes), expected, "SHA256 mismatch");
}

function authenticateLocal() {
  assert.equal(seal.version, 1);
  assert.deepEqual(seal.directories, ["freeze-v1"]);
  assert.deepEqual(seal.files, inventory);
  assert.deepEqual(Object.keys(seal.sha256).sort(), inventory.filter((name) => name !== "freeze-v1/SEAL.json"));
  const entries = ["README.md"];
  for (const name of readdirSync(resolve(ownedRoot, freezePrefix))) {
    const path = `${freezePrefix}${name}`;
    assert(lstatSync(resolve(ownedRoot, path)).isFile(), `unexpected directory/symlink/nonregular member ${path}`);
    entries.push(path);
  }
  assert(lstatSync(resolve(ownedRoot, "README.md")).isFile());
  assert(lstatSync(resolve(ownedRoot, "freeze-v1")).isDirectory());
  assert(!lstatSync(resolve(ownedRoot, "freeze-v1")).isSymbolicLink());
  assertMembership(entries);
  for (const path of inventory) {
    const info = lstatSync(resolve(ownedRoot, path));
    assert.equal(info.mode & 0o777, 0o644, `mode ${path}`);
    const bytes = readFileSync(resolve(ownedRoot, path));
    if (path !== "freeze-v1/SEAL.json") assertDigest(bytes, seal.sha256[path]);
    if (sealedCommit) assert.deepEqual(bytes, git(["show", `${sealedCommit}:${ownedPrefix}${path}`]), `sealed Git bytes ${path}`);
  }
  if (sealedCommit) {
    const tracked = git(["ls-tree", "-r", "--name-only", sealedCommit, `${ownedPrefix}README.md`, `${ownedPrefix}freeze-v1`]).toString("utf8").trim().split("\n").map((path) => path.slice(ownedPrefix.length));
    assertMembership(tracked);
    const committedModes = git(["ls-tree", "-r", sealedCommit, `${ownedPrefix}README.md`, `${ownedPrefix}freeze-v1`]).toString("utf8").trim().split("\n");
    for (const entry of committedModes) assert.match(entry, /^100644 blob /, "committed regular-file mode");
  }
}

function authenticateReferences() {
  for (const reference of documents.binding.references) {
    assert.match(reference.commit, /^[a-f0-9]{40}$/);
    assert.match(reference.blob, /^[a-f0-9]{40}$/);
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    const bytes = git(["show", `${reference.commit}:${reference.path}`]);
    assert.equal(bytes.length, reference.bytes, `reference length ${reference.path}`);
    assertDigest(bytes, reference.sha256);
    assert.equal(git(["rev-parse", `${reference.commit}:${reference.path}`]).toString("utf8").trim(), reference.blob);
  }
  const { binding } = documents;
  const changed = ["src/fs/webdav/README.md", "src/fs/webdav/webdav.ts", "src/shell/runtime.ts"];
  const overrides = new Map(changed.map((path) => {
    const reference = binding.references.find((entry) => entry.path === path);
    assert(reference);
    return [path, reference.blob];
  }));
  const baseTree = git(["rev-parse", `${binding.acceptedCD.base}^{tree}`]).toString("utf8").trim();
  const visitedOverrides = new Set();
  function composedTree(tree, prefix, replacements) {
    const entries = git(["ls-tree", "-z", tree]).toString("utf8").split("\0").filter(Boolean);
    const chunks = entries.map((entry) => {
      const parsed = /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t(.*)$/s.exec(entry);
      assert(parsed, "well-formed tree entry");
      const [, rawMode, type, originalObject, name] = parsed;
      const path = prefix + name;
      let object = originalObject;
      if (replacements.has(path)) {
        assert.equal(type, "blob");
        object = replacements.get(path);
        visitedOverrides.add(path);
      } else if (type === "tree" && [...replacements.keys()].some((candidate) => candidate.startsWith(path + "/"))) {
        object = composedTree(originalObject, path + "/", replacements);
      }
      const mode = rawMode.replace(/^0+/, "");
      return Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(object, "hex")]);
    });
    const payload = Buffer.concat(chunks);
    return createHash("sha1").update(`tree ${payload.length}\0`).update(payload).digest("hex");
  }
  assert.equal(composedTree(baseTree, "", new Map()), baseTree, "control: unchanged Git tree hash roundtrip");
  assert.equal(composedTree(baseTree, "", overrides), binding.acceptedCD.composedTree, "exact in-memory Git composition; no object writes or product execution");
  assert.deepEqual([...visitedOverrides].sort(), changed);
  const grammarPath = "tests/shell/directory-stack-design-20260828/final-v1/grammar-cases.json";
  assert.deepEqual(git(["show", `${binding.grammarPreseal}:${grammarPath}`]), git(["show", `${binding.authorFinal}:${grammarPath}`]));
  git(["merge-base", "--is-ancestor", binding.grammarPreseal, binding.authorFinal]);
  const histories = [
    ["tests/shell/directory-stack-design-20260828/observations-01.json.gz.base64", binding.history.originalCompressedSha256],
    ["tests/shell/directory-stack-design-20260828/supplemental-observations-01.json.gz.base64", binding.history.topologyCompressedSha256],
    ["tests/shell/directory-stack-design-20260828/final-v1/grammar-observations-01.json.gz.base64", binding.history.grammarCompressedSha256]
  ];
  for (const [path, compressedSha256] of histories) {
    const compressed = Buffer.from(git(["show", `${binding.authorFinal}:${path}`]).toString("utf8"), "base64");
    assertDigest(compressed, compressedSha256);
    JSON.parse(gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8"));
  }
}

function staticControls() {
  const mutations = [
    ["N01", (data) => { data.cases.cases[1].id = "B01"; }],
    ["N02", (data) => { data.cases.cases.pop(); }],
    ["N03", (data) => { data.cases.cases.find((row) => row.id === "F02").expect.full = ["/c", "/missing", "/a"]; }],
    ["N04", (data) => { data.binding.history.virtualMatches = 34; }],
    ["N05", (data) => { data.binding.history.grammarVirtualRuns = 8; }],
    ["N06", (data) => { data.binding.gates.exactCandidate = "HEAD"; }],
    ["N07", (data) => { data.binding.gates.rootGo = true; }],
    ["N08", (data) => { data.binding.policy.separateWorkCounters = false; }],
    ["N09", (data) => { data.binding.policy.diagnosticScope = "whole-line"; }],
    ["N10", (data) => { data.binding.policy.productDelta.push("src/shell/types.ts"); }],
    ["N11", (data) => { data.binding.proofRoles.privateInvariants = "runtime-measured"; }],
    ["N12", (data) => { data.proofs.sourceInvariants[0].controls = ["U99"]; }],
    ["N13", (data) => { data.proofs.typeGate = "missing imports count as type passes"; }],
    ["N14", (data) => { data.binding.acceptedCD.composedTree = "0000000000000000000000000000000000000000"; }]
  ];
  const rejected = [];
  for (const [id, mutate] of mutations) {
    const changed = structuredClone(documents);
    mutate(changed);
    assert.throws(() => validate(changed), { name: "AssertionError" }, `static negative did not reject ${id}`);
    rejected.push(id);
  }
  assert.throws(() => assertMembership([...inventory, "freeze-v1/unlisted.txt"]), { name: "AssertionError" });
  rejected.push("N15");
  const bytes = readFileSync(resolve(ownedRoot, "freeze-v1/cases.json"));
  const altered = Buffer.from(bytes);
  altered[0] ^= 1;
  assert.throws(() => assertDigest(altered, seal.sha256["freeze-v1/cases.json"]), { name: "AssertionError" });
  rejected.push("N16");
  assert.deepEqual(rejected, identifiers("N", 16));
  return rejected;
}

authenticateLocal();
validate(documents);
authenticateReferences();
const rejected = staticControls();
authenticateLocal();
process.stdout.write(`${JSON.stringify({ status: "static-only-pass", at: new Date().toISOString(), publicCasesFrozen: 138, sourceInvariantsFrozen: 24, positiveTypesFrozen: 8, negativeTypesFrozen: 8, staticNegativesRejected: rejected, futureProductMutantFamilies: 16, futureImportNegativeFamilies: 6, immutableReferencesAuthenticated: 25, productRuns: 0, nativeRuns: 0, typeCompiles: 0, providerRequests: 0, newCandidate: null, sealedCommit: sealedCommit ?? null, appendSensitiveFrozenMembership: true, scope: "fixture/static integrity only; no implementation acceptance" }, null, 2)}\n`);
