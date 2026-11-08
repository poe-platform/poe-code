import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entries, fileHash, guard, inventory, json, materialize, sha256 } from "./core.mjs";
import { reconstruct } from "./reconstruct.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");
guard(process.argv.length === 3, "CLI", "controls-extra.mjs NEW_OUTPUT_DIRECTORY");
const output = resolve(process.argv[2]);
mkdirSync(output);
const scratch = mkdtempSync(join(tmpdir(), "html-admission-v2-extra-"));
const bindingBytes = readFileSync(join(here, "binding-04/BINDINGS.json"));
guard(sha256(bindingBytes) === "7df791cf7c7c0010af85726af9d9e78dcdebbdaff0c182fb9670be6e29b8989a", "BINDING_HASH");
const binding = JSON.parse(bindingBytes), tree = entries(repository, binding.candidate);
json(join(output, "PRE.json"), { at: new Date().toISOString(), scratch, codeAndCaptures: inventory(here), nodeSha256: fileHash(process.execPath), gitSha256: fileHash("/usr/bin/git"), scope: "actual materialize/reconstruct boundary calls; no compiler/npm/product runtime" });
const rows = [];
async function negative(name, expectedBoundary, operation) {
  const row = { name, expectedBoundary, started: new Date().toISOString() };
  try { await operation(); row.status = "fail"; row.reason = "did not reject"; }
  catch (error) {
    row.error = { message: error.message, code: error.code, stack: error.stack, process: error.process };
    row.status = error.code === expectedBoundary ? "pass" : "fail";
  }
  row.finished = new Date().toISOString();
  rows.push(row);
  json(join(output, `${name}.json`), row);
}
await negative("actual-materialize-content-hash", "STREAM_HASH", async () => {
  const inputs = structuredClone(binding.inputs);
  inputs[0].sha256 = "0".repeat(64);
  await materialize(repository, join(scratch, "wrong-hash"), tree, binding.links, inputs);
});
await negative("actual-materialize-mode-before-acquisition", "INPUT_MODE", async () => {
  const badTree = structuredClone(tree);
  badTree.find(entry => entry.path === binding.inputs[0].path).mode = "100755";
  const destination = join(scratch, "wrong-mode");
  try { await materialize(repository, destination, badTree, binding.links, binding.inputs); }
  finally { assert.equal(existsSync(destination), false); }
});
await negative("actual-materialize-unknown-link-before-acquisition", "UNKNOWN_LINK", async () => {
  const badTree = [...tree, { mode: "120000", type: "blob", path: "tests/unlisted-link", blob: Object.values(binding.links)[0].gitBlob }];
  const destination = join(scratch, "unknown-link");
  try { await materialize(repository, destination, badTree, binding.links, binding.inputs); }
  finally { assert.equal(existsSync(destination), false); }
});
await negative("raw-commit-corruption-before-object-import", "COMMIT_BODY", async () => {
  const rawDirectory = join(scratch, "corrupt-commit"); mkdirSync(rawDirectory);
  const bytes = readFileSync(join(here, "binding-04/candidate.commit.raw"));
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(join(rawDirectory, "candidate.commit.raw"), bytes, { flag: "wx" });
  const database = join(scratch, "never-initialized.git");
  try { await reconstruct(repository, binding, rawDirectory, output, database, join(scratch, "absent-inputs")); }
  finally { assert.equal(existsSync(database), false); }
});
const summary = { controls: rows.length, passed: rows.filter(row => row.status === "pass").length, failed: rows.filter(row => row.status === "fail").length, candidateRuntimeCasesExecuted: 0, compilerNpmExecuted: false, raw: inventory(output) };
json(join(output, "SUMMARY.json"), summary);
console.log(JSON.stringify({ controls: summary.controls, passed: summary.passed, failed: summary.failed }));
process.exitCode = summary.failed ? 1 : 0;
