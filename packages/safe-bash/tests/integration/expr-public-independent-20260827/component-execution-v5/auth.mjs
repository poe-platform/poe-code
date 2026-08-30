import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { directory, repository, owner, legacyDirectory, candidate, read, json, digest, objectHash, inventory, putJson } from "./common.mjs";

export const prior = join(repository, owner, "component-execution-v4");
export const priorCommit = "1ec1912001db43f803af46bb5dea89a7e397b83b";
export const priorRecipe = "8a28b7bffa5ef093cff2374ec32cba4ec4ca83f0";
export const tools = json(join(repository, owner, "component-execution-v3/PINS.json")).tools;
export const inputs = json(join(legacyDirectory, "INPUTS.json"));
export const metadataReceipts = [];
export function git(...args) {
  assert.equal(digest(read(tools[0].path)), tools[0].sha256);
  const started = Date.now();
  const bytes = execFileSync(tools[0].path, ["--no-replace-objects", "--literal-pathspecs", ...args], { cwd: repository, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" }, maxBuffer: 131072, timeout: 15000 });
  metadataReceipts.push({ args, bytes: bytes.length, sha256: digest(bytes), durationMs: Date.now() - started, status: 0, closed: true, naturalSettlement: true });
  return bytes;
}
export function treeEntries(commit, prefix) {
  return git("ls-tree", "-rlz", commit, "--", prefix).toString().split("\0").filter(Boolean).map(line => {
    const [attributes, path] = line.split("\t"), [mode, type, objectId, length] = attributes.trim().split(/\s+/u);
    assert.equal(mode, "100644"); assert.equal(type, "blob"); assert.ok(!path.split("/").includes("AGENTS.md"));
    const bytes = read(join(repository, path)); assert.equal(bytes.length, Number(length)); assert.equal(objectHash(bytes), objectId);
    assert.equal(lstatSync(join(repository, path)).mode & 0o777, 0o644);
    return { commit, path, mode, type, objectId, bytes: bytes.length, sha256: digest(bytes) };
  });
}
export function rawArchive(base, expectedManifest) {
  const manifestBytes = read(join(base, "MANIFEST.json")); assert.equal(digest(manifestBytes), expectedManifest);
  const manifest = JSON.parse(manifestBytes), compressed = Buffer.from(read(join(base, "RAW.json.gz.base64")).toString().trim(), "base64");
  assert.equal(compressed.length, manifest.compressedBytes); assert.equal(digest(compressed), manifest.compressedSha256);
  const payload = gunzipSync(compressed, { maxOutputLength: manifest.payloadBytes });
  assert.equal(payload.length, manifest.payloadBytes); assert.equal(digest(payload), manifest.payloadSha256);
  const entries = JSON.parse(payload).entries;
  assert.deepEqual(entries.map(({ base64, ...row }) => row), manifest.entries);
  for (const row of entries) { const bytes = Buffer.from(row.base64, "base64"); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); }
  return { entries, bytes: name => { const row = entries.find(value => value.path === name); assert.ok(row, name); return Buffer.from(row.base64, "base64"); } };
}
export function bindAcceptedProof() {
  assert.equal(digest(read(join(prior, "RECIPE-SEAL.json"))), "71ec5ec3a8b27cdcb0e3c6bfa27eec9b4d12396022f76d950c5b38ee9a2e1179");
  assert.equal(digest(read(join(prior, "EVIDENCE-SEAL.json"))), "23678ecd1f6a8767b529ea85d72cf04ad2b9ba21437ca0ab1771ee99a5c997f4");
  for (const row of [...json(join(prior, "RECIPE-SEAL.json")).entries, ...json(join(prior, "EVIDENCE-SEAL.json")).artifacts]) {
    const path = join(prior, row.path), bytes = read(path);
    assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); assert.equal(lstatSync(path).mode & 0o777, row.mode);
  }
  const raw = rawArchive(prior, "5baf947732e17db0e61d734de5c8bde3acfbe5daa14d634539dd1ecea4de7eb4");
  const previous = join(repository, owner, "component-execution-v3");
  rawArchive(previous, "f2344a8bac78bf32599ba78b73eafa98e8102cf53976e5628b3d9bbf1b2af5c3");
  assert.equal(json(join(previous, "ADMISSION.json")).controls.pass, 16);
  const report = json(join(prior, "REPORT.json")), admission = json(join(prior, "ADMISSION.json")), repair = json(join(prior, "REPAIR-CONTROLS.json"));
  assert.equal(report.P01.status, "pass"); assert.equal(report.P01.buildExecuted, true); assert.equal(report.P01.independentInputs, 357);
  assert.equal(admission.selected.count, 357); assert.equal(admission.selected.authenticatedEveryBlob, true); assert.equal(admission.allChildrenClosed, true);
  assert.equal(repair.status, "qualified"); assert.equal(repair.pass, 28); assert.equal(repair.planned, 28);
  assert.equal(json(join(prior, "FINALIZATION.json")).status, "pass");
  for (const name of ["P01-build.json", "P01-pack.json"]) { const receipt = JSON.parse(raw.bytes(name)); assert.equal(receipt.status, 0); assert.equal(receipt.naturalSettlement, true); assert.equal(receipt.closed, true); }
  const packBytes = Buffer.from(raw.bytes("independent-pack.tgz.base64").toString().trim(), "base64");
  assert.equal(packBytes.length, 727526); assert.equal(digest(packBytes), "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd");
  assert.deepEqual(inventory(join(report.executionDirectory, "build")), JSON.parse(raw.bytes("build-complete-after.json")));
  assert.deepEqual(inventory(join(report.executionDirectory, "tools")), JSON.parse(raw.bytes("tools-before.json")));
  assert.equal(git("rev-parse", `${candidate}^{tree}`).toString().trim(), "5905cf8d43233c68ea2bd499275ada2641223d9a");
  assert.equal(json(join(repository, "tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json")).integrationSourceCommit, "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e");
  assert.equal(git("cat-file", "-t", "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e").toString().trim(), "commit");
  const selected = git("ls-tree", "-rlz", candidate, "--", ...inputs.selected.map(row => row.path)).toString().split("\0").filter(Boolean);
  assert.equal(selected.length, 357);
  for (const line of selected) {
    const [attributes, path] = line.split("\t"), [mode, type, objectId, length] = attributes.trim().split(/\s+/u), entry = inputs.selected.find(row => row.path === path);
    assert.ok(entry); assert.equal(mode, entry.mode); assert.equal(type, entry.type); assert.equal(objectId, entry.gitBlob);
    const bytes = read(join(report.executionDirectory, "build", path)); assert.equal(bytes.length, Number(length)); assert.equal(objectHash(bytes), objectId); assert.equal(digest(bytes), entry.sha256);
  }
  return { packBytes, P01: { status: "BOUND_ACCEPTED_PROOF", accepted: true, independentlyBuiltIn: priorCommit, recipe: priorRecipe, buildExecuted: false, packExecuted: false,
    independentInputsBound: 357, actualPackSha256: digest(packBytes), packBytes: packBytes.length, members: 834, manifestSha256: digest(read(join(prior, "MANIFEST.json"))), authorpackFallback: false },
    reader: { status: "qualified-evidence-reused", controls: 16, newControls: 0, evidence: "d3136122f2d1d47f0d0db82d71a4f50593359446", semanticsChanged: false },
    repair: { status: "qualified-evidence-reused", pass: 28, planned: 28, newControls: 0, evidence: priorCommit }, rawEntries: raw.entries.length };
}
export function plannedLayouts(packMembers) {
  const bytes = read(join(legacyDirectory, "LAYOUTS.json")); assert.equal(bytes.length, 4644868);
  const remap = value => value.replaceAll(legacyDirectory, directory), layouts = JSON.parse(bytes);
  for (const layout of layouts.layouts) {
    layout.consumer = remap(layout.consumer);
    layout.expected = Object.fromEntries(Object.entries(layout.expected).map(([path, hash]) => [remap(path), hash]));
    if (layout.forbiddenSource) {
      layout.forbiddenSource = remap(layout.forbiddenSource);
      layout.expected[join(layout.consumer, "node_modules/virtual-bash/dist/index.js")] = digest(packMembers.find(row => row.path === "dist/index.js").bytes.toString() + `\nimport ${JSON.stringify(layout.forbiddenSource)};\n`);
    }
    layout.expectedSha256 = digest(JSON.stringify(layout.expected));
  }
  return layouts;
}
export function authenticate(commit, phase) {
  const pins = json(join(directory, "PINS.json")), seal = json(join(directory, "RECIPE-SEAL.json"));
  for (const row of tools) { assert.equal(digest(read(row.path)), row.sha256); assert.equal(lstatSync(row.path).mode & 0o777, row.mode); }
  for (const group of pins.history) {
    assert.deepEqual(treeEntries(group.commit, group.prefix), group.entries);
    assert.deepEqual(readdirSync(join(repository, group.prefix)).filter(name => name !== "work").sort(), group.entries.map(row => row.path.slice(group.prefix.length + 1)).sort());
  }
  for (const row of pins.bindings) {
    const bytes = read(join(repository, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); assert.equal(objectHash(bytes), row.objectId); assert.equal(lstatSync(join(repository, row.path)).mode & 0o777, 0o644);
    const listing = git("ls-tree", row.commit, "--", row.path).toString(); assert.ok(listing.includes(`100644 blob ${row.objectId}\t${row.path}`));
  }
  for (const row of seal.entries) {
    const path = join(directory, row.path); assert.equal(digest(read(path)), row.sha256); assert.equal(read(path).length, row.bytes); assert.equal(lstatSync(path).mode & 0o777, row.mode);
    assert.ok(git("ls-tree", commit, "--", `${owner}/component-execution-v5/${row.path}`).toString().includes(objectHash(read(path))));
  }
  assert.ok(git("ls-tree", commit, "--", `${owner}/component-execution-v5/RECIPE-SEAL.json`).toString().includes(objectHash(read(join(directory, "RECIPE-SEAL.json")))));
  const allowed = [...seal.entries.map(row => row.path), "RECIPE-SEAL.json", ...pins.generatedTopLevel].sort();
  for (const name of readdirSync(directory)) assert.ok(allowed.includes(name), `undeclared v5 top-level entry ${name}`);
  for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
  assert.deepEqual(inventory(join(repository, owner, "component-admission-v1")), inputs.admissionFiles);
  const proof = bindAcceptedProof();
  putJson(join(directory, `${phase}-BINDINGS.json`), { status: "pass", phase, commit, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), P01: proof.P01, reader: proof.reader, repair: proof.repair,
    historyGroups: pins.history.length, originalAndHandoffBindings: pins.bindings.length, sourceToolInputModeHashAndNewEntriesChecked: true, metadataChildren: metadataReceipts.length, metadataReceipts: [...metadataReceipts] });
  return proof;
}
