import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const oldDirectory = resolve(directory, "../../column-stress");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const previousBytes = readFileSync(join(oldDirectory, "native-observations.json"));
const previous = JSON.parse(previousBytes);
const provenanceBytes = readFileSync(join(oldDirectory, "provenance.json"));
const provenance = JSON.parse(provenanceBytes);
const binary = provenance.optionalNativeBuild.finalBinary;
const expectedHash = "a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88";
assert.equal(binary.sha256, expectedHash);
assert.equal(hash(readFileSync(binary.path)), expectedHash);
const casesBytes = readFileSync(join(directory, "native-cases.json"));
const cases = JSON.parse(casesBytes);
assert.ok(cases.length <= 20);
mkdirSync(join(directory, "captures"), { recursive: true });
const output = mkdtempSync(join(directory, "captures/native-"));
const invoke = (args, input) => {
  assert.ok(input.length <= 4096);
  const result = spawnSync(binary.path, args, { cwd: output, input, env: previous.environment, timeout: 2000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, signal: result.signal, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
};
const version = invoke(["--version"], Buffer.alloc(0));
assert.equal(Buffer.from(version.stdoutHex, "hex").toString(), "column from util-linux 2.41.2\n");
const observations = cases.map(fixture => {
  const input = Buffer.from(fixture.input);
  const result = invoke(fixture.args, input);
  if (fixture.sealedRecipe) {
    const old = previous.observations.find(record => record.profile === "util-linux-2.41.2-darwin" && record.recipe === fixture.sealedRecipe);
    assert.deepEqual(fixture.args, old.argv);
    assert.equal(input.toString("hex"), old.stdinHex);
    assert.equal(result.status, old.status);
    assert.equal(result.stdoutHex, old.stdoutHex);
    assert.equal(result.stderrHex, old.stderrHex);
  }
  return { id: fixture.id, args: fixture.args, stdinHex: input.toString("hex"), ...result };
});
assert.equal(hash(readFileSync(binary.path)), expectedHash);
const capture = {
  classification: "Additive small deterministic native records for prospective padding evolution, not revised historical 37/40 evidence",
  capturedAt: new Date().toISOString(), profile: "util-linux 2.41.2 on Darwin, not GNU/Linux locale certification",
  binary, version, env: previous.environment,
  originalProvenanceSha256: hash(provenanceBytes), originalNativeSha256: hash(previousBytes), casesSha256: hash(casesBytes),
  deadlineMs: 2000, maxInputBytes: 4096, maxBufferBytes: 65536,
  observations, processStatus: "All synchronous children exited; no spawned process or temporary native install remains. Unique capture directory retained as evidence.",
};
writeFileSync(join(output, "observations.json"), `${JSON.stringify(capture, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output, records: observations.length, sha256: hash(readFileSync(join(output, "observations.json"))) }));
