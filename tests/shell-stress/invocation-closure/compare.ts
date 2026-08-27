import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { owned, save, sha256 } from "./support.js";

interface Observation { id: string; child: { stdout: string; code: number | null; timedOut: boolean } }
interface Virtual { id: string; exitCode: number; stdoutHex: string; stderrHex: string; effects?: Record<string, string>; error?: string }
interface NativeRow { id: string; result: { code: number; stdoutHex: string; stderrHex: string; cwd: string }; effects?: Record<string, string> }
interface Native { profiles: { id: string; rows: NativeRow[] }[] }
const mode = process.argv[2] ?? "new";
const virtualFile = process.argv[3] ?? "new-evidence.json";
const nativeFile = process.argv[4] ?? "native-preparation.json";
const outputFile = process.argv[5] ?? "new-comparison.json";
const virtualBytes = await readFile(`${owned}/${virtualFile}`);
const captured: { records: { observations: Observation[]; run: { stdout: string } }[] } = JSON.parse(virtualBytes.toString());
const nativeBytes = await readFile(`${owned}/${nativeFile}`);
const native: Native = JSON.parse(nativeBytes.toString());
let virtual: Virtual[];
if (mode === "legacy") {
  virtual = captured.records[0]!.run.stdout.split("\n").filter(line => line.startsWith('# {"id":')).map(line => {
    const match = /"stdoutHex":"([a-f0-9]*)"/u.exec(line);
    assert.ok(match);
    return JSON.parse(Buffer.from(match[1]!, "hex").toString()) as Virtual;
  });
  assert.equal(virtual.length, 72);
} else {
  assert.equal(captured.records[0]!.observations.length, 34);
  virtual = captured.records[0]!.observations.map(row => JSON.parse(row.child.stdout) as Virtual);
}
const comparisons = native.profiles.map(profile => {
  const rows = profile.rows.map(expected => {
    const actual = virtual.find(row => row.id === expected.id);
    assert.ok(actual);
    const fields: string[] = [];
    if (actual.error) fields.push("execution error");
    if (actual.exitCode !== expected.result.code) fields.push("status");
    if (actual.stdoutHex !== expected.result.stdoutHex) fields.push("stdout bytes");
    if (actual.stderrHex !== expected.result.stderrHex) fields.push("stderr bytes");
    if (mode === "legacy" && !isDeepStrictEqual(actual.effects, expected.effects)) fields.push("effects");
    return { id: expected.id, pass: fields.length === 0, fields, expected, actual };
  });
  return { profile: profile.id, total: rows.length, passed: rows.filter(row => row.pass).length, rows };
});
let nativeChanges: unknown[] = [];
if (mode === "legacy") {
  const original: Native = JSON.parse(await readFile("tests/shell-stress/invocation-modes/native-corrected-evidence.json", "utf8"));
  nativeChanges = native.profiles.map(profile => {
    const previous = original.profiles.find(candidate => candidate.id === profile.id)!;
    assert.deepEqual(profile.rows.map(row => row.id), previous.rows.map(row => row.id));
    return { profile: profile.id, total: profile.rows.length, changed: profile.rows.flatMap(row => {
      const old = previous.rows.find(candidate => candidate.id === row.id)!;
      const fields: string[] = (["code", "stdoutHex", "stderrHex"] as const).filter(field => row.result[field] !== old.result[field]);
      if (!isDeepStrictEqual(row.effects, old.effects)) fields.push("effects");
      return fields.length ? [{ id: row.id, fields, old, fresh: row }] : [];
    }) };
  });
}
await save(outputFile, { timestamp: new Date().toISOString(), mode, virtualFile, virtualHash: sha256(virtualBytes), nativeFile, nativeHash: sha256(nativeBytes),
  comparison: "Raw exact bytes/status and legacy effects; no cwd, diagnostic or dialect normalization. New semantic tests separately declare native-cwd to VFS /work mapping. Legacy TAP transport reuses captured stdoutHex decoding, never escaped JSON parsing.", comparisons, nativeChanges });
for (const profile of comparisons) console.log(`${profile.profile}: ${profile.passed}/${profile.total} raw exact`);
if (comparisons.some(profile => profile.passed !== profile.total)) process.exitCode = 1;
