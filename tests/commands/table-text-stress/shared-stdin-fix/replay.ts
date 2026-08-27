import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tableCases } from "../../table-text/cases.js";
import { caseHash, type Observation } from "../../table-text/oracle.js";
import { focused } from "./fixtures.js";
import { authorArgv0Directory, direct, manifest, native, oracle, pins, profileMatch, save, sha, shell, verifyOracle } from "./support.js";

const phase = process.argv[2];
assert.ok(phase === "initial-red" || phase === "post-fix");
const before = await manifest();
await verifyOracle();
const frozen: { identities: unknown; observations: Observation[] } = JSON.parse(await readFile("tests/commands/table-text/gnu-evidence.json", "utf8"));
assert.equal(tableCases.length, 216);
assert.equal(frozen.observations.length, 216);
const author = [];
for (const [index, fixture] of tableCases.entries()) {
  const expected = frozen.observations[index]!;
  assert.equal(expected.name, fixture.name);
  assert.equal(expected.caseSha256, caseHash(fixture));
  const oracle = await native(fixture);
  assert.equal(oracle.exitCode, expected.exitCode, fixture.name);
  assert.equal(oracle.stdoutHex, expected.stdoutHex, fixture.name);
  assert.equal(oracle.stderrHex, expected.stderrHex, fixture.name);
  const actual = await direct(fixture);
  author.push({ fixture, fixtureSha256: caseHash(fixture), expected, native: oracle, actual, match: profileMatch(actual, oracle) });
}
const focusedRows = [];
for (const fixture of focused) {
  const oracle = await native(fixture);
  const actual = await direct(fixture);
  const pipeline = await shell(fixture, true);
  const redirection = await shell(fixture, false);
  focusedRows.push({ fixture, fixtureSha256: sha(JSON.stringify(fixture)), native: oracle, direct: actual, pipeline, redirection, match: [actual, pipeline, redirection].every(row => profileMatch(row, oracle)) });
}
const after = await manifest();
const drift = Object.keys(before).filter(path => before[path] !== after[path]).map(path => ({ path, before: before[path], after: after[path] }));
const summary = { author: { total: author.length, passes: author.filter(row => row.match).length, failures: author.filter(row => !row.match).map(row => row.fixture.name) }, focused: { total: focusedRows.length, passes: focusedRows.filter(row => row.match).length, failures: focusedRows.filter(row => !row.match).map(row => row.fixture.name) }, native: { originalExactRows: author.length, focusedRows: focusedRows.length, versionCalls: 3 }, drift };
await save(`${phase}.json`, { at: new Date().toISOString(), phase, head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), node: process.version, pins, oracle, authorArgv0Directory, originalAuthorBinaryIdentities: frozen.identities, profile: "Exact original native status/stdout/stderr recheck; product status/stdout/file bytes and diagnostic presence, as unchanged author profile. Focused assertions additionally check diagnostic meaning and exact EBADF bytes.", before, after, summary, author, focused: focusedRows });
console.log(JSON.stringify(summary, null, 2));
if (phase === "post-fix") assert.equal(summary.author.passes, 216);
