import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { nativeCases, appleDifferenceCases } from "./cases.js";
import { runFixture } from "./helpers.js";

interface Observation { id: string; command: string; fixtureSha256: string; status: number; signal: string | null; stdoutHex: string; stderrHex: string; oracle: string }
interface Evidence { observations: Observation[]; appleDifferences: Observation[] }
const evidence: Evidence = JSON.parse(readFileSync(new URL("./evidence/native-corrected.json", import.meta.url), "utf8"));

for (const specimen of nativeCases) {
  test(`native ${specimen.command}: ${specimen.id}`, async () => {
    const expected = evidence.observations.find(row => row.id === specimen.id && row.command === specimen.command)!;
    assert.equal(createHash("sha256").update(JSON.stringify(specimen)).digest("hex"), expected.fixtureSha256);
    assert.equal(expected.signal, null);
    assert.equal(expected.stderrHex, "");
    const result = await runFixture(specimen);
    assert.equal(result.exitCode, expected.status, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutHex, expected.stdoutHex);
  });
}

test("Apple differences remain explicit, not accepted GNU expectations", async () => {
  const wanted = ["ab\tcd\n", "      1 ab\n", "X\r  Y\n"];
  for (let index = 0; index < appleDifferenceCases.length; index++) {
    const result = await runFixture(appleDifferenceCases[index]!);
    const native = evidence.appleDifferences[index]!;
    assert.equal(native.status, 0);
    assert.equal(native.stderrHex, "");
    assert.equal(createHash("sha256").update(JSON.stringify(appleDifferenceCases[index]!)).digest("hex"), native.fixtureSha256);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, wanted[index]);
    assert.notEqual(result.stdoutHex, native.stdoutHex);
  }
});
