import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { fixtures } from "./fixtures.js";
import { run } from "./helpers.js";
import { nativeBaseline, nativeProfile } from "./native-baseline.js";
import { captureNative } from "./native.js";

test("frozen native-derived byte fixtures: exact MIME vs semantic descriptions; preserve known mismatches", async context => {
  assert.equal(fixtures.length, nativeBaseline.length);
  let exactType = 0, exactCombined = 0, semantic = 0;
  const differingTypes: string[] = [], differingEncodings: string[] = [];
  for (const [name, sha256, nativeMime, nativeHuman] of nativeBaseline) {
    const specimen = fixtures.find(value => value.name === name)!;
    assert.equal(createHash("sha256").update(specimen.bytes).digest("hex"), sha256, name);
    const actual = await run(["-b", "--mime-type", "-"], {}, { stdin: toByteSource(specimen.bytes) });
    const combined = await run(["-b", "--mime", "-"], {}, { stdin: toByteSource(specimen.bytes) });
    assert.equal(actual.exitCode, 0); assert.equal(combined.exitCode, 0);
    if (actual.stdout.trim() === nativeMime.split(";")[0]) exactType++; else differingTypes.push(name);
    if (combined.stdout.trim() === nativeMime) exactCombined++;
    if (specimen.encoding !== nativeMime.split("charset=")[1]) differingEncodings.push(name);
    assert.match(nativeHuman, new RegExp(specimen.semantic, "iu"));
    const human = await run(["-b", "-"], {}, { stdin: toByteSource(specimen.bytes) });
    assert.match(human.stdout, new RegExp(specimen.semantic, "iu")); semantic++;
  }
  assert.deepEqual(differingTypes, ["pe-header", "wasm-empty"]);
  assert.deepEqual(differingEncodings, ["pdf"]);
  assert.equal(exactType, 24); assert.equal(exactCombined, 23); assert.equal(semantic, 26);
  context.diagnostic(`Captured native profile: MIME type exact ${exactType}/26; combined exact ${exactCombined}/26; human category semantic ${semantic}/26. Mismatches retained, not passes.`);
});

test("live native file reproduces frozen results only under the pinned Darwin executable/database profile", async context => {
  if (process.platform !== "darwin") { context.skip("pinned native Darwin profile unavailable; captured cohort still runs"); return; }
  let capture: Awaited<ReturnType<typeof captureNative>>;
  try { capture = await captureNative(); }
  catch (error) {
    if ((error as { code?: string }).code === "ENOENT") { context.skip("native executable/database unavailable"); return; }
    throw error;
  }
  if (capture.version !== nativeProfile.version || capture.executableSha256 !== nativeProfile.executableSha256 || capture.databaseSha256 !== nativeProfile.databaseSha256) {
    context.skip("native executable/database differs from pinned profile; not a parity pass"); return;
  }
  assert.deepEqual(capture.records.map(record => [record.name, record.sha256, record.mime, record.human]), nativeBaseline);
  context.diagnostic("26 deterministic fixtures; 52 classification invocations plus one --version; frozen native capture reproduced exactly.");
});
