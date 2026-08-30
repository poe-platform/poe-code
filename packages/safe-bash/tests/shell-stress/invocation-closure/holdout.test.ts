import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { cases, hostCases } from "./cases.js";
import { boundedProcess, owned, sha256 } from "./support.js";

interface NativeRow { id: string; result: { code: number; stdoutHex: string; stderrHex: string; stderr: string; cwd: string; timedOut: boolean } }
interface Reference { cohortHash: string; profiles: { id: string; rows: NativeRow[] }[] }
const native: Reference = JSON.parse(await readFile(`${owned}/native-preparation.json`, "utf8"));
assert.equal(native.cohortHash, sha256(await readFile(`${owned}/cases.ts`)));
assert.deepEqual(native.profiles.map(profile => profile.rows.map(row => row.id)), [cases.map(row => row.id), cases.map(row => row.id)]);

const safePluginTuples = new Map<string, { exitCode: number; stdoutHex: string; stderrHex: string }>([
  ["query-V-verbose", { exitCode: 0, stdoutHex: Buffer.from("printf is a registered command\nclosurefn is a function\nclosurefn () \n{ \n    :\n}\nclosuretool is /work/tools/closuretool\n").toString("hex"), stderrHex: "" }],
  ["type-multiple-status", { exitCode: 0, stdoutHex: Buffer.from("command\nfunction\nfile\nmixed:1\nprintf is a registered command\nclosuretool is tools/closuretool\n").toString("hex"), stderrHex: "" }],
]);

async function probe(id: string) {
  const env: Record<string, string> = { PATH: "unused", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" };
  if (process.env.INVOCATION_TRACE) env.INVOCATION_TRACE = process.env.INVOCATION_TRACE;
  const child = await boundedProcess(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell-stress/invocation-modes/trace.mjs", `${owned}/probe.ts`, id], { cwd: process.cwd(), env });
  if (process.env.CLOSURE_OBSERVATIONS) {
    assert.ok(process.env.CLOSURE_OBSERVATIONS.startsWith(`${resolve(owned)}/`));
    await appendFile(process.env.CLOSURE_OBSERVATIONS, `${JSON.stringify({ id, child })}\n`);
  }
  return child;
}

for (const row of cases) test(`closure ${safePluginTuples.has(row.id) ? "safeplugin" : "primary"}: ${row.id}`, async context => {
  const child = await probe(row.id);
  context.diagnostic(`id=${row.id}; pid=${child.pid}; stdoutHex=${child.stdoutHex}`);
  assert.equal(child.timedOut, false, "Process deadline is failure, never caller-rescued success");
  assert.equal(child.overflow, false); assert.equal(child.code, 0, child.stdout + child.stderr);
  assert.equal(child.stderr, "");
  const actual = JSON.parse(child.stdout) as { error?: string; exitCode: number; stdoutHex: string; stderrHex: string; stderr: string };
  assert.equal(actual.error, undefined);
  const expected = native.profiles[0]!.rows.find(candidate => candidate.id === row.id)!;
  assert.equal(expected.result.timedOut, false);
  assert.equal(actual.exitCode, expected.result.code);
  const coordinateMapped = Buffer.from(expected.result.stdoutHex, "hex").toString().replaceAll(expected.result.cwd, "/work");
  const policy = safePluginTuples.get(row.id);
  if (policy) assert.deepEqual({ exitCode: actual.exitCode, stdoutHex: actual.stdoutHex, stderrHex: actual.stderrHex }, policy, "Declared safeplugin registry classification, not native builtin parity");
  else assert.equal(actual.stdoutHex, Buffer.from(coordinateMapped).toString("hex"), "Primary exact stdout after declared native-cwd → VFS /work mapping; raw bytes remain separately compared");
  if (row.diagnostic) for (const fragment of row.diagnostic) assert.ok(actual.stderr.includes(fragment), `Diagnostic lacks ${fragment}: ${actual.stderr}`);
  else assert.equal(actual.stderrHex, expected.result.stderrHex);
});

for (const id of hostCases) test(`closure host: ${id}`, async context => {
  const child = await probe(id);
  context.diagnostic(`id=${id}; pid=${child.pid}; stdoutHex=${child.stdoutHex}`);
  assert.equal(child.timedOut, false); assert.equal(child.overflow, false);
  assert.equal(child.code, 0, child.stdout + child.stderr); assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), { id, passed: true });
});
