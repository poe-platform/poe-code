import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { caseHash } from "./gnu-cases.js";
import { decoderCases } from "./decoder-cases.js";
import { chunks, native, run } from "./helpers.js";

interface Observation { name: string; caseSha256: string; exitCode: number; stdoutHex: string; stderr: string }
const captured = await readFile(new URL("gnu-decoder-evidence.json", import.meta.url), "utf8");
assert.equal(createHash("sha256").update(captured).digest("hex"), "6676fffacfe2718098b322c4f3bb1861f4950bbfabd80a330738162c8bed56c9");
const evidence = JSON.parse(captured) as { observations: Observation[] };
assert.equal(evidence.observations.length, decoderCases().length);

for (const command of ["base64", "base32"]) test(`pinned GNU ${command} EOF, malformed and partial-output vectors`, async () => {
  for (const value of decoderCases().filter(value => value.command === command)) {
    const expected = evidence.observations.find(item => item.name === value.name);
    assert(expected);
    assert.equal(caseHash(value), expected.caseSha256);
    for (const width of [1, 2, 7, 1024]) {
      const actual = await run(command, value.args, chunks(value.input, width));
      assert.deepEqual({ exitCode: actual.exitCode, stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString() },
        { exitCode: expected.exitCode, stdoutHex: expected.stdoutHex, stderr: expected.stderr }, `${value.name}, chunks ${width}`);
    }
  }
});

test("live GNU coreutils 9.7 reproduces malformed decoder observations", async context => {
  const directory = process.env.BYTE_GNU_COREUTILS_DIR;
  if (!directory) { context.skip("Set BYTE_GNU_COREUTILS_DIR; frozen malformed vectors still run"); return; }
  for (const command of ["base64", "base32"]) {
    const version = await native(join(directory, command), ["--version"]);
    assert.equal(version.stdout.toString().split("\n")[0], `${command} (GNU coreutils) 9.7`);
  }
  for (const value of decoderCases()) {
    const actual = await native(join(directory, value.command), value.args, value.input);
    assert.deepEqual({ name: value.name, caseSha256: caseHash(value), exitCode: actual.exitCode, stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString() }, evidence.observations.find(item => item.name === value.name));
  }
});
