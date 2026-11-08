import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository });
const rawSeal = readFileSync(path.join(own, "FREEZE.json"));
const seal = JSON.parse(rawSeal);
for (const [filename, digest] of Object.entries(seal.fixtureHashes)) assert.equal(hash(readFileSync(path.join(own, filename))), digest, filename);
for (const [filename, digest] of Object.entries(seal.sourceHashes)) assert.equal(hash(git("show", `${seal.inspectionRevision}:${filename}`)), digest, filename);
const cases = JSON.parse(readFileSync(path.join(own, "cases.json"), "utf8"));
assert.equal(cases.cases.length, 22);
assert.equal(new Set(cases.cases.map(row => row.id)).size, 22);
assert.equal(cases.expected76.length, 76);
assert.equal(new Set(cases.expected76).size, 76);
assert.deepEqual(cases.expected77, [...cases.expected76, "which"].sort());
assert.equal(new Set(cases.expected77).size, 77);
assert.equal(cases.expected77.filter(name => name === "which").length, 1);
for (const name of seal.excludedDefaults) assert.equal(cases.expected77.includes(name), false);
const sourceExpected = git("show", `${seal.inspectionRevision}:tests/plugins/agent-commands.test.ts`).toString();
const expectedBlock = sourceExpected.match(/const expected = \[([\s\S]*?)\]\.sort\(\);/)[1];
assert.deepEqual([...expectedBlock.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort(), cases.expected76);
const cohort = readFileSync(path.join(own, "cohort.mjs"), "utf8");
const runtimeIds = [...cohort.matchAll(/^test\("(R\d\d) /gm)].map(match => match[1]);
const types = JSON.parse(readFileSync(path.join(own, "types.json"), "utf8"));
assert.equal(runtimeIds.length, 18);
assert.deepEqual([...runtimeIds, ...types.cases.map(row => row.id)], cases.cases.map(row => row.id));
assert.ok(cohort.includes('from "virtual-bash"'));
assert.ok(cohort.includes('from "virtual-bash/commands/which"'));
assert.equal(/from ["'][^"']*(?:\/src\/|\/dist\/)/.test(cohort), false);
assert.equal(types.cases.length, 4);
for (const row of types.cases) {
  assert.ok(row.source.includes("from 'virtual-bash'"));
  assert.equal(row.source.includes("/src/"), false);
  assert.equal(row.source.includes("/dist/"), false);
}
const metadata = JSON.parse(git("show", `${seal.inspectionRevision}:package.json`));
assert.equal(Object.hasOwn(metadata.exports, "./commands/which"), false);
assert.equal(git("show", `${seal.inspectionRevision}:src/index.ts`).toString().includes("commands/which/"), false);
const plugins = git("show", `${seal.inspectionRevision}:src/plugins/index.ts`).toString();
assert.equal(plugins.includes("commands/which/"), false);
assert.equal(/readonly\s+which\s*\??\s*:/.test(plugins), false);
assert.equal(seal.publicCandidate, null);
assert.equal(cases.publicCandidate, null);
for (const key of ["publicExecutionsAtSeal", "typeCompilationsAtSeal", "nativeWhichRuns", "executedNegativeControls"]) assert.equal(seal[key], 0);
const negatives = JSON.parse(readFileSync(path.join(own, "negative-plan.json"), "utf8"));
assert.equal(negatives.controls.length, 8);
console.log(JSON.stringify({ verification: "syntax/schema/hash preflight only; no public candidate import", freezeSha256: hash(rawSeal),
  cohortSha256: seal.fixtureHashes["cohort.mjs"], families: { runtime: 18, types: 4, total: 22 }, expectedDefaults: 77,
  previous76Preserved: true, publicCandidate: null, publicExecutions: 0, typeCompilations: 0, nativeRuns: 0 }, null, 2));
