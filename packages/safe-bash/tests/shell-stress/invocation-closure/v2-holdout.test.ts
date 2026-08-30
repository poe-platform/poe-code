import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { cases, hostCases } from "./v2-cases.js";
import { boundedProcess, owned, sha256 } from "./support.js";

interface NativeRow { id: string; result: { code: number; stdoutHex: string; stderrHex: string; cwd: string; timedOut: boolean; overflow: boolean } }
const native = JSON.parse(await readFile(`${owned}/v2-native.json`, "utf8")) as { cohortHash: string; profiles: { rows: NativeRow[] }[] };
assert.equal(native.cohortHash, sha256(JSON.stringify(cases)));
assert.deepEqual(native.profiles.map(profile => profile.rows.map(row => row.id)), [cases.map(row => row.id), cases.map(row => row.id)]);
async function probe(id: string, originalHost = false) {
  const env: Record<string, string> = { PATH: "unused", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" };
  if (process.env.INVOCATION_TRACE) env.INVOCATION_TRACE = process.env.INVOCATION_TRACE;
  const child = await boundedProcess(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell-stress/invocation-modes/trace.mjs", `${owned}/${originalHost ? "probe" : "v2-probe"}.ts`, id], { cwd: process.cwd(), env });
  if (process.env.CLOSURE_OBSERVATIONS) {
    assert.ok(process.env.CLOSURE_OBSERVATIONS.startsWith(`${resolve(owned)}/`));
    await appendFile(process.env.CLOSURE_OBSERVATIONS, `${JSON.stringify({ id, child })}\n`);
  }
  assert.equal(child.timedOut, false); assert.equal(child.overflow, false); assert.equal(child.code, 0, child.stdout + child.stderr); assert.equal(child.stderr, "");
  return JSON.parse(child.stdout) as { id: string; passed?: boolean; error?: string; exitCode: number; stdoutHex: string; stderrHex: string; stderr: string };
}
for (const row of cases) test(`v2 primary: ${row.id}`, async () => {
  const actual = await probe(row.id);
  const expected = native.profiles[0]!.rows.find(candidate => candidate.id === row.id)!;
  assert.equal(actual.error, undefined); assert.equal(expected.result.timedOut, false); assert.equal(expected.result.overflow, false);
  assert.equal(actual.exitCode, expected.result.code);
  const coordinateMapped = Buffer.from(expected.result.stdoutHex, "hex").toString().replaceAll(expected.result.cwd, "/work");
  assert.equal(actual.stdoutHex, Buffer.from(coordinateMapped).toString("hex"), "Exact primary stdout with original declared cwd coordinate mapping; no role-label normalization");
  if (row.diagnostic) for (const fragment of row.diagnostic) assert.ok(actual.stderr.includes(fragment), `Diagnostic lacks ${fragment}: ${actual.stderr}`);
  else assert.equal(actual.stderrHex, expected.result.stderrHex);
});
for (const id of hostCases) test(`v2 unchanged host: ${id}`, async () => assert.deepEqual(await probe(id, true), { id, passed: true }));
