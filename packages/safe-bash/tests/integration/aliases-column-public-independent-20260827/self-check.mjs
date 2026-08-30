import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { families, nestedOption, specifiers, validateDeclaration } from "./contract.mjs";

const fixture = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
assert.equal(fixture.baselineNames.length, 70);
assert.equal(new Set([...fixture.baselineNames, ...fixture.addedNames]).size, 73);
assert.deepEqual(fixture.addedNames, ["egrep", "fgrep", "column"]);
assert.equal(fixture.cases.length, 21);
assert.equal(new Set(fixture.cases.map(entry => entry.id)).size, 21);
for (const entry of fixture.cases) {
  for (const name of ["id", "script", "stdin", "stdout", "stderr"]) assert.equal(typeof entry[name], "string");
  assert.ok([0, 1, 2].includes(entry.exitCode));
}
const synthetic = {
  candidateCommit: "a".repeat(40), fixtureCommit: "b".repeat(40), declaredBy: "SCHEMA SELF-CHECK ONLY; not a real integration declaration",
  surfaces: { aliases: { root: true, subpath: null }, column: { root: true, subpath: null } },
  agentOptions: { regex: ["exampleRegex"], column: ["exampleColumn"] },
  packageExports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
};
validateDeclaration(synthetic);
let rejected = 0;
for (const mutate of [
  value => { value.candidateCommit = "HEAD"; },
  value => { delete value.fixtureCommit; },
  value => { value.skipCases = true; },
  value => { value.expectedCount = 70; },
  value => { value.surfaces.aliases = { root: false, subpath: null }; },
  value => { value.surfaces.column.subpath = "../src/column.ts"; },
  value => { value.surfaces.column.subpath = "virtual-bash/commands/undeclared"; },
  value => { value.agentOptions.regex = []; },
  value => { value.agentOptions.regex = ["constructor"]; },
  value => { value.packageExports = {}; },
  value => { value.declaredBy = ""; },
  value => { value.surfaces.aliases = { root: false, subpath: "virtual-bash/aliases" }; value.packageExports["./aliases"] = "./dist/aliases.js"; },
  value => { value.packageExports["."] = null; },
  value => { value.packageExports["."] = false; },
  value => { value.packageExports["."] = ""; },
  value => { value.packageExports["."] = {}; },
  value => { value.packageExports["."] = []; },
  value => { value.packageExports["."] = "../outside.js"; },
  value => { value.packageExports["."].import = "./../outside.js"; },
  value => { value.packageExports["."].import = false; },
  value => { value.surfaces.column.subpath = "virtual-bash/column"; value.packageExports["./column"] = null; },
  value => { value.surfaces.column.subpath = "virtual-bash/column"; value.packageExports["./*"] = "./dist/*.js"; },
]) {
  const changed = structuredClone(synthetic);
  mutate(changed);
  assert.throws(() => validateDeclaration(changed));
  rejected++;
}
assert.deepEqual(nestedOption(["outer", "regex"], { maxWorkers: 1 }), { outer: { regex: { maxWorkers: 1 } } });
assert.deepEqual(specifiers({ mode: "candidate", declaration: synthetic }, "aliases"), ["virtual-bash"]);
assert.equal(Object.values(families).flat().length, 7);
console.log(JSON.stringify({ status: "PASS", fixedDataCases: 21, defaultNames: 73, rejectedManifestMutations: rejected, candidateAcceptance: "NOT RUN" }));
