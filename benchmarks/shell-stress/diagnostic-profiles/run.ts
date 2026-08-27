import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { runVirtualScript, sourceEvidence } from "../../../tests/shell-stress/helpers.js";
import { isolatedSpawn } from "../../../tests/shell-stress/process.js";
import { evidence, fixtures, root, runNative, sha256, validateFrozenProfile } from "../../../tests/shell-stress/diagnostic-profiles/profile.js";

const output = process.argv[2];
assert.ok(typeof output === "string" && output.startsWith("/tmp/"), "Pass a fresh absolute /tmp/report.json output path");
assert.equal(existsSync(output), false, "Preserve existing raw reports; choose a fresh output path");
const before = sourceEvidence();
validateFrozenProfile();
const profiles = [];
for (const profile of evidence.profiles) {
  assert.equal(sha256(profile.executable), profile.sha256);
  const frozen = evidence.captures.find(capture => capture.profile === profile.name && capture.argv0 === "shell" && capture.repetition === 1)!;
  const rows = [];
  for (const [index, { cohort, fixture }] of fixtures.entries()) {
    const native = await runNative(fixture, profile);
    const actual = await runVirtualScript(fixture);
    const expected = frozen.rows[index]!.observation;
    rows.push({ cohort, fixture, expected, native, actual, nativeStable: isDeepStrictEqual(native, expected), pass: isDeepStrictEqual(actual, expected) });
  }
  const resourceArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", fileURLToPath(new URL("../../../tests/shell-stress/diagnostic-profiles/resources.test.ts", import.meta.url))];
  const resource = await isolatedSpawn(process.execPath, resourceArgs, {
    cwd: root, env: { ...process.env, VIRTUAL_BASH_DIAGNOSTIC_PROFILE: profile.name }, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  profiles.push({ profile, rows, resources: { args: resourceArgs, status: resource.status, signal: resource.signal, error: resource.error?.message, stdout: resource.stdout.toString(), stderr: resource.stderr.toString() } });
}
const after = sourceEvidence();
const report = { before, after, sourceStable: before.aggregate === after.aggregate, profiles };
const text = JSON.stringify(report, null, 2);
const patch = `*** Begin Patch\n*** Add File: ${output}\n${text.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
const applied = spawnSync("apply_patch", [], { cwd: root, input: patch, encoding: "utf8", maxBuffer: 1048576 });
assert.equal(applied.status, 0, applied.stderr);
console.log(applied.stdout);
console.log(JSON.stringify(profiles.map(({ profile, rows, resources }) => ({ profile: profile.name, fixtures: rows.length, passed: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).map(row => row.fixture.name), nativeDrift: rows.filter(row => !row.nativeStable).length, resourceStatus: resources.status })), null, 2));
process.exitCode = report.sourceStable && profiles.every(profile => profile.rows.every(row => row.pass && row.nativeStable) && profile.resources.status === 0) ? 0 : 1;
