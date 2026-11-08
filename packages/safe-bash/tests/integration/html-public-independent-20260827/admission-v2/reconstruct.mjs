import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { entries, fileHash, git, gitEnv, guard, json, objectId, sha256, streamBlob } from "./core.mjs";

export async function reconstruct(repository, binding, bindingDirectory, output, isolated, buildView) {
  const report = { scope: "thin scoped object database; exact tree and commit reconstruction, NOT full-history clone/fsck/archive availability", imported: [], rebuiltTrees: [], checks: [] };
  const raw = readFileSync(join(bindingDirectory, "candidate.commit.raw"));
  guard(raw.length === binding.durability.rawCommitBytes && sha256(raw) === binding.durability.rawCommitSha256 && objectId("commit", raw) === binding.candidate, "COMMIT_BODY");
  const init = spawnSync("/usr/bin/git", ["init", "--bare", "--template=", "--object-format=sha1", isolated], { env: gitEnv(), encoding: "utf8" });
  report.init = { status: init.status, stdout: init.stdout, stderr: init.stderr, error: init.error?.message };
  guard(init.status === 0 && !init.error, "ISOLATED_INIT");
  function absence(label) {
    const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-C", isolated, "cat-file", "-e", binding.candidate], { env: gitEnv(), encoding: "utf8" });
    guard(result.status === 1 && !result.error && !result.signal, "CANDIDATE_ABSENCE", JSON.stringify({ status: result.status, stderr: result.stderr }));
    report.checks.push({ label, status: result.status, stderr: result.stderr, objectAlternates: "none; no environment alternates; no hardlink/clone/shared object store" });
  }
  absence("empty database candidate absent");
  const imported = new Set();
  function importObject(type, bytes, provenance) {
    const id = objectId(type, bytes);
    if (!imported.has(id)) {
      assert.equal(git(isolated, ["hash-object", "-w", "-t", type, "--stdin"], bytes).toString().trim(), id);
      imported.add(id);
      report.imported.push({ ...provenance, type, id, bytes: bytes.length, sha256: sha256(bytes) });
    }
    return id;
  }
  const base = binding.durability.parent;
  git(repository, ["merge-base", "--is-ancestor", base, binding.author]);
  importObject("commit", git(repository, ["cat-file", "commit", base]), { sourceCommit: base, path: null });
  const baseEntries = new Map(entries(repository, base).map(entry => [entry.path, entry]));
  const trees = new Map();
  function importBaseTree(prefix) {
    if (trees.has(prefix)) return trees.get(prefix);
    const id = git(repository, ["rev-parse", prefix ? `${base}:${prefix}` : `${base}^{tree}`]).toString().trim();
    const bytes = git(repository, ["cat-file", "tree", id]);
    assert.equal(importObject("tree", bytes, { sourceCommit: base, path: prefix }), id);
    trees.set(prefix, id);
    return id;
  }
  importBaseTree("");
  const needed = [...binding.inputs, ...binding.durability.delta];
  for (const entry of needed) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count++) importBaseTree(parts.slice(0, count).join("/"));
    const original = baseEntries.get(entry.path);
    const sourceCommit = original?.blob === entry.blob && original.mode === entry.mode ? base : binding.author;
    const authenticated = entries(repository, sourceCommit, [entry.path]);
    guard(authenticated.length === 1 && authenticated[0].blob === entry.blob && authenticated[0].mode === entry.mode, "RECONSTRUCTION_PROVENANCE", entry.path);
    if (!imported.has(entry.blob)) {
      const filename = join(buildView, entry.path);
      guard(fileHash(filename) === entry.sha256, "RECONSTRUCTION_FILE", entry.path);
      const id = git(isolated, ["hash-object", "-w", "--", filename]).toString().trim();
      guard(id === entry.blob, "RECONSTRUCTION_BLOB", entry.path);
      imported.add(id);
      report.imported.push({ sourceCommit, path: entry.path, type: "blob", id, bytes: statSync(filename).size, sha256: entry.sha256 });
    }
  }
  absence("reachable necessary objects imported; candidate still absent");
  function rebuild(prefix) {
    const baseTree = importBaseTree(prefix);
    const records = git(isolated, ["ls-tree", "-z", baseTree]).toString().split("\0").filter(Boolean).map(line => {
      const separator = line.indexOf("\t");
      const [mode, type, id] = line.slice(0, separator).split(" ");
      return { mode, type, id, name: line.slice(separator + 1) };
    });
    for (const record of records) {
      const path = prefix ? `${prefix}/${record.name}` : record.name;
      const delta = binding.durability.delta.find(entry => entry.path === path);
      if (delta) { record.id = delta.blob; record.mode = delta.mode; }
      else if (binding.durability.delta.some(entry => entry.path.startsWith(`${path}/`))) record.id = rebuild(path);
    }
    const input = records.map(record => `${record.mode} ${record.type} ${record.id}\t${record.name}\0`).join("");
    const id = git(isolated, ["mktree", "--missing", "-z"], input).toString().trim();
    report.rebuiltTrees.push({ prefix, baseTree, id });
    return id;
  }
  report.tree = rebuild("");
  guard(report.tree === binding.tree, "RECONSTRUCTED_TREE");
  absence("exact tree rebuilt; candidate commit still absent");
  report.candidate = importObject("commit", raw, { source: "lossless sealed raw commit body" });
  guard(report.candidate === binding.candidate, "RECONSTRUCTED_COMMIT");
  for (const entry of binding.inputs) {
    guard(git(isolated, ["rev-parse", `${binding.candidate}:${entry.path}`]).toString().trim() === entry.blob, "SCOPED_RECONSTRUCTION", entry.path);
    await streamBlob(isolated, entry);
  }
  report.scopedInputs = binding.inputs.length;
  report.totalImportedBytes = report.imported.reduce((total, entry) => total + entry.bytes, 0);
  report.missingByDesign = "Unneeded historical blob/tree objects and ancestor commit closure are not imported. This thin DB cannot produce the pristine full archive or pass full git fsck. A normal full clone of reachable author9dc supplies full closure; no such full clone was performed. No author reachability refs created in user repository.";
  report.fourteenPathStatus = binding.durability.fourteenPathStatus;
  json(join(output, "RECONSTRUCTION.json"), report);
  return { candidate: report.candidate, tree: report.tree, scopedInputs: report.scopedInputs, importedObjects: imported.size, importedBytes: report.totalImportedBytes, parentDeltaPaths: binding.durability.delta.length, fullClone: false };
}
