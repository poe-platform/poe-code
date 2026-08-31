import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as native from "node:fs/promises";
import { join } from "node:path";
import { fixtures } from "./cases.js";
import { chunks, files, run } from "./helpers.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { captureNativeReport, createNativeScratch } from "./native-capture.js";
import { nativeSplitBinding } from "./native-binding.js";

for (const name of ["gnu9.7-darwin", "apple-bsd"] as const) test(`native ${name}: exact status/stdout/stderr/file bytes`, async context => {
  const binding = nativeSplitBinding(name === "apple-bsd" ? "apple" : "gnu");
  const profile = { name, executable: binding.path, hash: binding.sha256 };
  let binary: Uint8Array;
  try { binary = await native.readFile(profile.executable); }
  catch { context.skip(`oracle unavailable: ${profile.executable}`); return; }
  assert.equal(createHash("sha256").update(binary).digest("hex"), profile.hash, "oracle changed: pin must be reviewed");
  const evidence: unknown[] = [];
  let failed = false;
  for (const specimen of fixtures.filter(fixture => profile.name !== "apple-bsd" || fixture.bsd)) {
    const temp = await createNativeScratch(context);
    const fs = createMemoryFileSystem();
    if (specimen.fileInput) { await native.writeFile(join(temp, "input"), specimen.input); await fs.writeFile("/input", specimen.input); }
    for (const [name, text] of Object.entries(specimen.existing ?? {})) { await native.writeFile(join(temp, name), text); await fs.writeFile(`/${name}`, Buffer.from(text)); }
    const result = spawnSync(profile.executable, specimen.args, { cwd: temp, input: specimen.fileInput ? Buffer.alloc(0) : specimen.input, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000, maxBuffer: 1024 * 1024 });
    const expectedFiles: Record<string, string> = {};
    for (const name of (await native.readdir(temp)).sort()) expectedFiles[name] = (await native.readFile(join(temp, name))).toString("hex");
    const actual = await run(specimen.args, specimen.fileInput ? "" : chunks(specimen.input, 7, true), {}, { fs });
    const expected = { exitCode: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString(), files: expectedFiles };
    const observed = { exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, files: await files(fs) };
    let match = true;
    try { assert.deepEqual(observed, expected); } catch { match = false; failed = true; }
    evidence.push({ id: specimen.id, args: specimen.args, inputHex: Buffer.from(specimen.input).toString("hex"), existing: specimen.existing, expected, observed, match, ...(result.error ? { nativeError: String(result.error) } : {}) });
    if (match) await native.rm(temp, { recursive: true });
  }
  const path = await captureNativeReport(context, profile.name, { profile, platform: process.platform, arch: process.arch, cohort: evidence, failed }, failed);
  assert.equal(failed, false, `native mismatches retained in ${path ?? "test diagnostics"}`);
});
