import assert from "node:assert/strict";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, owner, candidate, read, json, digest, objectHash, inventory } from "./common.mjs";
import { inputs, tools, treeEntries, bindAcceptedProof, git, metadataReceipts } from "../component-execution-v5/auth.mjs";
import { auditArchive } from "./archive.mjs";
export { inputs, tools, git, metadataReceipts };
export const previous = join(repository, owner, "r21-n04-reconciliation-v1");
export const refs = {
  v5: { commit: "7b68a7b2866217a21d52ff8b99dcab166f83f5ae", folder: "component-execution-v5", manifest: "b8605b3dfe7d35723d6d24627a797edb0a60165e614c5800e54ffba4e0ff08f1", seal: "0a37b5795ac594f1a1e587786295bb0dd21019162b3c76cfff3607fec6c232b1" },
  targeted: { commit: "7c11c00d74316299342d75f74c7f9dd631065902", folder: "r21-n04-reconciliation-v1", manifest: "e89be0a522712f0fc51555d5b8a34b6d96b71365a735de1e7732c1e9f3a8c466", seal: "6202ffd8c2f8dad281c4355fc8c7ca9f6ade3e52ce4d857a0737567550e57e34" },
  du: { commit: "be0222a375613cf37e6e3eb5e5a7da0886905a20", folder: "accepted-du75-binding-v1", manifest: "e1d36287b8fbfc706869a1ea9683df12b6f6d2942c1b5dd936ef27576dc6d863" },
};
const pathFor = folder => join(repository, owner, folder);
function bindFile(row) {
  const path = join(repository, row.path), bytes = read(path);
  assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); assert.equal(lstatSync(path).mode & 0o777, 0o644);
  assert.ok(git("ls-tree", row.commit, "--", row.path).toString().includes(`100644 blob ${objectHash(bytes)}\t${row.path}`));
}
export function guardRecipe(commit) {
  const seal = json(join(directory, "RECIPE-SEAL.json"));
  for (const row of seal.entries) {
    assert.equal(read(join(directory, row.path)).length, row.bytes); assert.equal(digest(read(join(directory, row.path))), row.sha256); assert.equal(lstatSync(join(directory, row.path)).mode & 0o777, row.mode);
  }
  const allowed = [...seal.entries.map(row => row.path), "RECIPE-SEAL.json", "work", "PRE-BINDINGS.json", "POST-BINDINGS.json", "REPORT.json", "OUTER.json", "EXECUTION.raw.txt", "MANIFEST.json", "RAW.jsonl.gz", "EVIDENCE-SEAL.json", "MATRIX.json", "CHECKPOINT.md"];
  for (const name of readdirSync(directory)) assert.ok(allowed.includes(name), `undeclared new entry ${name}`);
  if (commit) {
    const rows = treeEntries(commit, `${owner}/r21-composed-public-v1`);
    assert.deepEqual(rows.map(row => row.path.split("/").at(-1)).sort(), [...seal.entries.map(row => row.path), "RECIPE-SEAL.json"].sort());
  }
  for (const runtime of inputs.runtimes) assert.equal(digest(read(runtime.executable)), runtime.sha256);
}
export async function authenticate({ raw = false, commit } = {}) {
  for (const tool of tools) { assert.equal(digest(read(tool.path)), tool.sha256); assert.equal(lstatSync(tool.path).mode & 0o777, tool.mode); }
  const pins = json(join(previous, "PINS.json")), groups = [...pins.history];
  for (const ref of Object.values(refs)) groups.push({ commit: ref.commit, prefix: `${owner}/${ref.folder}` });
  groups.push({ commit: refs.targeted.commit, prefix: `${owner}/r21-n04-reconciliation-v1-result` });
  const histories = [];
  for (const group of groups) {
    const entries = treeEntries(group.commit, group.prefix); if (group.entries) assert.deepEqual(entries, group.entries);
    assert.deepEqual(readdirSync(join(repository, group.prefix)).filter(name => name !== "work").sort(), entries.map(row => row.path.slice(group.prefix.length + 1)).sort());
    histories.push({ commit: group.commit, prefix: group.prefix, files: entries.length, entriesSha256: digest(JSON.stringify(entries)) });
  }
  for (const row of pins.bindings) bindFile(row);
  for (const ref of Object.values(refs)) assert.equal(digest(read(join(pathFor(ref.folder), "MANIFEST.json"))), ref.manifest);
  for (const ref of [refs.v5, refs.targeted]) {
    assert.equal(digest(read(join(pathFor(ref.folder), "EVIDENCE-SEAL.json"))), ref.seal);
    for (const row of json(join(pathFor(ref.folder), "EVIDENCE-SEAL.json")).artifacts) {
      const bytes = read(join(pathFor(ref.folder), row.path)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
    }
  }
  const du = json(join(pathFor(refs.du.folder), "BINDING.json"));
  for (const [name, row] of Object.entries(json(join(pathFor(refs.du.folder), "MANIFEST.json")).files)) { const bytes = read(join(pathFor(refs.du.folder), name)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); }
  for (const row of Object.values(du.sources)) bindFile(row);
  assert.equal(du.du.selectedBase, "0895de2dc63014989f23912c3d48f7c4d0d35a47"); assert.equal(du.du.composition.total, 29); assert.equal(du.expr.candidate, candidate);
  for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
  assert.deepEqual(inventory(pathFor("component-admission-v1")), inputs.admissionFiles);
  const proof = bindAcceptedProof();
  const v5 = json(join(pathFor(refs.v5.folder), "REPORT.json")), targeted = json(join(previous, "REPORT.json"));
  assert.equal(v5.candidate, candidate); assert.equal(v5.allProcessChildrenClosed, true); assert.equal(v5.allObservedWorkersClosed, true);
  assert.equal(v5.observedWorkers, 80); assert.equal(v5.counts.pass, 100); assert.equal(v5.counts.typePass, 32); assert.equal(v5.counts.controlsPass, 36);
  assert.equal(targeted.counts.targetPass, 8); assert.equal(targeted.counts.controlsPass, 72); assert.equal(targeted.allChildrenClosed, true);
  const retained = v5.contexts.map(context => {
    assert.equal(context.cases.length, 26); assert.deepEqual(context.cases.filter(row => row.status !== "pass").map(row => row.id), ["R21"]);
    assert.ok(context.cases.every(row => row.executed && row.naturalSettlement));
    assert.deepEqual(context.types.filter(row => row.status !== "pass").map(row => row.id), ["N04", "combined"]);
    for (const id of ["R25", "R26"]) assert.equal(context.cases.find(row => row.id === id).status, "pass");
    const amendedTypes = targeted.types.filter(row => row.label === context.label); assert.equal(amendedTypes.length, 2); assert.ok(amendedTypes.every(row => row.status === "pass" && row.executed));
    return { label: context.label, runtime: context.cases.filter(row => row.status === "pass").map(row => row.id), types: context.types.filter(row => row.status === "pass").map(row => row.id), amendedTypes };
  });
  assert.equal(retained.length, 4);
  const admission = json(join(pathFor("component-admission-v1"), "AUTHENTICATION.json"));
  const handoff = json(join(repository, "tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json"));
  assert.equal(git("rev-parse", `${candidate}^{tree}`).toString().trim(), handoff.candidateTree);
  for (const row of handoff.engineBindings) {
    assert.equal(inputs.selected.find(input => input.path === row.path)?.sha256, row.sha256);
    assert.ok(git("ls-tree", handoff.acceptedEngineCommit, "--", row.path).toString().includes(row.gitBlob));
  }
  const duOriginal = json(join(repository, du.sources.duOriginalReport.path)), duContinuation = json(join(repository, du.sources.duContinuationReport.path));
  assert.equal(duOriginal.candidate, du.du.selectedBase); assert.equal(duContinuation.candidate, du.du.selectedBase);
  assert.equal(duOriginal.package.tarballSha256, du.du.pack.sha256); assert.equal(duContinuation.package.tarballSha256, du.du.pack.sha256);
  const inspection = json(join(previous, "INSPECTION.json"));
  const original = json(join(repository, owner, "cases.json")).runtimeCases.find(row => row.id === "R21");
  assert.equal(original.args[0], "bad\0arg"); assert.equal(original.variants.length, 1); assert.equal(original.variants[0].args[0], "\ud800");
  assert.deepEqual(json(join(previous, "cases.json")).runtimeCases.find(row => row.id === "R21"), original);
  if (commit) guardRecipe(commit);
  const archives = raw ? await Promise.all([refs.v5, refs.targeted].map(async ref => ({ commit: ref.commit, ...await auditArchive(pathFor(ref.folder)) }))) : [];
  return { packBytes: proof.packBytes, bindings: { schema: "expr-composed-provenance/1", authorizationDate: "2026-08-28", candidate, tree: handoff.candidateTree, integrationSource: handoff.integrationSourceCommit,
    acceptedEngine: handoff.acceptedEngineCommit, originalFreeze: handoff.independentFreeze, addendumCommit: "a0142c7711c4be2cc33384c87bd6d8dea9e3d07d", addendumSha256: "d4c894e971725f0a6b0ee6f8d6c20f8ad3d39a63c9ac8aa114788474e898d1b7",
    handoff: { commit: "8d07bd6e7549aaa9a1096c3e9278b231692bc699", path: "tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json", sha256: digest(read(join(repository, "tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json"))) },
    authorArchive: { ...admission.authorArchive, qualification: "BOUND admission-era read-only author archive hash; no new full archive stream/extraction/build. Independent P01 uses selected Git objects, not this archive." },
    sourceProfile: { selectedGitInputs: 357, inventoryPath: `${owner}/component-execution-v1/INPUTS.json`, inventorySha256: digest(read(join(repository, owner, "component-execution-v1/INPUTS.json"))), independentFullCandidateArchive: false, sourceScope: handoff.sourceScopeQualification },
    P01: proof.P01, refs, histories, archives, retained,
    retainedRecipes: [refs.v5, refs.targeted].map(ref => { const seal = json(join(pathFor(ref.folder), "EVIDENCE-SEAL.json")); return { evidenceCommit: ref.commit, recipeCommit: seal.recipeCommit, recipeManifestSha256: seal.recipeManifestSha256 }; }),
    declarationBindings: ["dist/index.d.ts", "dist/commands/expr/index.d.ts"].map(path => ({ path, sha256: inputs.packageFiles[path], status: "package bytes bound; actual type resolution retained from v5/targeted TRACE, not new type execution" })),
    acceptedEngineBindings: handoff.engineBindings,
    DU: { status: "ROOT_ACCEPTED_BOUND_NOT_EXECUTED", evidence: refs.du, ...du.du, sources: du.sources, boundFullPackReproduction: duOriginal.package.boundFullPackReproduction, archiveScope: "Bound DU receipts declare scoped committed archive, not full-history archive; no independent DU archive build/hash claim added here" }, originalR21: original,
    sourceTrace: inspection.pathTrace.map(({ excerpts, ...row }) => row), runtimes: inputs.runtimes, tools,
    previous: { v5: v5.counts, targeted: targeted.counts, workers: v5.observedWorkers, traceControls: json(join(pathFor(refs.v5.folder), "EVIDENCE-SEAL.json")).controls, reader: proof.reader, repair: proof.repair },
    exclusions: ["No original104/40 all-green replay or rescore", "No new N04/types/P01/R25/R26/DU/HTML/engine execution", "Original failures/raw/acceptedBeforeRun unchanged", "No76-command behavior/fullgate/release/Dirac certification", handoff.sourceScopeQualification] } };
}
