import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { caseHash, coreutilsCases, dialectCases, type ReferenceCase } from "./gnu-cases.js";
import { chunks, run } from "./helpers.js";

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
