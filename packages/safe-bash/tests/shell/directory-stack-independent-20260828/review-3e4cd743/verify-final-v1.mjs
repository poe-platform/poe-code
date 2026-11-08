import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { census, decodeEvidence, objectHash, sha256, unpack } from "./evidence-data-v1.mjs";
const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../.."), prefix = root.slice(repository.length + 1) + "/";
const preclean = process.argv[2] === "--preclean", commit = process.argv[preclean ? 3 : 2];
assert.match(commit ?? "", /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const json = path => JSON.parse(readFileSync(resolve(root, path)));
const binding = json("BINDING-v1.json"), result = json("RESULTS-v1.json"), manifest = json("EVIDENCE-MANIFEST-v1.json"), compact = json("EVIDENCE-MANIFEST-v2.json");
const groups = [];
function check(id, body) { body(); groups.push(id); }
function committed(path) { assert.deepEqual(readFileSync(resolve(root, path)), git(["show", commit + ":" + prefix + path])); }
check("V01-sealed-evidence-manifests", () => { committed("EVIDENCE-MANIFEST-v1.json"); committed("EVIDENCE-MANIFEST-v2.json"); for (const entry of [...manifest.archiveFiles.filter(entry => entry.path !== "EVIDENCE-v1.json.gz.base64"), compact]) { const bytes = readFileSync(resolve(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256); } assert.equal(compact.supersedesUncommittedEncoding.sha256, manifest.archiveFiles[0].sha256); });
check("V02-prior49-immutable-append-aware", () => {
  assert.equal(binding.priorFiles.length, 49);
  const found = [];
  function walk(path) { for (const name of readdirSync(path).sort()) { const absolute = resolve(path, name); if (absolute === root) continue; const stat = lstatSync(absolute); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(absolute); else { assert(stat.isFile()); found.push(absolute.slice(repository.length + 1)); } } }
  walk(resolve(root, "..")); assert.deepEqual(found.sort(), binding.priorFiles.map(entry => entry.path).sort());
  for (const entry of binding.priorFiles) { const bytes = readFileSync(resolve(repository, entry.path)); assert.equal(sha256(bytes), entry.sha256); assert.equal(objectHash("blob", bytes), entry.blob); assert.equal(lstatSync(resolve(repository, entry.path)).mode & 0o777, Number.parseInt(entry.mode, 8) & 0o777); assert.deepEqual(bytes, git(["show", entry.commit + ":" + entry.path])); }
});
const reconstruction = unpack(resolve(root, "RECONSTRUCTION-v1.json.gz.base64")), prerequisite = json("RECONSTRUCTION-PREREQUISITE-v1.json");
const trees = { ...reconstruction.trees, ...prerequisite.trees };
function reach(tree, path) { let object = tree; for (const name of path.split("/")) { const entry = trees[object].entries.find(entry => entry.name === name); assert(entry); object = entry.object; } return object; }
function compose(tree, prefix, overrides) {
  const chunks = trees[tree].entries.map(entry => { const path = prefix + entry.name; const object = overrides[path] ?? (entry.type === "tree" && Object.keys(overrides).some(key => key.startsWith(path + "/")) ? compose(entry.object, path + "/", overrides) : entry.object); return Buffer.concat([Buffer.from(`${entry.mode.replace(/^0+/, "")} ${entry.name}\0`), Buffer.from(object, "hex")]); });
  return objectHash("tree", Buffer.concat(chunks));
}
check("V03-raw-commit-tree-reachable265-source", () => {
  for (const [id, entry] of Object.entries(reconstruction.commits)) { assert.equal(objectHash("commit", Buffer.from(entry.raw)), id); assert.equal(/^tree ([a-f0-9]{40})$/m.exec(entry.raw)[1], entry.tree); }
  for (const [id, entry] of Object.entries(trees)) { const raw = Buffer.from(entry.rawBase64, "base64"); assert.equal(objectHash("tree", raw), id); const encoded = Buffer.concat(entry.entries.map(value => Buffer.concat([Buffer.from(`${value.mode.replace(/^0+/, "")} ${value.name}\0`), Buffer.from(value.object, "hex")]))); assert.deepEqual(raw, encoded); }
  assert.equal(reconstruction.selected.length, 265);
  for (const entry of reconstruction.selected) { assert.equal(sha256(entry.text), entry.sha256); assert.equal(objectHash("blob", Buffer.from(entry.text)), entry.blob); assert.equal(reach(reconstruction.commits[entry.commit].tree, entry.path), entry.blob); assert.deepEqual(binding.source.find(value => value.path === entry.path), Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "text"))); }
});
check("V04-exact-mathematical-base-and-two-overrides", () => {
  const baseOverrides = { ...reconstruction.overrides, "src/shell/runtime.ts": prerequisite.runtime.blob }; delete baseOverrides["src/shell/shell.ts"];
  assert.equal(reach(reconstruction.commits[binding.baseLET].tree, "src/shell/runtime.ts"), prerequisite.runtime.blob);
  assert.equal(compose(reconstruction.baselineTree, "", baseOverrides), binding.baseComposedTree); assert.equal(compose(reconstruction.baselineTree, "", reconstruction.overrides), result.candidateComposedTree);
  const differences = binding.source.filter(entry => entry.blob !== (baseOverrides[entry.path] ?? reach(reconstruction.baselineTree, entry.path))).map(entry => entry.path).sort(); assert.deepEqual(differences, ["src/shell/runtime.ts", "src/shell/shell.ts"]);
});
const records = decodeEvidence(unpack(resolve(root, compact.path)));
const original = unpack(resolve(root, "ORIGINAL-RAW-v1.json.gz.base64"));
check("V05-all1247-original-raw-bytes", () => { assert.equal(original.files.length, 1247); for (const entry of original.files) { const bytes = Buffer.from(entry.base64, "base64"); assert.equal(sha256(bytes), entry.sha256); records.set("raw-v1/" + entry.name, bytes.toString()); } });
check("V06-all1124-new-raw-config-bytes", () => { assert.equal(compact.files, 1124); assert.equal(records.size, 2371); });
const raw = path => { assert(records.has(path), "missing raw: " + path); return JSON.parse(records.get(path)); };
const build = raw("raw-v1/BUILD-STATE.json");
check("V07-independent-full846-package-members", () => {
  const packed = Buffer.from(readFileSync(resolve(root, "PACKAGE-v1.tgz.base64"), "utf8"), "base64"); assert.equal(sha256(packed), result.package.sha256); assert.equal(result.package.sha256, binding.expectedAuthorPackageSha256);
  const tar = gunzipSync(packed), files = {}; let offset = 0;
  while (offset + 512 <= tar.length) { const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break; const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, ""); const name = field(0, 100), type = field(156, 1), bytes = Number.parseInt(field(124, 12).trim() || "0", 8), mode = Number.parseInt(field(100, 8).trim() || "0", 8) & 0o777; assert(["", "0"].includes(type), "unexpected tar entry type"); assert(name.startsWith("package/") && !name.includes("..")); const path = name.slice(8); assert(!files[path]); files[path] = { bytes, mode, sha256: sha256(tar.subarray(offset + 512, offset + 512 + bytes)) }; offset += 512 + Math.ceil(bytes / 512) * 512; }
  assert.equal(Object.keys(files).length, 846); assert.deepEqual(files, build.packageInventory.files);
});
function natural(record) { assert(record.natural && record.closed && !record.timedOut && !record.overflow && !record.leak && record.signal === null); }
function loadReceipt(entry, version) {
  const admissionPath = `work-${version}/${entry.layout}-${entry.id}-admission.json`, admission = raw(admissionPath); assert.equal(sha256(records.get(admissionPath)), entry.admissionSha256);
  const tracePath = admission.tracePath.slice(root.length + 1), text = records.get(tracePath); assert.equal(sha256(text), entry.traceSha256);
  const loads = text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => event.event === "load");
  for (const load of loads) assert.equal(load.sha256, admission.files[load.path].sha256);
  assert.equal(new Set(loads.filter(load => admission.productRoots.some(path => load.path.startsWith(path + "/"))).map(load => load.path)).size, 207);
}
check("V08-original414-actual-layout-receipts", () => { const rows = raw("raw-v1/CASES-RESULTS.json"); assert.equal(rows.length, 414); for (const layout of ["source", "installed", "moved"]) { assert.equal(rows.filter(row => row.layout === layout && row.kind === "pass").length, 111); assert.equal(rows.filter(row => row.layout === layout && row.kind === "assertion-failure").length, 27); } for (const entry of rows) { assert(entry.natural && entry.intact); loadReceipt(entry, "v1"); } });
check("V09-versioned84-receipts-no-S13-rescore", () => { const rows = raw("raw-v2/CASES-RESULTS.json"); assert.equal(rows.length, 84); for (const entry of rows) { assert(entry.natural && entry.intact && entry.kind === "pass"); loadReceipt(entry, "v2"); } assert.equal(result.dispositions.filter(row => row.id === "S13").length, 1); });
check("V10-strict30-types-diagnostics-inversions", () => { const results = raw("type-results-v2/RESULTS.json").results; assert.equal(results.length, 30); for (const entry of results) { assert.equal(entry.status, "pass"); const record = raw(`type-results-v2/${entry.layout}-${entry.id}.json`); natural(record); assert.equal(record.code, entry.id === "positive" ? 0 : 2); assert(!record.stdout.includes("TS2307")); assert.equal((record.stdout.match(/error TS\d+/g) ?? []).length, entry.id === "positive" ? 0 : entry.id === "negative" ? 8 : 7); } });
check("V11-sixteen-valid-mechanisms-twelve-kills", () => { const rows = raw("mechanism-results-v1/RESULTS.json").results; assert.equal(rows.length, 16); assert.equal(rows.filter(row => row.status === "semantic-killed").length, 12); for (const row of rows) { assert.equal(row.baseline.report.kind, "pass"); assert(row.baseline.natural && row.execution.natural); assert.notEqual(row.baseline.runtimeSha256, row.execution.runtimeSha256); assert.equal(row.baseline.loadedProductModules, 207); assert.equal(row.execution.loadedProductModules, 207); const build = raw(`mechanism-results-v1/${row.id}-build-raw.json`); natural(build); assert.equal(build.code, 0); } assert.deepEqual(rows.filter(row => row.status !== "semantic-killed").map(row => row.id), ["U08", "U10", "U11", "U15"]); });
check("V12-six-import-families-with20-actual-imports", () => { const rows = raw("import-results-v2/RESULTS.json").results; assert.equal(rows.length, 22); for (const row of rows.filter(row => row.id)) { const record = raw(`import-results-v2/${row.id}-raw.json`); natural(record); assert(record.stdout.startsWith("IMPORT_ATTEMPT\n")); if (row.layout === "moved") assert(row.originalConsumerAbsent); } const typed = raw("import-results-v2/Q06-raw.json"); natural(typed); assert.match(typed.stdout, /TS2307/); });
check("V13-regression-failures-retained-and196-distinct-passes", () => { for (const [path, count] of [["regression-results-v2/shell-getopts-invoke-owned-result.json", 142], ["regression-results-v3/getopts-state-reachable-data-v3-result.json", 33], ["regression-results-v4/getopts-N08-data-v4-result.json", 1], ["regression-results-v2/selected-cd-seams-result.json", 17]]) assert.equal(raw(path).counts.pass, count); assert.equal(raw("regression-results-v2/selected-let-three-result.json").letRows.filter(row => row.status === "pass").length, 3); assert.equal(raw("regression-results-v2/shell-getopts-invoke-owned-result.json").counts.fail, 1); assert.equal(raw("regression-results-v3/getopts-state-reachable-data-v3-result.json").counts.fail, 1); for (const [path, text] of records) if (/regression-results-v\d\/.*-raw\.json$/.test(path)) natural(JSON.parse(text)); });
check("V14-twentyfour-pinned-source-only-proof-anchors", () => { const proofs = json("SOURCE-PROOFS-v1.json").proofs; assert.equal(proofs.length, 24); for (const proof of proofs) { assert.equal(proof.role, "pinned-source-proof-not-runtime-measurement"); for (const anchor of proof.anchors) { const text = reconstruction.selected.find(entry => entry.path === anchor.path).text.split("\n").slice(anchor.startLine - 1, anchor.endLine).join("\n") + "\n"; assert.equal(sha256(text), anchor.sha256); } } assert.equal(json("SOURCE-AUDIT-v2.json").unchangedExistingCount, 56); });
check("V15-frozen138-dispositions-and77-defaults", () => { const cases = json("../freeze-v1/cases.json").cases; assert.deepEqual(result.dispositions.map(row => row.id), cases.map(row => row.id)); for (const layout of ["source", "installed", "moved"]) { const values = result.dispositions.map(row => row.layouts[layout].status); assert.equal(values.filter(value => value === "qualified-public-and-source-pass").length, 136); assert.equal(values.filter(value => value.startsWith("partial-public")).length, 1); assert.equal(values.filter(value => value.startsWith("original-fixture")).length, 1); } assert.equal(json("INVENTORY-v1.json").defaultNames.length, 77); });
const scratch = unpack(resolve(root, "SCRATCH-CENSUS-v1.json.gz.base64"));
check("V16-complete-raw-archive-before-scratch-cleanup", () => { for (const [path, text] of records) { const [directory, ...tail] = path.split("/"); assert.equal(scratch.inventories[directory][tail.join("/")].sha256, sha256(text)); } });
check("V17-current-authenticated-scratch-or-cleanup", () => { if (preclean) { for (const [name, inventory] of Object.entries(scratch.inventories)) assert.deepEqual(census(resolve(root, name)), inventory); } else { const receipt = json("CLEANUP-v1.json"); assert.deepEqual(receipt.removed, manifest.scratchNames); for (const name of receipt.removed) assert(!existsSync(resolve(root, name))); assert.equal(receipt.censusSha256, sha256(readFileSync(resolve(root, "SCRATCH-CENSUS-v1.json.gz.base64")))); } });
check("V18-final-append-aware-owned-membership", () => { if (!preclean) { committed("FINAL-SEAL-v1.json"); const seal = json("FINAL-SEAL-v1.json"), actual = census(root); delete actual["FINAL-SEAL-v1.json"]; assert.deepEqual(actual, seal.entries); const names = git(["ls-tree", "-r", "--name-only", commit, "--", prefix]).toString().trim().split("\n").map(path => path.slice(prefix.length)).sort(); assert.deepEqual(names, [...Object.keys(seal.entries).filter(path => seal.entries[path].kind === "file"), "FINAL-SEAL-v1.json"].sort()); for (const path of names) committed(path); } });
process.stdout.write(JSON.stringify({ status: "static-only-pass", at: new Date().toISOString(), mode: preclean ? "preclean" : "final", commit, groups: groups.length, checks: groups, immutablePriorFiles: 49, originalRawFiles: 1247, newRawFilesAndConfigs: 1124, sourceInputs: 265, packageMembers: 846, candidateComposedTree: result.candidateComposedTree, productExecutionByVerifier: 0, qualifications: result.limitations }, null, 2) + "\n");
