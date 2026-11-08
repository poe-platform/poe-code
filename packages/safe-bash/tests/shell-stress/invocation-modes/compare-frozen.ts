import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { invocationFixtures } from "../../shell/invocation-modes-cases.js";
import { virtualObservation } from "../../shell/invocation-modes-native.js";
import type { Observation, Reference } from "../../shell/invocation-modes-native.js";
import { cases } from "./cases.js";
import { immutableJson, owned, sha256 } from "./harness.js";

interface VirtualRow {
  id: string;
  exitCode: number;
  stdoutHex: string;
  stderrHex: string;
  effects: Record<string, string>;
}
interface NativeProfile {
  id: string;
  executable: string;
  interpreterHash: string;
  rows: { id: string; result: { code: number; stdoutHex: string; stderrHex: string }; effects: Record<string, string> }[];
}

const holdoutBytes = await readFile(`${owned}/${process.argv[3] ?? "post-ready-holdout-evidence.json"}`);
const holdout: { runs: { stdout: string }[] } = JSON.parse(holdoutBytes.toString());
const captured = holdout.runs[0]!.stdout.split("\n").filter(line => line.startsWith("# {"));
assert.equal(captured.length, 72);
const actualRows = captured.map(line => {
  const match = /"stdoutHex":"([a-f0-9]*)"/u.exec(line);
  assert.ok(match, "Missing captured child stdout bytes");
  return JSON.parse(Buffer.from(match[1]!, "hex").toString()) as VirtualRow;
});
const nativeBytes = await readFile(`${owned}/native-corrected-evidence.json`);
const native: { cohortHash: string; profiles: NativeProfile[] } = JSON.parse(nativeBytes.toString());
assert.equal(native.cohortHash, sha256(await readFile(`${owned}/cases.ts`)));
const independent = native.profiles.map(profile => {
  assert.deepEqual(profile.rows.map(row => row.id), cases.map(row => row.id));
  const rows = profile.rows.map(expected => {
    const capturedRow = actualRows.find(row => row.id === expected.id);
    assert.ok(capturedRow);
    const actual = { code: capturedRow.exitCode, stdoutHex: capturedRow.stdoutHex, stderrHex: capturedRow.stderrHex, effects: capturedRow.effects };
    const reference = { ...expected.result, effects: expected.effects };
    const fields = (["code", "stdoutHex", "stderrHex", "effects"] as const).filter(field => !isDeepStrictEqual(actual[field], reference[field]));
    const definition = cases.find(row => row.id === expected.id)!;
    const classification = definition.scope === "policy" ? "retained strict-file policy"
      : definition.scope === "posix-limit" ? "broader POSIX limit"
      : ["path-command-v", "path-type"].includes(expected.id) ? "preexisting absent introspection"
      : fields.length ? "raw diagnostic dialect/context difference" : "exact raw match";
    if (classification === "raw diagnostic dialect/context difference") assert.deepEqual(fields, ["stderrHex"]);
    return { id: expected.id, pass: fields.length === 0, fields, classification, expected: reference, actual };
  });
  return { profile: profile.id, executable: profile.executable, interpreterHash: profile.interpreterHash, total: rows.length, passed: rows.filter(row => row.pass).length, rows };
});

const authorBytes = await readFile("tests/shell/invocation-modes-reference.json");
const author: Reference = JSON.parse(authorBytes.toString());
assert.equal(author.fixtureHash, sha256(await readFile("tests/shell/invocation-modes-cases.ts")));
const observations = new Map<string, Observation>();
for (const mode of ["bash", "sh"] as const) {
  for (const fixture of invocationFixtures) observations.set(`${mode}:${fixture.name}`, await virtualObservation(fixture, mode));
}
const authorComparisons = author.profiles.map(profile => {
  assert.equal(profile.records.length, 104);
  const rows = profile.records.map(record => {
    const actual = observations.get(`${record.mode}:${record.name}`);
    assert.ok(actual);
    return { name: record.name, mode: record.mode, pass: isDeepStrictEqual(actual, record.result),
      fields: (["stdout", "stderr", "status", "files"] as const).filter(field => !isDeepStrictEqual(actual[field], record.result[field])),
      expected: record.result, actual };
  });
  return { profile: profile.name, executable: profile.executable, interpreterHash: profile.sha256, version: profile.version, total: rows.length, passed: rows.filter(row => row.pass).length, rows };
});
const evidence = {
  timestamp: new Date().toISOString(), nativeProcessesStarted: 0,
  sourceEvidence: { holdout: sha256(holdoutBytes), independentNative: sha256(nativeBytes), authorNative: sha256(authorBytes) },
  transportDecoding: "TAP diagnostic text doubles backslashes. Decode the captured child stdoutHex bytes, then parse that original JSON. No stdout/stderr diagnostic normalization or live-native rerun.",
  fixtureProvenance: "Independent PATH shebangs role-render to each actual pinned interpreter. Author fixtures retain /bin/bash headers: PATH child is historical 3.2 even under primary 5.3 lookup parent. Full frozen profile cohorts retained separately.",
  independent, authorComparisons,
};
await immutableJson(process.argv[2] ?? "post-ready-raw-comparison.json", evidence);
for (const cohort of [...independent, ...authorComparisons]) console.log(`${cohort.profile}: ${cohort.passed}/${cohort.total} raw exact; ${cohort.total - cohort.passed} losses retained`);
if ([...independent, ...authorComparisons].some(cohort => cohort.passed !== cohort.total)) process.exitCode = 1;
