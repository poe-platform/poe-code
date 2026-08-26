import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { caseHash } from "./gnu-cases.js";
import { gzipBoundaryCases } from "./gzip-boundary-cases.js";
import { chunks, native, run } from "./helpers.js";

interface Observation { name: string; caseSha256: string; exitCode: number; stdoutHex: string; stderr: string; files: Record<string, string> }
const captured = await readFile(new URL("gnu-gzip-boundaries.json", import.meta.url), "utf8");
assert.equal(createHash("sha256").update(captured).digest("hex"), "8c9a349fb6855b7d1de92324708da9dfd46ee778956e7dd0a68462cf223ea129");
const evidence = JSON.parse(captured) as { observations: Observation[] };
assert.equal(evidence.observations.length, gzipBoundaryCases().length);

for (const value of gzipBoundaryCases()) test(`GNU gzip boundary: ${value.name}`, async () => {
  const expected = evidence.observations.find(item => item.name === value.name);
  assert(expected);
  assert.equal(caseHash(value), expected.caseSha256);
  for (const width of value.input.length > 65536 ? [127, 65536] : [1, 7, 65536]) {
    const actual = await run("gzip", value.args, chunks(value.input, width), value.files ? { files: value.files } : {});
    assert.equal(actual.exitCode, expected.exitCode, `${value.name}, chunks ${width}: ${actual.stderr}`);
    assert.equal(actual.stdout.toString("hex"), expected.stdoutHex);
    assert.equal(actual.stderr.length > 0, expected.stderr.length > 0);
    if (expected.exitCode === 2) assert.match(actual.stderr.toString(), /decompression OK, trailing garbage ignored/u);
    const files: Record<string, string> = {};
    for (const entry of await actual.fs.readdir("/work")) files[entry.name] = Buffer.from(await actual.fs.readFile(`/work/${entry.name}`)).toString("hex");
    assert.deepEqual(files, expected.files);
  }
});

test("live pinned GNU gzip reproduces boundary and publication observations", async context => {
  const program = process.env.BYTE_GNU_GZIP;
  if (!program) { context.skip("Set BYTE_GNU_GZIP; frozen boundary/publication vectors run without it"); return; }
  const version = await native(program, ["--version"]);
  assert.equal(version.stdout.toString().split("\n")[0], "gzip 1.14");
  for (const value of gzipBoundaryCases()) {
    const actual = await native(program, value.args, value.input, value.files ? { files: value.files } : {});
    assert.deepEqual({ name: value.name, caseSha256: caseHash(value), exitCode: actual.exitCode,
      stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString(),
      files: Object.fromEntries(Object.entries(actual.files).map(([name, data]) => [name, data.toString("hex")])),
    }, evidence.observations.find(item => item.name === value.name));
  }
});
