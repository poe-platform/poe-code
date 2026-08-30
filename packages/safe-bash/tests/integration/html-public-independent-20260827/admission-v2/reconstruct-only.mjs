import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entries, fileHash, git, guard, inventory, json, materialize, sha256, validateLinkBytes } from "./core.mjs";
import { reconstruct } from "./reconstruct.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");
guard(process.argv.length === 5, "CLI", "reconstruct-only.mjs BINDINGS.json SHA256 NEW_OUTPUT_DIRECTORY");
const bindingPath = resolve(process.argv[2]), bytes = readFileSync(bindingPath);
guard(sha256(bytes) === process.argv[3], "BINDING_HASH");
const binding = JSON.parse(bytes), output = resolve(process.argv[4]);
mkdirSync(output);
const scratch = mkdtempSync(join(tmpdir(), "html-admission-v2-reconstruct-"));
json(join(output, "PRE.json"), { at: new Date().toISOString(), argv: process.argv, scratch, codeAndCaptures: inventory(here), nodeSha256: fileHash(process.execPath), gitSha256: fileHash("/usr/bin/git"), sources: { parent: binding.durability.parent, author: binding.author }, policy: "No candidate commit/tree reads from source repository. Construct metadata from reachable parent plus exact author-bound delta. No compiler/npm/runtime." });
try {
  git(repository, ["merge-base", "--is-ancestor", binding.durability.parent, binding.author]);
  const tree = entries(repository, binding.durability.parent);
  const parentEntries = new Map(tree.map(entry => [entry.path, { ...entry }]));
  for (const delta of binding.durability.delta) {
    const source = entries(repository, binding.author, [delta.path]);
    guard(source.length === 1 && source[0].blob === delta.blob && source[0].mode === delta.mode, "AUTHOR_DELTA", delta.path);
    const existing = tree.find(entry => entry.path === delta.path);
    guard(existing !== undefined, "DELTA_PATH_MISSING", delta.path);
    Object.assign(existing, source[0]);
  }
  guard(sha256(JSON.stringify(tree)) === binding.fullTree.sha256, "RECONSTRUCTED_METADATA");
  const provenance = [];
  for (const entry of binding.inputs) {
    const sourceCommit = parentEntries.get(entry.path)?.blob === entry.blob ? binding.durability.parent : binding.author;
    const source = entries(repository, sourceCommit, [entry.path]);
    assert.equal(source[0]?.blob, entry.blob);
    assert.equal(source[0]?.mode, entry.mode);
    provenance.push({ path: entry.path, sourceCommit, blob: entry.blob, mode: entry.mode, sha256: entry.sha256 });
  }
  for (const entry of tree.filter(entry => entry.mode === "120000")) validateLinkBytes(entry, binding.links[entry.path], git(repository, ["cat-file", "blob", entry.blob]));
  const build = join(scratch, "inputs");
  const materialized = await materialize(repository, build, tree, binding.links, binding.inputs);
  json(join(output, "REACHABLE-INPUTS.json"), { materialized, provenance, candidateSourceCommitRead: false });
  const result = await reconstruct(repository, binding, dirname(bindingPath), output, join(scratch, "isolated.git"), build);
  json(join(output, "RESULT.json"), { status: "scoped-reconstruction-proof-not-full-clone", ...result, candidateSourceCommitRead: false, compilerNpmRuntimeExecuted: false });
  console.log(JSON.stringify(result));
} catch (error) {
  json(join(output, "FAILURE.json"), { message: error.message, stack: error.stack });
  throw error;
}
