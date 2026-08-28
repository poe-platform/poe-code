import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { census, checkFile, sha256 } from "./integrity-v1.mjs";
const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../.."), prefix = root.slice(repository.length + 1) + "/";
const cleanup = process.argv[2] === "--cleanup", commit = process.argv[cleanup ? 3 : 2]; assert.match(commit ?? "", /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const json = path => JSON.parse(readFileSync(resolve(root, path)));
const binding = json("BINDING-v1.json"), manifest = json("EVIDENCE-MANIFEST-v1.json"), result = json("RESULTS-v1.json");
const checks = [];
function check(name, body) { body(); checks.push(name); }
function committed(path) { assert.deepEqual(readFileSync(resolve(root, path)), git(["show", commit + ":" + prefix + path])); }
check("V01-prior143-immutable-append-aware", () => {
  const found = [];
  function walk(path) { for (const name of readdirSync(path).sort()) { const absolute = resolve(path, name); if (absolute === root) continue; const stat = lstatSync(absolute); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(absolute); else { assert(stat.isFile()); found.push(absolute.slice(repository.length + 1)); } } }
  walk(resolve(root, "..")); assert.deepEqual(found.sort(), binding.immutableFiles.map(entry => entry.path).sort()); assert.equal(found.length, 143);
  for (const entry of binding.immutableFiles) checkFile(resolve(repository, entry.path), { ...entry, mode: Number.parseInt(entry.mode, 8) & 0o777 });
});
let evidence;
check("V02-sealed-complete27-raw-records", () => { committed("EVIDENCE-MANIFEST-v1.json"); committed("verify-v1.mjs"); const bytes = readFileSync(resolve(root, manifest.path)); assert.equal(bytes.length, manifest.bytes); assert.equal(sha256(bytes), manifest.sha256); evidence = JSON.parse(gunzipSync(Buffer.from(bytes.toString(), "base64"))); assert.equal(evidence.files.length, 27); for (const entry of evidence.files) { assert.equal(sha256(entry.text), entry.sha256); assert.equal(evidence.scratch["raw-v1"][entry.path].sha256, entry.sha256); } });
const rawText = path => { const entry = evidence.files.find(entry => entry.path === path); assert(entry, path); return entry.text; };
const raw = path => JSON.parse(rawText(path));
check("V03-six-public-contrasts-raw-before-assertion", () => {
  const rows = raw("RESULTS.json").results; assert.equal(rows.length, 6); assert.equal(result.pass, 6); assert.equal(result.assertionFailures, 0);
  for (const row of rows) {
    assert.equal(row.kind, "pass"); assert(row.natural && row.intact); const record = raw(row.layout + "-" + row.id + "-raw.json"); assert(record.natural && record.closed && !record.leak && !record.timedOut && !record.overflow && record.signal === null); const lines = record.stdout.trim().split("\n").map(line => JSON.parse(line)); assert.equal(lines.at(-2).kind, "observation"); assert.equal(lines.at(-1).kind, "pass");
    const observed = row.observation; assert.equal(observed.lookupCalls.length, 1); assert.equal(observed.lookupCalls[0].path, "/a"); assert.equal(observed.outerCleanupCalls, 1); assert(observed.lookupNaturallyDrained && observed.disposed); assert.equal(observed.siblingDuring.text, "/c\n/a\n"); assert.equal(observed.parentAfterChild.text, "/c\n/a\n");
    if (row.id === "C06-M") { assert.equal(observed.exec.kind, "return"); assert.equal(observed.exec.value.exitCode, 1); assert.equal(observed.exec.value.stderr, "shell: line 2: false\n"); assert.equal(observed.afterFull.text, "/c\n/a\n"); assert.equal(observed.rootAborted, false); }
    else { assert.equal(row.id, "C06-R"); assert.equal(observed.exec.kind, "throw"); assert.equal(observed.exec.reason, false); assert.equal(observed.afterEntered, false); assert.equal(observed.rootAborted, true); assert.equal(observed.settledAfterRootBeforeCleanup, false); }
  }
});
check("V04-authenticated-source-installed-moved-loads", () => {
  for (const row of raw("RESULTS.json").results) { const stem = row.layout + "-" + row.id, admission = raw(stem + "-admission.json"), traceText = rawText(stem + "-loads.jsonl"); assert.equal(sha256(rawText(stem + "-admission.json")), row.admissionSha256); assert.equal(sha256(traceText), row.traceSha256); const loads = traceText.trim().split("\n").map(line => JSON.parse(line)).filter(entry => entry.event === "load"); for (const entry of loads) assert.equal(entry.sha256, admission.files[entry.path].sha256); const product = loads.filter(entry => entry.path.startsWith(admission.productRoot + "/")); assert.equal(new Set(product.map(entry => entry.path)).size, 207); if (row.layout === "moved") assert(row.originalConsumerAbsent); }
});
check("V05-full846-package-and265-source-identity", () => { const inputs = raw("INPUTS.json"); assert.equal(inputs.packageSha256, binding.packageSha256); assert.equal(Object.keys(inputs.packageFiles).length, 846); for (const [path, metadata] of Object.entries(inputs.packageFiles)) assert.deepEqual(inputs.consumer["node_modules/virtual-bash/" + path], { kind: "file", ...metadata }); const mainBinding = JSON.parse(readFileSync(resolve(root, "../review-3e4cd743/BINDING-v1.json"))); assert.equal(mainBinding.source.length, 265); for (const entry of mainBinding.source) { const metadata = inputs.source[entry.path]; assert.equal(metadata.sha256, entry.sha256); assert.equal(metadata.mode, Number.parseInt(entry.mode, 8) & 0o777); } assert.equal(result.oldCohortsReexecuted, 0); });
check("V06-six-pinned-source-proof-spans-not-runtime-proof", () => { const anchors = json("PROOF-ANCHORS-v1.json").anchors; assert.equal(anchors.length, 6); for (const entry of anchors) { const bytes = git(["show", entry.commit + ":" + entry.path]); assert.equal(sha256(bytes), entry.fileSha256); const text = bytes.toString().split("\n").slice(entry.startLine - 1, entry.endLine).join("\n") + "\n"; assert.equal(text, entry.text); assert.equal(sha256(text), entry.spanSha256); } assert(result.originalC06.startsWith("partial;")); });
check("V07-authenticated-enumerated-scratch-custody", () => {
  if (cleanup) {
    assert(!existsSync(resolve(root, "CLEANUP-v1.json")) && !existsSync(resolve(root, "PRECLEAN-STATIC-v1.json")));
    for (const name of manifest.scratch) { assert(["raw-v1", "work-v1"].includes(name)); assert.deepEqual(census(resolve(root, name)), evidence.scratch[name]); }
  } else { const receipt = json("CLEANUP-v1.json"); assert.deepEqual(receipt.removed, ["raw-v1", "work-v1"]); assert.equal(receipt.evidenceSha256, manifest.sha256); for (const name of receipt.removed) assert(!existsSync(resolve(root, name))); }
});
if (!cleanup) check("V08-final-owned-append-aware-seal", () => { committed("FINAL-SEAL-v1.json"); const seal = json("FINAL-SEAL-v1.json"), actual = census(root); delete actual["FINAL-SEAL-v1.json"]; assert.deepEqual(actual, seal.entries); const names = git(["ls-tree", "-r", "--name-only", commit, "--", prefix]).toString().trim().split("\n").map(path => path.slice(prefix.length)).sort(); assert.deepEqual(names, [...Object.keys(seal.entries).filter(path => seal.entries[path].kind === "file"), "FINAL-SEAL-v1.json"].sort()); for (const name of names) committed(name); });
const report = { status: "static-only-pass", at: new Date().toISOString(), commit, mode: cleanup ? "precleanup" : "final", checks, groups: checks.length, immutablePriorFiles: 143, rawRecords: 27, productExecutionByVerifier: 0, originalC06: result.originalC06 };
if (cleanup) {
  for (const name of manifest.scratch) { assert.deepEqual(census(resolve(root, name)), evidence.scratch[name]); rmSync(resolve(root, name), { recursive: true }); assert(!existsSync(resolve(root, name))); }
  const receipt = { version: 1, at: new Date().toISOString(), archiveCommit: commit, evidenceSha256: manifest.sha256, removed: manifest.scratch, method: "full regular file/directory bytes/modes/membership matched immediately before deletion, only explicit owned two paths; complete raw archived first", noProductExecution: true };
  const additions = { "PRECLEAN-STATIC-v1.json": report, "CLEANUP-v1.json": receipt };
  execFileSync("apply_patch", [], { input: "*** Begin Patch\n" + Object.entries(additions).map(([name, value]) => "*** Add File: " + resolve(root, name) + "\n" + JSON.stringify(value, null, 2).split("\n").map(line => "+" + line).join("\n") + "\n").join("") + "*** End Patch\n" });
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
