import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { caseHash } from "./gnu-cases.js";
import { decoderCases } from "./decoder-cases.js";
import { chunks, run } from "./helpers.js";

interface Observation { name: string; caseSha256: string; exitCode: number; stdoutHex: string; stderr: string }
const captured = await readFile(new URL("gnu-decoder-evidence.json", import.meta.url), "utf8");
assert.equal(createHash("sha256").update(captured).digest("hex"), "6676fffacfe2718098b322c4f3bb1861f4950bbfabd80a330738162c8bed56c9");
const evidence = JSON.parse(captured) as { observations: Observation[] };
assert.equal(evidence.observations.length, decoderCases().length);

// GNU 9.11 rejects incomplete padding followed by LF. Keep the authenticated
// GNU 9.7 capture intact and identify the two verified version differences.
const current911 = new Map<string, Pick<Observation, "exitCode" | "stdoutHex" | "stderr">>([
  ['base64 -d "Zg=\\n"', { exitCode: 1, stdoutHex: "66", stderr: "base64: invalid input\n" }],
  ['base32 -d "MY=====\\n"', { exitCode: 1, stdoutHex: "", stderr: "base32: invalid input\n" }],
]);

for (const command of ["base64", "base32"]) test(`GNU ${command} EOF, malformed and partial-output vectors with verified 9.11 padding differences`, async () => {
  for (const value of decoderCases().filter(value => value.command === command)) {
    const capturedExpected = evidence.observations.find(item => item.name === value.name);
    assert(capturedExpected);
    assert.equal(caseHash(value), capturedExpected.caseSha256);
    const expected = current911.get(value.name) ?? capturedExpected;
    for (const width of [1, 2, 7, 1024]) {
      const actual = await run(command, value.args, chunks(value.input, width));
      assert.deepEqual({ exitCode: actual.exitCode, stdoutHex: actual.stdout.toString("hex"), stderr: actual.stderr.toString() },
        { exitCode: expected.exitCode, stdoutHex: expected.stdoutHex, stderr: expected.stderr }, `${value.name}, chunks ${width}`);
    }
  }
});
