import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setup } from "./helpers.js";
import { readCases } from "./invocation-closure-read-cases.js";
import { sourceHashes, virtualObservation } from "./invocation-closure-native.js";
import type { Observation } from "./invocation-closure-native.js";

const before = await sourceHashes();
after(async () => assert.deepEqual(await sourceHashes(), before));
const reference = JSON.parse(await readFile(new URL("./invocation-closure-read-reference.json", import.meta.url), "utf8")) as { profiles: { observations: { name: string; mode: "bash" | "sh"; cwd: string; observation: Observation }[] }[] };
for (const entry of reference.profiles[0]!.observations) test(`read native primary ${entry.mode}: ${entry.name}`, async () => {
  assert.deepEqual(await virtualObservation(readCases.find(fixture => fixture.name === entry.name)!, entry.mode, entry.cwd), entry.observation);
});

for (const size of [1, 2, 3, 7, 100]) test(`N shared binary cursor with chunk size ${size}`, async () => {
  const bytes = Buffer.concat([Buffer.from("é😀"), Buffer.from([0, 255, 128, 92, 10])]);
  const stdin = { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); } };
  const result = await setup().shell.exec('read -rN2 value; args "$value" "$?"; command pass', { stdin, env: { LC_ALL: "en_US.UTF-8" } });
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from('["é😀","0"]'), bytes.subarray(6)]));
  assert.equal(result.stderr, "");
});

test("N consumes only data bytes before the next stdin source unit", async () => {
  const result = await setup().shell.exec("bash -s", { stdin: 'read -N3 value\na\nbargs "$value" "$?"\n', env: { LC_ALL: "en_US.UTF-8" } });
  assert.equal(result.stdout, '["a\\nb","0"]');
  assert.equal(result.stderr, "");
});

test("N zero never pulls input or changes provenance", async () => {
  const { shell, commands } = setup();
  let pulls = 0;
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  const result = await shell.exec('read -N0 value; args "$value" "$?"; origin', { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("unused"); } } });
  assert.equal(result.stdout, '["","0"]');
  assert.equal(pulls, 0);
});

test("N invalid options and counts preserve input and variable", async () => {
  for (const option of ["-N", "-N9007199254740992", "-N1.5", "-N-1", "-Nnope", "-N1 -Z"]) {
    const result = await setup().shell.exec(`value=old; read ${option} value; args "$value"; pass`, { stdin: "untouched" });
    assert.equal(result.stdout, '["old"]untouched', option);
    assert.match(result.stderr, /read:/u);
  }
});

test("N invalid UTF8 fails explicitly and preserves the unread binary tail", async () => {
  const result = await setup().shell.exec('read -rN1 value; args "$?"; pass', { env: { LC_ALL: "C" }, stdin: Buffer.from([195, 169, 255]) });
  assert.match(result.stderr, /unsupported non-UTF-8 text boundary/u);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([...Buffer.from('["1"]'), 169, 255]));
});

test("N validates all names before consuming input", async () => {
  const result = await setup().shell.exec('bash -c \'value=old; read -N1 value bad-name; args "$?" "$value"; pass\' probe', { stdin: "untouched" });
  assert.equal(result.stdout, '["1","old"]untouched');
  assert.equal(result.stderr, "probe: line 1: read: `bad-name': not a valid identifier\n");
});

for (const name of ["read-cancel", "read-limit", "read-source", "read-loop"]) test(`bounded read probe: ${name}`, () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./invocation-closure-probe.ts", import.meta.url)), name], { timeout: 5000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), `PASS ${name}\n`);
});
