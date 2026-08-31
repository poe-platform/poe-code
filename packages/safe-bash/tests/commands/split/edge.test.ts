import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as native from "node:fs/promises";
import { join } from "node:path";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { files, run } from "./helpers.js";
import { captureNativeReport, createNativeScratch } from "./native-capture.js";
import { nativeSplitBinding } from "./native-binding.js";

test("GNU size spellings and empty-input output-directory controls", async context => {
  const { path: executable, sha256: pin } = nativeSplitBinding("gnu");
  let binary: Uint8Array;
  try { binary = await native.readFile(executable); } catch { context.skip("pinned GNU oracle unavailable"); return; }
  assert.equal(createHash("sha256").update(binary).digest("hex"), pin);
  const evidence: unknown[] = [];
  let failed = false;
  for (const size of ["1g", "1t", "1p", "1e", "1z", "1y", "1r", "1q", "1B", "1mB", "1miB", "+K", " K", "K", " +2", "0K"]) {
    const temp = await createNativeScratch(context);
    const args = ["-b", size];
    const expected = spawnSync(executable, args, { cwd: temp, input: Buffer.alloc(0), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
    const observed = await run(args);
    const match = expected.status === observed.exitCode && expected.stderr.toString() === observed.stderr && expected.stdout.toString() === observed.stdout;
    failed ||= !match;
    evidence.push({ id: `size-${size}`, args, expected: { status: expected.status, stderr: expected.stderr.toString() }, observed: { status: observed.exitCode, stderr: observed.stderr }, semanticMatch: match });
    assert.deepEqual(await native.readdir(temp), []);
    assert.deepEqual(await observed.fs.readdir("/"), []);
    await native.rm(temp, { recursive: true });
  }
  for (const named of [false, true]) {
    const temp = await createNativeScratch(context);
    const fs = createMemoryFileSystem();
    await native.mkdir(join(temp, "xaa"));
    await fs.mkdir("/xaa");
    if (named) { await native.writeFile(join(temp, "input"), ""); await fs.writeFile("/input", Buffer.alloc(0)); }
    const args = named ? ["input"] : [];
    const expected = spawnSync(executable, args, { cwd: temp, input: Buffer.alloc(0), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
    const observed = await run(args, "", {}, { fs });
    const match = expected.status === observed.exitCode && expected.stderr.toString() === observed.stderr;
    failed ||= !match;
    evidence.push({ id: `empty-output-directory-${named ? "file" : "stdin"}`, args, expected: { status: expected.status, stderr: expected.stderr.toString() }, observed: { status: observed.exitCode, stderr: observed.stderr, files: await files(fs) }, semanticMatch: match });
    await native.rm(temp, { recursive: true });
  }
  const path = await captureNativeReport(context, "edge", { profile: "GNU9.7 Darwin LC_ALL=C", evidence, failed }, failed);
  assert.equal(failed, false, `size/empty controls failed; evidence retained in ${path ?? "test diagnostics"}`);
});
