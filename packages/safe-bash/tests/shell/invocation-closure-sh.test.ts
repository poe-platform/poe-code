import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setup } from "./helpers.js";
import { shCases } from "./invocation-closure-sh-cases.js";
import { sourceHashes, quote, virtualObservation } from "./invocation-closure-native.js";
import type { Observation } from "./invocation-closure-native.js";

const before = await sourceHashes();
after(async () => assert.deepEqual(await sourceHashes(), before));
const reference = JSON.parse(await readFile(new URL("./invocation-closure-sh-reference.json", import.meta.url), "utf8")) as { profiles: { observations: { name: string; mode: "bash" | "sh"; cwd: string; observation: Observation }[] }[] };
for (const entry of reference.profiles[0]!.observations) test(`assignment native primary ${entry.mode}: ${entry.name}`, async () => {
  assert.deepEqual(await virtualObservation(shCases.find(fixture => fixture.name === entry.name)!, entry.mode, entry.cwd), entry.observation);
});

for (const mode of ["bash", "sh"] as const) for (const input of ["file", "stdin", "command"]) test(`explicit ${mode} profile through ${input}`, async () => {
  const { shell, fs } = setup();
  const source = 'VALUE=old; VALUE=new :; args "$VALUE"';
  await fs.writeFile("/script", Buffer.from(source));
  const command = input === "file" ? `${mode} /script` : input === "stdin" ? `${mode} -s` : `${mode} -c ${quote(source)}`;
  const result = await shell.exec(command, { stdin: source });
  assert.equal(result.stdout, mode === "sh" ? '["new"]' : '["old"]');
  assert.equal(result.stderr, "");
});

test("bash invocation resets sh profile without resetting shared budgets", async () => {
  const source = 'VALUE=old; VALUE=new :; args "$VALUE"';
  const result = await setup().shell.exec(`sh -c ${quote(`bash -c ${quote(source)}; ${source}`)}`);
  assert.equal(result.stdout, '["old"]["new"]');
});

test("literal invoke inherits sh profile without mutating its parent", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "forward", async execute(context) { return context.invoke!("fun", []); } });
  const source = 'VALUE=old; fun() { VALUE=new :; args "$VALUE"; }; forward; args "$VALUE"';
  assert.equal((await shell.exec(`sh -c ${quote(source)}`)).stdout, '["new"]["old"]');
});

test("sh special assignments are exported but normal utility assignments are not retained", async () => {
  const result = await setup().shell.exec("sh -c 'PRIVATE=one :; TEMP=two true; envget PRIVATE TEMP'");
  assert.equal(result.stdout, "one|<unset>");
});

test("sh command prefix suppresses fatal invalid declaration", async () => {
  const result = await setup().shell.exec("sh -c 'command export bad-name; say survived'");
  assert.equal(result.stdout, "survived\n");
  assert.match(result.stderr, /not a valid identifier/u);
});

test("readonly protects arithmetic, parameter writes and loop variables", async () => {
  for (const source of ['readonly VALUE=1; (( VALUE=2 )); args "$VALUE"', 'readonly VALUE; args "${VALUE:=bad}"', 'readonly VALUE=old; for VALUE in bad; do say bad; done; args "$VALUE"']) {
    const result = await setup().shell.exec(source);
    assert.doesNotMatch(result.stdout, /bad/u);
    assert.match(result.stderr, /readonly variable/u);
  }
});

test("readonly attributes are child-local, not exported process attributes", async () => {
  const result = await setup().shell.exec('readonly VALUE=old; export VALUE; bash -c \'VALUE=child; args "$VALUE"\'; args "$VALUE"');
  assert.equal(result.stdout, '["child"]["old"]');
});

for (const name of ["sh-depth", "sh-source", "sh-output", "sh-loop", "sh-cancel", "read-empty-cancel"]) test(`bounded sh probe: ${name}`, () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./invocation-closure-probe.ts", import.meta.url)), name], { timeout: 5000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), `PASS ${name}\n`);
});

test("readonly read assignment stops at the failed name after earlier assignments", async () => {
  const source = 'first=old; second=old; third=old; readonly second; read -N3 first second third; args "$?" "$first" "$second" "$third"; pass';
  const result = await setup().shell.exec(`bash -c ${quote(source)} probe`, { stdin: "abcZ" });
  assert.equal(result.stdout, '["2","abc","old","old"]Z');
  assert.equal(result.stderr, "probe: line 1: second: readonly variable\n");
});

test("sh special redirection failure is fatal but command prefix suppresses it", async () => {
  for (const [prefix, stdout] of [["", ""], ["command ", "after\n"]]) {
    const result = await setup().shell.exec(`sh -c ${quote(`VALUE=new ${prefix}: <missing; say after`)}`);
    assert.equal(result.stdout, stdout);
    assert.match(result.stderr, /missing.*No such file/u);
  }
});

test("profile follows the actual interpreter, not commandname or environment", async () => {
  const source = 'VALUE=old; VALUE=new :; args "$VALUE"';
  const result = await setup().shell.exec(`bash -c ${quote(source)} sh; sh -c ${quote(source)} bash; ${source}`, { env: { POSIXLY_CORRECT: "1" } });
  assert.equal(result.stdout, '["old"]["new"]["old"]');
});
