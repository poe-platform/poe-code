import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { gnuStringsCases } from "./gnu-strings-cases.js";
import { captureGnuStrings } from "./gnu-strings-oracle.js";
import { runFixture } from "./helpers.js";

interface Observation { id: string; command: string; fixtureSha256: string; status: number; signal: string | null; stdoutHex: string; stderrHex: string }
interface Evidence { observations: Observation[] }
const evidence: Evidence = JSON.parse(readFileSync(new URL("./evidence/gnu-strings.json", import.meta.url), "utf8"));

for (const specimen of gnuStringsCases) {
  test(`GNU2.44 strings: ${specimen.id}`, async () => {
    const native = evidence.observations.find(row => row.id === specimen.id)!;
    assert.equal(native.fixtureSha256, createHash("sha256").update(JSON.stringify(specimen)).digest("hex"));
    assert.equal(native.signal, null);
    const result = await runFixture(specimen, {}, {}, 4093);
    if (specimen.id === "gnu-lone-dash-stdin") {
      assert.equal(native.status, 1);
      assert.match(Buffer.from(native.stderrHex, "hex").toString(), /^Usage: .*strings \[option\(s\)\] \[file\(s\)\]/u);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "strings: missing file operand after '-' (use no operands for stdin)\n");
    } else {
      assert.equal(native.status, 0); assert.equal(native.stderrHex, "");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
    }
    assert.equal(result.stdoutHex, native.stdoutHex);
  });
}

test("live pinned GNU2.44 strings observations", { skip: process.env.STREAM_NATIVE_LIVE !== "1" ? "set STREAM_NATIVE_LIVE=1; frozen GNU strings captures still checked" : false }, () => {
  assert.deepEqual(captureGnuStrings().observations, evidence.observations);
});
