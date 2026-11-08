import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { regressions } from "./regressions.js";
import { corpus, reviewed } from "./corpus.js";

const version = spawnSync("jq", ["--version"], { encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
assert.ifError(version.error);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), "jq-1.7.1-apple", "fixture provenance differs; inspect before recapturing");
const fixtures = [...regressions, ...corpus.fixtures, ...reviewed.fixtures];
for (const fixture of fixtures) {
  const native = spawnSync("jq", fixture.argv, { input: fixture.input, encoding: "utf8", timeout: 2000, maxBuffer: 65536 });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.equal(native.status, fixture.status, `${fixture.id}: ${native.stderr}`);
  assert.equal(native.stdout, fixture.stdout, fixture.id);
  if (fixture.status < 5) assert.equal(native.stderr, "", fixture.id);
  else assert.ok(native.stderr.length > 0, fixture.id);
}
console.log(`${version.stdout.trim()}: ${fixtures.length} independent exact stdout/status fixtures verified`);
