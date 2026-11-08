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
const sealBytes = readFileSync(path.join(own, "FREEZE-v1.json"));
const seal = JSON.parse(sealBytes);
for (const [filename, digest] of Object.entries({ ...seal.fixtureHashes, ...seal.historicalHashes })) {
  assert.equal(hash(readFileSync(path.join(own, filename))), digest, filename);
}
for (const [relative, digest] of Object.entries(seal.sourceHashes)) assert.equal(hash(git("show", `${seal.revision}:${relative}`)), digest, relative);
for (const [filename, digest] of Object.entries(seal.historicalHashes)) {
  assert.equal(hash(git("show", `${seal.draftCommit}:${path.relative(repository, path.join(own, filename))}`)), digest);
}
assert.equal(hash(git("show", `${seal.rootApprovedBase}:src/commands/which/DESIGN.md`)), seal.sourceHashes["src/commands/which/DESIGN.md"]);
assert.equal(hash(git("show", `${seal.rootApprovedAccessDelta}:src/commands/which/ACCESS-POLICY-v2.md`)), seal.sourceHashes["src/commands/which/ACCESS-POLICY-v2.md"]);
const tracked = git("ls-tree", "-r", "--name-only", seal.revision, "src/commands/which").toString();
assert.equal(tracked.split("\n").some(filename => filename.endsWith(".ts")), false);
const cases = JSON.parse(readFileSync(path.join(own, "cases-v1.json"), "utf8"));
const draft = JSON.parse(readFileSync(path.join(own, "draft-cases.json"), "utf8"));
assert.deepEqual(cases.cases.map(row => row.id), draft.cases.map(row => row.id));
assert.equal(cases.cases.length, 28);
assert.equal(cases.families.total, 28);
assert.equal(cases.cases.some(row => Object.hasOwn(row, "pending")), false);
assert.deepEqual(Object.values(cases.defaults), [4096, 65536, 65536, 4096, 16384, 65536, 8388608]);
const types = JSON.parse(readFileSync(path.join(own, "types-v1.json"), "utf8"));
assert.deepEqual(types.families.map(row => row.id), ["T01", "T02", "T03", "T04"]);
const cohort = readFileSync(path.join(own, "cohort-v1.mjs"), "utf8");
for (const row of cases.cases) {
  if (row.variants) continue;
  assert.ok(cohort.includes(`test("${row.id} `) || types.families.some(type => type.id === row.id), row.id);
}
for (const key of ["candidateExecutions", "typeCompilations", "nativeOracleExecutions", "mutationExecutions"]) assert.equal(seal[key], 0);
console.log(JSON.stringify({ sealSha256: hash(sealBytes), fixtureSha256: seal.fixtureHashes["cases-v1.json"],
  cohortSha256: seal.fixtureHashes["cohort-v1.mjs"], frozenAgainst: seal.revision, normativeFamilies: 28,
  runtimeGroups: 26, typeFamilies: 4, overlap: ["T02", "T03"], historicalDraftPreserved: true,
  candidateExecutions: 0, nativeExecutions: 0, verification: "hash/schema only, no product import" }, null, 2));
