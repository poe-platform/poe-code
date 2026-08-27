import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileHash, git, guard, inventory, json } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");
guard(process.argv.length === 3, "CLI", "postcheck.mjs NEW_OUTPUT_DIRECTORY");
const output = resolve(process.argv[2]);
mkdirSync(output);
json(join(output, "PRE.json"), { at: new Date().toISOString(), codeAndCaptures: inventory(here), node: { path: process.execPath, sha256: fileHash(process.execPath) }, gitSha256: fileHash("/usr/bin/git"), scope: "evidence and retained buildview inspection only; no compiler/npm/product reruns" });
try {
  const binding = JSON.parse(readFileSync(join(here, "binding-04/BINDINGS.json")));
  const controlsPre = JSON.parse(readFileSync(join(here, "controls-01/PRE.json")));
  const admissionPre = JSON.parse(readFileSync(join(here, "admission-01/PRE.json")));
  for (const path of ["core.mjs", "controls.mjs", "stream-fixture.mjs"]) assert.equal(fileHash(join(here, path)), controlsPre.codeAndInputs[path], `executed control source unchanged: ${path}`);
  for (const path of ["core.mjs", "run.mjs", "reconstruct.mjs"]) assert.equal(fileHash(join(here, path)), admissionPre.harnessAndInputs[path], `executed admission source unchanged: ${path}`);
  const report = JSON.parse(readFileSync(join(here, "admission-01/REPORT.json")));
  assert.equal(report.status, "admission-proof-complete-review-pending");
  const modes = [];
  for (const entry of binding.inputs) {
    const filename = join(report.scratch, "build", entry.path), stat = lstatSync(filename);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.mode & 0o777, Number.parseInt(entry.mode.slice(3), 8), entry.path);
    assert.equal(fileHash(filename), entry.sha256, entry.path);
    modes.push({ path: entry.path, gitMode: entry.mode, materializedMode: (stat.mode & 0o777).toString(8), sha256: entry.sha256 });
  }
  const frozen = [];
  for (const entry of binding.fixtures) {
    assert.equal(fileHash(join(repository, entry.path)), entry.sha256);
    const index = git(repository, ["ls-files", "-s", "-z", "--", entry.path]).toString().split("\0").filter(Boolean);
    assert.equal(index.length, 1);
    assert.ok(index[0].startsWith(`${entry.mode} ${entry.blob} 0\t`), entry.path);
    frozen.push({ path: entry.path, mode: entry.mode, blob: entry.blob, sha256: entry.sha256, indexUnchanged: true });
  }
  json(join(output, "RESULT.json"), { status: "implementation-self-check-pass-not-independent-review", at: new Date().toISOString(), authenticatedMaterializedModes: modes.length, modes, frozen18: frozen, executedCoreAndDriversUnchanged: true, runtimeCasesExecuted: 0 });
  console.log(JSON.stringify({ modes: modes.length, frozen: frozen.length, status: "self-check-pass" }));
} catch (error) {
  json(join(output, "FAILURE.json"), { message: error.message, stack: error.stack });
  throw error;
}
