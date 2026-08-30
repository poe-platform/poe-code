import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as native from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, files } from "./helpers.js";
import { captureNativeReport, createNativeScratch } from "./native-capture.js";

const executable = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url));
const scenarios = [
  { id: "zero-lines", args: ["-l0"], input: "abc", nativeMessage: /invalid number of lines/, virtualMessage: /invalid number of lines/ },
  { id: "zero-bytes", args: ["-b0"], input: "abc", nativeMessage: /invalid number of bytes/, virtualMessage: /invalid number of bytes/ },
  { id: "two-modes", args: ["-l1", "-b1"], input: "abc", nativeMessage: /cannot split in more than one way/, virtualMessage: /cannot split in more than one way/ },
  { id: "missing-input", args: ["missing"], input: "", nativeMessage: /No such file or directory/, virtualMessage: /no such file or directory/ },
  { id: "missing-parent", args: ["-b1", "-", "missing/part"], input: "abc", nativeMessage: /No such file or directory/, virtualMessage: /no such file or directory/ },
  { id: "suffix-exhausted", args: ["-a1", "-b1"], input: "abcdefghijklmnopqrstuvwxyz0", nativeMessage: /output file suffixes exhausted/, virtualMessage: /output file suffixes exhausted/ },
  { id: "numeric-exhausted", args: ["--numeric-suffixes=99", "-b1"], input: "ab", nativeMessage: /output file suffixes exhausted/, virtualMessage: /output file suffixes exhausted/ },
  { id: "same-input", args: ["-b1", "xaa"], input: "", file: "ORIGINAL", nativeMessage: /would overwrite input/, virtualMessage: /would overwrite input/ },
  { id: "directory-output", args: ["-b1"], input: "abc", directory: true, nativeMessage: /Is a directory/, virtualMessage: /illegal operation on a directory/ },
] as const;

test("GNU errors: exact status/effects, separately asserted diagnostic profiles", async context => {
  let binary: Uint8Array;
  try { binary = await native.readFile(executable); } catch { context.skip("pinned GNU9.7 oracle unavailable"); return; }
  assert.equal(createHash("sha256").update(binary).digest("hex"), "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958");
  const report: unknown[] = [];
  let failure = false;
  for (const specimen of scenarios) {
    const temp = await createNativeScratch(context);
    const fs = createMemoryFileSystem();
    if ("file" in specimen) { await native.writeFile(join(temp, "xaa"), specimen.file); await fs.writeFile("/xaa", Buffer.from(specimen.file)); }
    if ("directory" in specimen) { await native.mkdir(join(temp, "xaa")); await fs.mkdir("/xaa"); }
    const expected = spawnSync(executable, specimen.args, { cwd: temp, input: specimen.input, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
    const actual = await run(specimen.args, specimen.input, {}, { fs });
    const nativeFiles: Record<string, string> = {};
    for (const entry of await native.readdir(temp, { withFileTypes: true })) if (entry.isFile()) nativeFiles[entry.name] = (await native.readFile(join(temp, entry.name))).toString("hex");
    const observedFiles = await files(fs);
    const nativeEntries = (await native.readdir(temp, { withFileTypes: true })).map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file" })).sort((left, right) => left.name.localeCompare(right.name));
    const observedEntries = [...await fs.readdir("/")].sort((left, right) => left.name.localeCompare(right.name));
    let semanticMatch = true;
    try {
      assert.equal(actual.exitCode, expected.status);
      assert.equal(actual.stdout, expected.stdout.toString());
      assert.deepEqual(observedFiles, nativeFiles);
      assert.deepEqual(observedEntries, nativeEntries);
      assert.match(expected.stderr.toString(), specimen.nativeMessage);
      assert.match(actual.stderr, specimen.virtualMessage);
    } catch { failure = true; semanticMatch = false; }
    report.push({ id: specimen.id, args: specimen.args, input: specimen.input, expected: { status: expected.status, stdout: expected.stdout.toString(), stderr: expected.stderr.toString(), files: nativeFiles, entries: nativeEntries }, observed: { status: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, files: observedFiles, entries: observedEntries }, semanticMatch, strictMatch: semanticMatch && actual.stderr === expected.stderr.toString(), diagnosticPolicy: { native: String(specimen.nativeMessage), virtual: String(specimen.virtualMessage) } });
    if (semanticMatch) await native.rm(temp, { recursive: true });
  }
  const path = await captureNativeReport(context, "gnu-errors", { profile: "GNU coreutils9.7 on Darwin, LC_ALL=C; diagnostic profiles separately asserted", report }, failure);
  assert.equal(failure, false, `error cohort failure retained in ${path ?? "test diagnostics"}`);
});

test("explicit GNU versus Apple naming/profile differences remain visible", async context => {
  try { await native.access(executable); await native.access("/usr/bin/split"); } catch { context.skip("both native profiles required"); return; }
  assert.equal(createHash("sha256").update(await native.readFile(executable)).digest("hex"), "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958");
  assert.equal(createHash("sha256").update(await native.readFile("/usr/bin/split")).digest("hex"), "7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91");
  const report: unknown[] = [];
  for (const scenario of [
    { id: "alphabet-auto", args: ["-b1"], input: "z".repeat(677), appleStatus: 65, appleFiles: 676, appleDiagnostic: /^split: too many files\n$/u, gnuFiles: 677 },
    { id: "numeric-auto", args: ["-db1"], input: "z".repeat(101), appleStatus: 65, appleFiles: 100, appleDiagnostic: /^split: too many files\n$/u, gnuFiles: 101 },
    { id: "GNU-C-option", args: ["-C3"], input: "ab\nc\n", appleStatus: 64, appleFiles: 0, appleDiagnostic: /^\/usr\/bin\/split: illegal option -- C\nusage: split/u, gnuFiles: 2 },
    { id: "invalid-zero", args: ["-l0"], input: "abc", appleStatus: 64, appleFiles: 0, appleDiagnostic: /^split: 0: line count is too small\n$/u, gnuFiles: 0 },
  ]) {
    const outputs: Record<string, unknown> = {};
    for (const [name, tool] of [["gnu", executable], ["apple", "/usr/bin/split"]] as const) {
      const temp = await createNativeScratch(context);
      const result = spawnSync(tool, scenario.args, { cwd: temp, input: scenario.input, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
      const names = (await native.readdir(temp)).sort();
      outputs[name] = { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString(), names };
      if (name === "gnu") {
        assert.equal(result.status, scenario.id === "invalid-zero" ? 1 : 0);
        assert.equal(names.length, scenario.gnuFiles);
      } else {
        assert.equal(result.status, scenario.appleStatus);
        assert.equal(names.length, scenario.appleFiles);
        assert.match(result.stderr.toString(), scenario.appleDiagnostic);
      }
      await native.rm(temp, { recursive: true });
    }
    report.push({ ...scenario, appleDiagnostic: String(scenario.appleDiagnostic), outputs });
  }
  await captureNativeReport(context, "native-profile-differences", report);
});
