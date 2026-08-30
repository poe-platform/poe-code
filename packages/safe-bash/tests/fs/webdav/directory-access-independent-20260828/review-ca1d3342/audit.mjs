import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { own, frozen, hash, objectHash, unpack, inventory, originalFreeze, liveProtected, write, pack } from "./common.mjs";
import { scenarios, invariants, defaults, requestBody, schema } from "../cases.mjs";

const originalHashes = originalFreeze();
const binding = JSON.parse(fs.readFileSync(path.join(own, "BINDING.json")));
assert.deepEqual(originalHashes, binding.originalFreeze);
assert.deepEqual(liveProtected(), binding.liveBefore, "live scoped files and additions preserved, not historical equality");
const source = unpack(path.join(own, "composition.json.gz"));
const candidateProof = unpack(path.join(own, "CANDIDATE-PROOF.json.gz"));
assert.equal(candidateProof.commit.tree, source.commits.candidate.tree);
const frozenProof = unpack(path.join(own, "FROZEN-INPUTS.json.gz"));
assert.equal(frozenProof.commit.tree, Buffer.from(frozenProof.commit.base64, "base64").toString().match(/^tree (\w+)$/m)[1]);
const frozenManifest = JSON.parse(Buffer.from(frozenProof.files["MANIFEST.json"].base64, "base64"));
assert.equal(hash(JSON.stringify({ schema, defaults, requestBody, invariants, scenarios })), frozenManifest.summary.expandedDataSha256);
function compose(tree, prefix = "") {
  const bytes = Buffer.from(source.treeProof[tree], "base64");
  assert.equal(objectHash("tree", bytes), tree);
  const output = [];
  for (let offset = 0; offset < bytes.length;) {
    const end = bytes.indexOf(0, offset);
    const label = bytes.subarray(offset, end).toString();
    const [mode, name] = label.split(" ");
    const namePath = prefix ? `${prefix}/${name}` : name;
    let identifier = bytes.subarray(end + 1, end + 21).toString("hex");
    if (mode === "40000" && Object.keys(binding.composition.overrides).some(value => value.startsWith(namePath + "/"))) identifier = compose(identifier, namePath);
    if (binding.composition.overrides[namePath]) identifier = source.files[namePath].blob;
    output.push(Buffer.from(label + "\0"), Buffer.from(identifier, "hex"));
    offset = end + 21;
  }
  return objectHash("tree", Buffer.concat(output));
}
assert.equal(compose(source.commits.baseline.tree), source.composedTree, "only two authorized overrides in full tree");
const final = JSON.parse(fs.readFileSync(path.join(own, "RESULT-v3.json")));
assert.equal(final.fatal, undefined);
const tarBytes = fs.readFileSync(path.join(own, "candidate.tgz"));
assert.equal(hash(tarBytes), final.package.sha256);
const tar = gunzipSync(tarBytes);
const packed = {};
const packedBytes = new Map();
let offset = 0;
while (offset + 512 <= tar.length) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, "");
  const octal = (start, end) => Number.parseInt(text(start, end).trim(), 8);
  assert.equal(octal(148, 156), header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0));
  assert.equal(text(156, 157), "0", "regular package entries only");
  const archivePath = [text(345, 500), text(0, 100)].filter(Boolean).join("/");
  assert.ok(archivePath.startsWith("package/"));
  const name = archivePath.slice(8);
  assert.ok(!name.split("/").some(part => part === ".." || part === ""));
  assert.ok(!Object.hasOwn(packed, name));
  const bytes = octal(124, 136);
  const payload = tar.subarray(offset + 512, offset + 512 + bytes);
  assert.equal(payload.length, bytes);
  packed[name] = { sha256: hash(payload), bytes, mode: octal(100, 108) & 0o777 };
  packedBytes.set(name, payload);
  offset += 512 + Math.ceil(bytes / 512) * 512;
}
assert.ok(tar.subarray(offset).every(byte => byte === 0));
assert.deepEqual(packed, unpack(path.join(own, "raw/run-03/package-inventory.json.gz")));
assert.equal(packed["package.json"].sha256, source.files["package.json"].sha256);
const packageManifest = JSON.parse(packedBytes.get("package.json"));
assert.deepEqual(packageManifest.dependencies ?? {}, {});
for (const entry of Object.values(packageManifest.exports)) {
  if (entry.import.includes("*")) {
    const [prefix, suffix] = entry.import.slice(2).split("*");
    const matches = Object.keys(packed).filter(name => name.startsWith(prefix) && name.endsWith(suffix));
    assert.ok(matches.length > 0);
    for (const name of matches) assert.ok(packed[entry.types.slice(2).replace("*", name.slice(prefix.length, -suffix.length))]);
  } else {
    assert.ok(packed[entry.import.slice(2)]);
    assert.ok(packed[entry.types.slice(2)]);
  }
}
const emitted = unpack(path.join(own, "raw/run-01/emitted.json.gz"));
assert.deepEqual(Object.fromEntries(Object.entries(packed).filter(([name]) => name.startsWith("dist/")).map(([name, value]) => [name.slice(5), value])), emitted);
const layouts = {};
for (const layout of ["source", "installed", "moved"]) {
  const prefix = path.join(own, "raw/run-03", layout);
  const result = unpack(prefix + ".result.json.gz");
  const load = unpack(prefix + ".load.json.gz");
  const config = JSON.parse(fs.readFileSync(prefix + ".config.json"));
  const types = unpack(prefix + ".types.json.gz");
  assert.deepEqual(result.cases.map(record => record.id), scenarios.map(record => record.id));
  for (let index = 0; index < scenarios.length; index++) {
    const expected = scenarios[index];
    const actual = result.cases[index];
    assert.equal(actual.status, "pass");
    assert.deepEqual(actual.errors, []);
    assert.equal(actual.resources.clean, true);
    assert.equal(actual.resources.pendingCalls, 0);
    assert.equal(actual.resources.deferredFetches, 0);
    assert.equal(actual.resources.leakedResponses, 0);
    assert.equal(actual.resources.guardFailure, false);
    assert.deepEqual(actual.resources.unhandled, []);
    assert.equal(actual.outcomes.length, expected.calls.length);
    for (let call = 0; call < expected.calls.length; call++) {
      assert.equal(actual.outcomes[call].outcome, expected.calls[call].outcome);
      if (!['OK', 'directory'].includes(expected.calls[call].outcome)) {
        assert.equal(actual.outcomes[call].typed, true); assert.equal(actual.outcomes[call].rawReasonThrown, false);
      }
    }
    assert.equal(actual.requests.length, expected.requests.length);
    for (let request = 0; request < expected.requests.length; request++) {
      const observed = actual.requests[request];
      const wanted = expected.requests[request];
      assert.equal(observed.method, wanted.method); assert.equal(observed.url, wanted.url); assert.equal(observed.depth, wanted.depth);
      assert.deepEqual(observed.resources, wanted.resources);
      assert.equal(observed.signalPresent, true); assert.equal(observed.signalAbortedAtAdmission, false);
      assert.equal(observed.redirect, "manual"); assert.equal(observed.credentials, "omit");
    }
  }
  const product = load.loaded.filter(record => record.product);
  for (const record of product) {
    const name = path.relative(config.productRoot, record.filename);
    assert.equal(record.sha256, layout === "source" ? source.files[name]?.sha256 : packed[name]?.sha256);
    assert.ok(layout === "source" ? name.startsWith("src/") && name.endsWith(".ts") : name.startsWith("dist/") && name.endsWith(".js"));
  }
  assert.equal(load.networkAttempts, 0); assert.deepEqual(load.rejected, []);
  assert.equal(types.positiveAssertions, 8); assert.equal(types.negativeAssertions, 10);
  assert.deepEqual(types.originalDiagnostics, []);
  assert.equal(types.targetedNegativeDiagnostics.length, 10);
  for (const control of types.targetedNegativeDiagnostics) {
    assert.equal(control.diagnostics.length, 1); assert.equal(control.diagnostics[0].code, 2344);
    assert.equal(control.diagnostics[0].line, control.originalLine);
    assert.equal(path.basename(control.diagnostics[0].file), "typed-inputs.ts");
  }
  for (const [filename, sha256] of Object.entries(types.declarationAndSourceReads)) if (filename.startsWith(config.productRoot + "/")) {
    const name = path.relative(config.productRoot, filename);
    assert.equal(sha256, layout === "source" ? (source.files[name]?.sha256 ?? config.allowedFiles[filename]) : packed[name]?.sha256);
    if (layout !== "source") assert.ok(!name.startsWith("src/"));
  }
  layouts[layout] = { pass: result.cases.length, fail: 0, blocked: 0, untested: 0, modules: new Set(product.map(record => record.filename)).size,
    positiveTypes: 8, negativeTypes: 10, targetDiagnostics: 10, typesReadFiles: Object.keys(types.declarationAndSourceReads).length,
    groups: Object.fromEntries([...new Set(scenarios.map(record => record.group))].map(group => [group, result.cases.filter(record => record.group === group).length])) };
}
const mutants = [];
for (const control of final.sourceMutants) {
  const result = unpack(path.join(own, `raw/run-03/mutant-${control.id}.result.json.gz`));
  const load = unpack(path.join(own, `raw/run-03/mutant-${control.id}.load.json.gz`));
  const original = Buffer.from(source.files["src/fs/webdav/webdav.ts"].base64, "base64").toString();
  assert.equal(original.split(control.from).length, 2);
  assert.equal(hash(original.replace(control.from, control.to)), control.mutatedProviderSha256);
  assert.ok(load.loaded.some(record => record.product && record.sha256 === control.mutatedProviderSha256));
  assert.deepEqual(load.rejected, []);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].id, control.witness);
  assert.equal(result.cases[0].status, "fail");
  assert.equal(result.cases[0].resources.clean, true);
  assert.equal(final.layouts.source.cases.find(record => record.id === control.witness).status, "pass");
  mutants.push({ id: control.id, witness: control.witness, actual: result.cases[0].outcomes.map(record => record.outcome), killed: true, loaderFailure: false });
}
assert.equal(mutants.length, 5);
for (const control of final.loadControls) {
  const record = unpack(path.join(own, `raw/run-03/load-${control.id}.json.gz`));
  assert.equal(record.result.observed, control.expected);
  assert.ok(record.load.rejected.some(value => value.code === control.expected));
  assert.equal(record.load.networkAttempts, 0);
}
const children = [...JSON.parse(fs.readFileSync(path.join(own, "raw/run-01/children.json"))), ...final.children];
for (const child of children) {
  assert.equal(child.signal, null); assert.equal(child.error, undefined);
  const run = final.children.includes(child) ? "run-03" : "run-01";
  for (const stream of ["stdout", "stderr"]) assert.equal(hash(fs.readFileSync(path.join(own, "raw", run, `${child.label}.${stream}.txt`))), child[`${stream}Sha256`]);
}
const scratch = path.join(own, "scratch");
const tools = JSON.parse(fs.readFileSync(path.join(own, "TOOLS.json")));
const scratchAvailable = fs.existsSync(scratch);
if (scratchAvailable) {
  for (const [name, record] of Object.entries(tools)) {
    const filename = path.join(scratch, "tools", name);
    if (record.inventory) assert.deepEqual(inventory(filename), record.inventory);
    else assert.equal(hash(fs.readFileSync(filename)), record.sha256);
  }
  const currentSource = inventory(path.join(scratch, "composition/src"));
  const expectedSource = Object.fromEntries(Object.entries(source.files).filter(([name]) => name.startsWith("src/")).map(([name, record]) => [name.slice(4), { sha256: record.sha256, bytes: Buffer.from(record.base64, "base64").length, mode: record.mode }]));
  assert.deepEqual(currentSource, expectedSource);
  for (const [name, record] of Object.entries(source.files)) assert.equal(hash(fs.readFileSync(path.join(scratch, "composition", name))), record.sha256);
  const initial = unpack(path.join(own, "PREPARED-INVENTORY.json.gz"));
  const expectedDependencies = Object.fromEntries(Object.entries(initial).filter(([name]) => name.startsWith("composition/node_modules/")).map(([name, record]) => [name.slice("composition/node_modules/".length), record]));
  assert.deepEqual(inventory(path.join(scratch, "composition/node_modules")), expectedDependencies);
  assert.deepEqual(inventory(path.join(scratch, "physically-moved-consumer/node_modules/virtual-bash")), packed);
  assert.equal(fs.existsSync(path.join(scratch, "installed-consumer")), false);
}
const report = { schema: "independent-ca1d-audit/v1", auditedAt: new Date().toISOString(), originalSevenUnchanged: true,
  composedTree: source.composedTree, onlyAuthorizedOverridePaths: Object.keys(binding.composition.overrides), sourceFiles: Object.keys(source.files).length,
  packageSha256: hash(tarBytes), packageEntries: Object.keys(packed).length, layouts, sourceMutants: mutants,
  loadControls: final.loadControls.length, children: { total: children.length, natural: children.length, watchdogTerminations: 0,
    nonzero: children.filter(record => record.status !== 0).map(record => ({ label: record.label, status: record.status })) },
  liveScopePreserved: true, scratchAvailable, preservationIncludesAdditions: true, actualService: "unavailable/not-run",
  invariantInterpretation: "SOURCE-REVIEW.md maps all eight; empirical checks plus design limits, not eight runtime theorem passes",
  runtimeStage2: "HELD", historicalSourceRun01: "102 pass separately retained; type frontend failed with incidental DOM lib" };
if (process.argv[2] === "--capture") write(path.join(own, "AUDIT.json.gz"), pack(report));
else if (fs.existsSync(path.join(own, "AUDIT.json.gz"))) {
  const prior = unpack(path.join(own, "AUDIT.json.gz"));
  assert.deepEqual(report.layouts, prior.layouts); assert.deepEqual(report.sourceMutants, prior.sourceMutants);
  assert.equal(report.composedTree, prior.composedTree); assert.equal(report.packageSha256, prior.packageSha256);
}
console.log(JSON.stringify(report));
