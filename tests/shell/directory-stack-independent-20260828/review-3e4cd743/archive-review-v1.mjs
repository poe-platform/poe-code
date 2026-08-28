import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const objectHash = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const read = name => JSON.parse(readFileSync(resolve(root, name)));
const binding = read("BINDING-v1.json");
const scratch = ["raw-v1", "raw-v2", "work-v1", "work-v2", "type-results-v2", "mechanism-results-v1", "mechanism-work-v1", "import-results-v1", "import-work-v1", "import-results-v2", "import-work-v2", "regression-results-v1", "regression-work-v1", "regression-results-v2", "regression-work-v2", "regression-results-v3", "regression-work-v3", "regression-results-v4", "regression-work-v4"];
function census(path) {
  const entries = {};
  function visit(relative) {
    const absolute = resolve(path, relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) entries[relative] = { kind: "symlink", mode: stat.mode & 0o777, target: readlinkSync(absolute) };
    else if (stat.isDirectory()) { entries[relative] = { kind: "directory", mode: stat.mode & 0o777 }; for (const name of readdirSync(absolute).sort()) visit(relative ? relative + "/" + name : name); }
    else { assert(stat.isFile()); entries[relative] = { kind: "file", mode: stat.mode & 0o777, bytes: stat.size, sha256: sha(readFileSync(absolute)) }; }
  }
  visit(""); return entries;
}
const inventories = Object.fromEntries(scratch.map(name => [name, census(resolve(root, name))]));
const archive = { version: 1, role: "complete new raw evidence and input configs, no tool or whole copied-product archives", files: [] };
function capture(path) {
  const bytes = readFileSync(resolve(root, path)), text = bytes.toString("utf8"); assert.deepEqual(Buffer.from(text), bytes);
  archive.files.push({ path, mode: lstatSync(resolve(root, path)).mode & 0o777, sha256: sha(bytes), text });
}
for (const name of scratch.filter(name => name.includes("results-") || name === "raw-v2")) {
  for (const [path, entry] of Object.entries(inventories[name])) if (entry.kind === "file" && !path.split("/").includes("node_modules")) capture(name + "/" + path);
}
for (const name of ["work-v1", "work-v2"]) for (const path of readdirSync(resolve(root, name)).filter(path => path.endsWith("-admission.json"))) capture(name + "/" + path);
const original = JSON.parse(gunzipSync(Buffer.from(readFileSync(resolve(root, "ORIGINAL-RAW-v1.json.gz.base64"), "utf8"), "base64")));
assert.deepEqual(original.files.map(entry => entry.name).sort(), Object.keys(inventories["raw-v1"]).filter(path => inventories["raw-v1"][path].kind === "file").sort());
for (const entry of original.files) { assert.equal(sha(Buffer.from(entry.base64, "base64")), entry.sha256); assert.equal(entry.sha256, inventories["raw-v1"][entry.name].sha256); }
const trees = {};
function tree(object) {
  if (trees[object]) return trees[object].entries;
  const raw = git(["cat-file", "tree", object]); assert.equal(objectHash("tree", raw), object);
  const entries = git(["ls-tree", "-z", object]).toString().split("\0").filter(Boolean).map(line => { const match = /^(\d+) (blob|tree|commit) ([a-f0-9]{40})\t(.*)$/s.exec(line); assert(match); return { mode: match[1], type: match[2], object: match[3], name: match[4] }; });
  trees[object] = { rawBase64: raw.toString("base64"), entries }; return entries;
}
function composed(object, prefix, overrides) {
  const chunks = tree(object).map(entry => {
    const path = prefix + entry.name;
    const replacement = overrides.get(path) ?? (entry.type === "tree" && [...overrides.keys()].some(key => key.startsWith(path + "/")) ? composed(entry.object, path + "/", overrides) : entry.object);
    return Buffer.concat([Buffer.from(`${entry.mode.replace(/^0+/, "")} ${entry.name}\0`), Buffer.from(replacement, "hex")]);
  });
  return objectHash("tree", Buffer.concat(chunks));
}
const commitIds = [...new Set([binding.candidate, binding.baseline, binding.baseLET, binding.dav, binding.evidence])];
const commits = Object.fromEntries(commitIds.map(commit => { const bytes = git(["cat-file", "commit", commit]); assert.equal(objectHash("commit", bytes), commit); return [commit, { raw: bytes.toString(), tree: /^tree ([a-f0-9]{40})$/m.exec(bytes.toString())[1] }]; }));
const baselineTree = commits[binding.baseline].tree;
const baseOverrides = new Map([...["src/fs/webdav/webdav.ts", "src/fs/webdav/README.md"].map(path => [path, git(["rev-parse", binding.dav + ":" + path]).toString().trim()]), ["src/shell/runtime.ts", git(["rev-parse", binding.baseLET + ":src/shell/runtime.ts"]).toString().trim()]]);
assert.equal(composed(baselineTree, "", new Map()), baselineTree);
assert.equal(composed(baselineTree, "", baseOverrides), binding.baseComposedTree);
const candidateOverrides = new Map(baseOverrides);
for (const path of binding.overrides) candidateOverrides.set(path, binding.source.find(entry => entry.path === path).blob);
const candidateComposedTree = composed(baselineTree, "", candidateOverrides);
const selected = binding.source.map(entry => {
  const bytes = git(["show", entry.commit + ":" + entry.path]); assert.equal(sha(bytes), entry.sha256); assert.equal(objectHash("blob", bytes), entry.blob);
  let current = commits[entry.commit].tree;
  const parts = entry.path.split("/");
  for (const [index, name] of parts.entries()) { const found = tree(current).find(value => value.name === name); assert(found); current = found.object; if (index === parts.length - 1) { assert.equal(current, entry.blob); assert.equal(found.mode, entry.mode); } }
  return { ...entry, text: bytes.toString() };
});
const reconstruction = { version: 1, candidateComposedTree, baseComposedTree: binding.baseComposedTree, candidateGitTree: binding.candidateTree, baselineTree, commits, trees, overrides: Object.fromEntries(candidateOverrides), selected, role: "raw committed objects and265 exact selected inputs; mathematical composed tree needs no loose Git object and no object writes" };
const build = read("raw-v1/BUILD-STATE.json"), packed = readFileSync(resolve(root, "work-v1/" + build.metadata.filename));
assert.equal(sha(packed), binding.expectedAuthorPackageSha256); assert.equal(build.metadata.entryCount, 846);
const cases = read("../freeze-v1/cases.json").cases, first = read("raw-v1/CASES-RESULTS.json"), corrected = read("raw-v2/CASES-RESULTS.json");
assert.equal(first.length, 414); assert.equal(corrected.length, 84);
const dispositions = cases.map(row => {
  const layouts = Object.fromEntries(["source", "installed", "moved"].map(layout => {
    const initial = first.find(value => value.id === row.id && value.layout === layout), later = corrected.find(value => value.id === row.id && value.layout === layout);
    assert(initial?.natural && initial.intact && initial.loadedProductModules === 207); if (later) assert(later.natural && later.intact && later.kind === "pass" && later.loadedProductModules === 207);
    const chosen = later ?? initial;
    return [layout, { original: initial.kind, correction: later ? later.report.inputVersion : null, status: row.id === "S13" ? "original-fixture-unsupported-supported-bash-supplement-pass" : row.id === "C06" ? "partial-public-plus-source-equal-reason-stack-schedule-unmeasured" : "qualified-public-and-source-pass", sourceOnlyUnmeasured: chosen.report.result?.sourceOnlyUnmeasured ?? {}, modules: chosen.loadedProductModules }];
  }));
  return { id: row.id, area: row.area, layouts };
});
const mechanisms = read("mechanism-results-v1/RESULTS.json"), imports = read("import-results-v2/RESULTS.json"), types = read("type-results-v2/RESULTS.json");
const summary = { version: 1, at: new Date().toISOString(), candidate: binding.candidate, evidence: binding.evidence, candidateComposedTree, baseComposedTree: binding.baseComposedTree, package: { sha256: sha(packed), members: build.metadata.entryCount, bytes: packed.length }, originalCounts: binding.originalCounts, layouts: Object.fromEntries(["source", "installed", "moved"].map(layout => [layout, { originalPass: first.filter(entry => entry.layout === layout && entry.kind === "pass").length, originalAssertionFailure: first.filter(entry => entry.layout === layout && entry.kind === "assertion-failure").length, versionedCorrectionPass: corrected.filter(entry => entry.layout === layout && entry.kind === "pass").length, qualifiedOriginalObligations: 136, partialPublicSource: 1, unsupportedOriginalFixture: 1, leakTimeoutIntegrityBlocked: 0, measuredModulesPerCase: 207 }])), types: { checks: types.results.length, pass: types.results.filter(entry => entry.status === "pass").length, originalPositiveObligations: 8, originalNegativeObligations: 8, inversionChecksPerLayout: 8 }, mechanisms: { families: mechanisms.results.length, semanticKills: mechanisms.results.filter(entry => entry.status === "semantic-killed").length, loadedSourceControlsNoKillClaim: mechanisms.results.filter(entry => entry.status === "loaded-source-control-no-public-kill-claim").length }, imports: { families: 6, actualImports: imports.results.filter(entry => entry.id).length, actualNegativeImports: imports.results.filter(entry => entry.id && entry.family !== "positive").length, preimportRefusals: 2, positiveTypeHarnessRefusal: 1 }, regressions: { initialHarnessBlockedFiles: 11, secondVersion: read("regression-results-v2/RESULTS.json"), thirdVersion: read("regression-results-v3/RESULTS.json"), fourthVersion: read("regression-results-v4/RESULTS.json"), acceptedDistinct: { shellGetoptsInvokeOwned: 176, selectedCD: 17, selectedLET: 3, total: 196 }, qualification: "142v2+33v3+1v4 distinct shell regression assertions;1v2 missing dynamic corpus and1v3 missing fixture retained; CD selected17, LET3, not old entirecohorts" }, gaps: { originalIds: ["L01", "L02", "L13", "L14", "L15", "L16", "C02", "C03", "C04", "C05", "C06", "C10", "C12", "A04"], qualifiedAdapters: 13, partialPublicSource: ["C06"] }, sourceProofs: 24, dispositions, noExecution: ["native-oracle", "real-service", "SafeJS", "guest", "new-feature", "global-gate"], limitations: ["C06 equal-valued simultaneous root/escaping/local stack schedule not dynamically completed; existing unchanged-source provenance and scoped unit/public regressions support it but are not that observation", "S13 original /bin/sh shebang unsupported in accepted LET and candidate; /bin/bash supplement is distinct", "I24 private work, final flush, diagnostic ownership and masked8Mi display remain source-only; no fabricated runtime counters", "Directory membership and file modes guarded before/after; directory modes added only to final archival/cleanup census, not retroclaimed per execution", "Natural direct child close observed; no independent descendant process census or opaque host preemption guarantee", "Post-source versioned adapters and controls never claimed original precode; no production fixes"] };
const additions = {
  "EVIDENCE-v1.json.gz.base64": gzipSync(JSON.stringify(archive), { level: 9 }).toString("base64"),
  "RECONSTRUCTION-v1.json.gz.base64": gzipSync(JSON.stringify(reconstruction), { level: 9 }).toString("base64"),
  "SCRATCH-CENSUS-v1.json.gz.base64": gzipSync(JSON.stringify({ version: 1, at: summary.at, inventories }), { level: 9 }).toString("base64"),
  "PACKAGE-v1.tgz.base64": packed.toString("base64"),
  "RESULTS-v1.json": JSON.stringify(summary, null, 2)
};
for (const name of Object.keys(additions)) if (name.endsWith("base64")) additions[name] = additions[name].match(/.{1,120}/g).join("\n");
const manifest = { version: 1, at: summary.at, archiveFiles: Object.entries(additions).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text + "\n"), sha256: sha(text + "\n") })), capturedNewRawAndConfigs: archive.files.length, originalRawFiles: original.files.length, selectedSourceInputs: selected.length, scratchNames: scratch, rawRole: "complete original andnew captures; exact tools/products reconstructible from selectedsource, package and hash inventories, not vendored dependency archives" };
additions["EVIDENCE-MANIFEST-v1.json"] = JSON.stringify(manifest, null, 2);
execFileSync("apply_patch", [], { cwd: repository, maxBuffer: 64 * 1024 * 1024, input: "*** Begin Patch\n" + Object.entries(additions).map(([name, text]) => "*** Add File: " + resolve(root, name) + "\n" + text.split("\n").map(line => "+" + line).join("\n") + "\n").join("") + "*** End Patch\n" });
process.stdout.write(JSON.stringify({ at: summary.at, files: manifest.archiveFiles.map(entry => ({ path: entry.path, bytes: entry.bytes })), originalRawFiles: original.files.length, newRawAndConfigs: archive.files.length, candidateComposedTree }) + "\n");
