import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { executeVector, digest, type BytesResult, type Vector } from "../independent-increment/harness.js";

interface LegacyFixture {
  id: string;
  argv: string[];
  input?: string;
  inputHex?: string;
  files?: { path: string; inputHex: string }[];
  stdout: string;
  stderr: string;
  status: number;
  policy?: string;
}
const cohorts = [];
for (const filename of ["raw-input-native.json", "join-native.json"]) {
  const content = readFileSync(new URL(`../${filename}`, import.meta.url));
  const evidence = JSON.parse(content.toString()) as { cases: LegacyFixture[] };
  const rows = [];
  for (const fixture of evidence.cases) {
    const expected: BytesResult = { status: fixture.status, stdoutHex: Buffer.from(fixture.stdout).toString("hex"), stderrHex: Buffer.from(fixture.stderr).toString("hex") };
    const inputHex = fixture.inputHex ?? Buffer.from(fixture.input!).toString("hex");
    const vector: Vector = { id: fixture.id, category: filename, argv: fixture.argv, inputHex, inputSha256: digest(Buffer.from(inputHex, "hex")), files: Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex])), expected: { ...expected, stdoutSha256: digest(Buffer.from(fixture.stdout)), stderrSha256: digest(Buffer.from(fixture.stderr)) } };
    const actual = await executeVector(vector);
    const bytewise = await executeVector({ ...vector, transport: "bytewise" });
    rows.push({ vector, oldPolicy: fixture.policy, expected, actual, bytewise, pass: JSON.stringify(expected) === JSON.stringify(actual), chunkInvariant: JSON.stringify(actual) === JSON.stringify(bytewise) });
  }
  cohorts.push({ filename, expectationSha256: digest(content), total: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, chunkInvariant: rows.filter(row => row.chunkInvariant).length, rows });
}
const target = "tests/commands/structured-stress/jq-42-author-20260827/legacy-current.json";
assert.equal(existsSync(target), false);
const content = JSON.stringify({ at: new Date().toISOString(), note: "Native expected fields only; policy overrides preserved but not substituted. No original expected bytes rewritten. Two transport executions per case; counts are unique cases, not summed transports.", cohorts }, null, 2);
assert.equal(spawnSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${target}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 1024 * 1024 }).status, 0);
for (const cohort of cohorts) {
  console.log(cohort.filename, { total: cohort.total, pass: cohort.pass, fail: cohort.fail, chunkInvariant: cohort.chunkInvariant });
  for (const row of cohort.rows.filter(row => !row.pass)) console.log(row.vector.id, row.expected, row.actual);
}
