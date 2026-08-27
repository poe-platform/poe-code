import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { cases } from "./cases.js";
import { boundedProcess, owned, sanitizedEnv, sha256 } from "./harness.js";

interface NativeRow {
  id: string;
  result: { code: number; stdoutHex: string; stderrHex: string; stdout: string; stderr: string; timedOut: boolean; overflow: boolean };
  effects: Record<string, string>;
}
interface VirtualRow {
  id: string; exitCode: number; stdoutHex: string; stderrHex: string; stdout: string; stderr: string;
  effects: Record<string, string>; error?: string; passed?: boolean;
}
const nativeBytes = await readFile(`${owned}/native-corrected-evidence.json`);
assert.equal(sha256(nativeBytes), "86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45", "Frozen native artifact mismatch");
const native: { cohortHash: string; profiles: { id: string; rows: NativeRow[] }[] } = JSON.parse(nativeBytes.toString());
const originalCohortHash = "788539627f6f5d8a8b31702ec3b9c7a6477efe8878fa88fa7fd0ae955553ed3b";
assert.equal(native.cohortHash, originalCohortHash, "Frozen native cohort mismatch");
assert.ok([originalCohortHash, "fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c"].includes(sha256(await readFile(`${owned}/cases.ts`))), "Only original or exact headerless-policy revision is permitted");
assert.equal(native.profiles.length, 2);
assert.deepEqual(native.profiles.map(profile => profile.rows.map(row => row.id)), [cases.map(row => row.id), cases.map(row => row.id)]);

async function probe(id: string) {
  const env = sanitizedEnv();
  if (process.env.INVOCATION_TRACE) env.INVOCATION_TRACE = process.env.INVOCATION_TRACE;
  return boundedProcess(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`, `${owned}/virtual-child.ts`, id], { cwd: resolve("."), env });
}

for (const row of cases) test(`invocation differential: ${row.id}`, async context => {
  const child = await probe(row.id);
  context.diagnostic(JSON.stringify({ id: row.id, child }));
  assert.equal(child.timedOut, false, "Hard process deadline is a failure, never caller-rescued success");
  assert.equal(child.overflow, false);
  assert.equal(child.code, 0, child.stdout + child.stderr);
  assert.equal(child.stderr, "", "Unhandled process diagnostics");
  const actual: VirtualRow = JSON.parse(child.stdout);
  assert.equal(actual.error, undefined);
  for (const profile of native.profiles) {
    const expected = profile.rows.find(candidate => candidate.id === row.id)!;
    assert.equal(expected.result.timedOut, false);
    assert.equal(expected.result.overflow, false);
    if (row.scope === "policy") {
      assert.equal(actual.exitCode, row.policyStatus, `${profile.id}: deliberate contained policy, not native parity`);
      assert.equal(actual.stdoutHex, "");
      assert.match(actual.stderr, /invtool/u);
      assert.notEqual(actual.stderr, "");
    } else {
      assert.equal(actual.exitCode, expected.result.code, `${profile.id} status`);
      assert.equal(actual.stdoutHex, expected.result.stdoutHex, `${profile.id} exact stdout bytes`);
      if (row.diagnostic) {
        for (const fragment of row.diagnostic) {
          assert.ok(expected.result.stderr.includes(fragment), `${profile.id}: native diagnostic lacks ${fragment}`);
          assert.ok(actual.stderr.includes(fragment), `virtual diagnostic lacks ${fragment}: ${actual.stderr}`);
        }
      } else assert.equal(actual.stderrHex, expected.result.stderrHex, `${profile.id} exact stderr bytes`);
      assert.deepEqual(actual.effects, expected.effects, `${profile.id} exact namespace effects`);
    }
  }
});

export const hostCases = [
  "host-nested-invoke-middleware-origin", "host-origin-default-and-replacement", "host-registry-interpreter-precedence",
  "host-path-permission-capability", "host-no-startup-host-fallback", "host-middleware-denies-path-before-io",
  "host-cancel-body-late-rejection", "host-cancel-path-late-rejection", "host-budget-c-source-utf8",
  "host-budget-stdin-source-aggregate", "host-budget-path-repeated-source", "host-budget-repeated-invoke-commands",
  "host-budget-mixed-output", "host-budget-mixed-loops", "host-budget-path-invoke-depth",
];
for (const id of hostCases) test(`invocation host boundary: ${id}`, async context => {
  const child = await probe(id);
  context.diagnostic(JSON.stringify({ id, child }));
  assert.equal(child.timedOut, false);
  assert.equal(child.overflow, false);
  assert.equal(child.code, 0, child.stdout + child.stderr);
  assert.equal(child.stderr, "");
  const actual: VirtualRow = JSON.parse(child.stdout);
  assert.equal(actual.error, undefined);
  assert.equal(actual.passed, true);
});
