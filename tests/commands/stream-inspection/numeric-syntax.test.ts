import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { numericSyntaxCases } from "./numeric-syntax-cases.js";
import { captureNumericSyntax } from "./numeric-syntax-oracle.js";
import { runFixture } from "./helpers.js";

interface Observation { id: string; fixtureSha256: string; status: number; signal: string | null; stdoutHex: string; stderrHex: string }
const evidence: { native: { observations: Observation[] } } = JSON.parse(readFileSync(new URL("./evidence/fixer-numeric-controls.json", import.meta.url), "utf8"));

for (const specimen of numericSyntaxCases) {
  test(`numeric syntax ${specimen.command}: ${specimen.id}`, async () => {
    const native = evidence.native.observations.find(row => row.id === specimen.id)!;
    assert.equal(native.fixtureSha256, createHash("sha256").update(JSON.stringify(specimen)).digest("hex"));
    assert.equal(native.signal, null);
    assert.equal(native.status, specimen.error === undefined ? 0 : 1);
    if (specimen.error === undefined) assert.equal(native.stderrHex, "");
    else assert.notEqual(native.stderrHex, "");
    const result = await runFixture(specimen, {}, {}, 1);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdoutHex, native.stdoutHex);
    assert.equal(result.stderr, specimen.error ?? "");
    assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(specimen.files ?? {}).sort());
    for (const [name, hex] of Object.entries(specimen.files ?? {})) {
      assert.equal(Buffer.from(await result.fs.readFile(`/work/${name}`)).toString("hex"), hex);
    }
  });
}

test("live pinned numeric syntax controls", { skip: process.env.STREAM_NATIVE_LIVE !== "1" ? "set STREAM_NATIVE_LIVE=1; frozen controls still checked" : false }, () => {
  assert.deepEqual(captureNumericSyntax().observations, evidence.native.observations);
});

for (const specimen of numericSyntaxCases.filter(candidate => candidate.id.startsWith("reported-"))) {
  test(`${specimen.id}: cancellation identity before input and during output`, async () => {
    for (const duringOutput of [false, true]) {
      const controller = new AbortController();
      const reason = Object.assign(new Error("numeric syntax cancelled"), { code: "ENOENT" });
      if (!duringOutput) controller.abort(reason);
      await assert.rejects(runFixture(specimen, { limits: { maxChunkBytes: 1 } }, {
        signal: controller.signal,
        stdout: { async write() { controller.abort(reason); } },
      }, 1), error => error === reason);
    }
  });

  test(`${specimen.id}: argument, output and work budgets remain enforced`, async () => {
    for (const [label, limits] of [["argument", { maxArgumentBytes: 1 }], ["output", { maxOutputBytes: 1 }], ["step", { maxSteps: 1 }]] as const) {
      const result = await runFixture(specimen, { limits }, {}, 1);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, `${specimen.command}: EFBIG: stream-inspection ${label} limit exceeded\n`);
      assert.ok(Buffer.from(result.stdoutHex, "hex").length <= 1);
    }
  });
}
