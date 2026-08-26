import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { caseHash, coreutilsCases, dialectCases, type ReferenceCase } from "./gnu-cases.js";
import { chunks, native, run } from "./helpers.js";

interface Observation { name: string; caseSha256: string; exitCode: number; stdoutHex: string; stderr: string }
interface Evidence {
  observations: Observation[];
  apple: { version: string; observations: Observation[] };
}
const captured = await readFile(new URL("gnu-evidence.json", import.meta.url), "utf8");
assert.equal(createHash("sha256").update(captured).digest("hex"), "765ee2327c2411c53ab6e0c99a91fd66d5c98f7a09765ccc12ee1a091d887c48");
const evidence = JSON.parse(captured) as Evidence;
const allCases = [...dialectCases, ...coreutilsCases()];
assert.equal(new Set(allCases.map(value => value.name)).size, allCases.length);
assert.equal(evidence.observations.length, allCases.length);

function expectation(value: ReferenceCase): Observation {
  const result = evidence.observations.find(item => item.name === value.name);
  assert(result, value.name);
  assert.equal(result.caseSha256, caseHash(value), `${value.name}: input/argv/fixture drift requires fresh independent evidence`);
  return result;
}

async function check(value: ReferenceCase): Promise<void> {
  const expected = expectation(value);
  for (const width of [1, 7, 65536]) {
    const actual = await run(value.command, value.args, chunks(value.input, width), value.files ? { files: value.files } : {});
    assert.equal(actual.exitCode, expected.exitCode, `${value.name}: ${actual.stderr}`);
    assert.equal(actual.stdout.toString("hex"), expected.stdoutHex, value.name);
    assert.equal(actual.stderr.length > 0, expected.stderr.length > 0, `${value.name}: diagnostic presence`);
  }
}

for (const value of dialectCases) test(`pinned GNU gzip 1.14 dialect: ${value.name}`, () => check(value));

for (const command of ["base64", "base32", "sha256sum", "sha1sum", "md5sum"]) {
  test(`always-runnable GNU coreutils 9.7 ${command} reference vectors`, async () => {
    for (const value of coreutilsCases().filter(value => value.command === command)) await check(value);
  });
}

test("live pinned GNU reference matches the immutable captured observations", async context => {
  const gzip = process.env.BYTE_GNU_GZIP;
  const directory = process.env.BYTE_GNU_COREUTILS_DIR;
  if (!gzip || !directory) { context.skip("Set BYTE_GNU_GZIP and BYTE_GNU_COREUTILS_DIR; frozen vectors still run without native tools"); return; }
  for (const command of new Set(allCases.map(value => value.command))) {
    const program = command === "gzip" ? gzip : join(directory, command);
    const version = await native(program, ["--version"]);
    assert.equal(version.exitCode, 0);
    assert.equal(version.stdout.toString().split("\n")[0], command === "gzip" ? "gzip 1.14" : `${command} (GNU coreutils) 9.7`);
    for (const value of allCases.filter(value => value.command === command)) {
      const actual = await native(program, value.args, value.input, value.files ? { files: value.files } : {});
      assert.deepEqual({ name: value.name, caseSha256: caseHash(value), exitCode: actual.exitCode, stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString() }, expectation(value));
    }
  }
});

test("live Apple gzip 479 keeps its four distinct dialect observations", async context => {
  if (process.platform !== "darwin") { context.skip("Apple gzip reference only available on Darwin"); return; }
  const version = await native("/usr/bin/gzip", ["--version"]);
  if (Buffer.concat([version.stdout, version.stderr]).toString().trim() !== evidence.apple.version) { context.skip("Installed Apple gzip differs from the captured version"); return; }
  assert.equal(evidence.apple.observations.length, dialectCases.length);
  for (const value of dialectCases) {
    const actual = await native("/usr/bin/gzip", value.args, value.input);
    assert.deepEqual({ name: value.name, caseSha256: caseHash(value), exitCode: actual.exitCode, stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString() }, evidence.apple.observations.find(item => item.name === value.name));
  }
});
