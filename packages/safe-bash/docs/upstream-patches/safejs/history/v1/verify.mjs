import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashes, privateState } from "./snapshot.mjs";

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(artifactRoot, "../../..");
const baseline = JSON.parse(readFileSync(join(artifactRoot, "baseline-hashes.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(artifactRoot, "patch-manifest.json"), "utf8"));
const patch = readFileSync(join(artifactRoot, "lifecycle.patch"), "utf8");
const digest = data => createHash("sha256").update(data).digest("hex");

export function checkPatch(text, expectedHash = manifest.patchSha256) {
  assert.equal(digest(text), expectedHash, "Patch hash mismatch");
  assert(text.startsWith("*** Begin Patch\n") && text.endsWith("*** End Patch\n"));
  const paths = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("*** ")) continue;
    if (["*** Begin Patch", "*** End Patch"].includes(line)) continue;
    assert(line.startsWith("*** Update File: "), "Only existing file updates are allowed");
    const path = line.slice("*** Update File: ".length);
    assert(path.startsWith("packages/safejs/src/") && !path.includes("\\"));
    assert(path.split("/").every(part => part !== "." && part !== ".." && part.length > 0));
    assert(Object.hasOwn(manifest.files, path), `Unapproved patch target: ${path}`);
    paths.push(path);
  }
  assert.deepEqual(paths.toSorted(), Object.keys(manifest.files).toSorted());
  return paths;
}

export function checkBaseline(engineRoot) {
  assert.deepEqual(hashes(engineRoot), baseline, "Exact baseline mismatch; input is never patched");
}

export function checkTarget(snapshot, path) {
  assert(Object.hasOwn(manifest.files, path), "Unapproved patch path");
  assert(path.split("/").every(part => part !== "." && part !== ".." && part.length > 0));
  const root = realpathSync(snapshot);
  let target = root;
  for (const [index, part] of path.split("/").entries()) {
    target = join(target, part);
    const stat = lstatSync(target);
    assert(!stat.isSymbolicLink(), `Symlink patch target/ancestor rejected: ${target}`);
    assert(index === path.split("/").length - 1 ? stat.isFile() : stat.isDirectory());
  }
  assert(!relative(root, realpathSync(target)).startsWith(".."));
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], "Usage: node verify.mjs READONLY_PRIVATE_REPOSITORY [--apply-only]");
  const input = realpathSync(process.argv[2]);
  const paths = checkPatch(patch);
  checkBaseline(join(input, "packages/safejs"));
  const applyPatch = execFileSync("sh", ["-c", "command -v apply_patch"], { encoding: "utf8" }).trim();
  assert(applyPatch, "Explicit prerequisite: apply_patch must be installed on PATH");
  const prepared = JSON.parse(execFileSync(process.execPath, [join(artifactRoot, "snapshot.mjs"), input], {
    cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  }));
  const { temporary, baseline: baselineRoot, patched: patchedRoot } = prepared;
  const results = { ...prepared, commands: [], privateInput: input };
  console.log(JSON.stringify(prepared));
  function environment(snapshot) {
    const temp = join(snapshot, "temporary");
    return {
      PATH: process.env.PATH, HOME: join(snapshot, "home"), TMPDIR: temp, TMP: temp, TEMP: temp,
      XDG_CACHE_HOME: temp, TSX_DISABLE_CACHE: "1", POE_SNAPSHOT_MODE: "playback", POE_SNAPSHOT_MISS: "error",
      SAFEJS_PARSE_FUZZ: "1", SAFEJS_ADVERSARIAL_SLOW: "1", SAFEJS_LOCAL_ROOT: join(snapshot, "packages/safejs"),
      SAFEJS_FORBIDDEN_ROOT: input, NO_COLOR: "1",
    };
  }
  function command(label, snapshot, args, timeout = 180_000) {
    const result = spawnSync(process.execPath, args, {
      cwd: snapshot, env: environment(snapshot), encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024,
    });
    const evidence = { label, executable: process.execPath, args, cwd: snapshot, env: environment(snapshot), status: result.status, signal: result.signal, error: result.error?.message };
    results.commands.push(evidence);
    writeFileSync(join(temporary, `${label}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    writeFileSync(join(temporary, "commands.json"), JSON.stringify(results, null, 2));
    return result.status;
  }
  const stress = join(repository, "tests/commands/safejs-stress");
  const nodeArgs = ["--unhandled-rejections=strict", "--import", join(repository, "node_modules/tsx/dist/loader.mjs"), "--import", join(stress, "import-proof.mjs"), "--test"];
  const acceptance = [...nodeArgs, join(stress, "upstream-desired.probe.ts"), join(stress, "action-abort.probe.ts")];
  const applyOnly = process.argv[3] === "--apply-only";
  function acceptanceCounts(label) {
    const lines = readFileSync(join(temporary, `${label}.log`), "utf8").split("\n");
    return Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled"].map(key => {
      const summary = lines.findLast(line => line.startsWith(`# ${key} `));
      assert(summary !== undefined, `Missing TAP ${key}: ${label}`);
      return [key, Number(summary.slice(`# ${key} `.length))];
    }));
  }
  if (!applyOnly) {
    assert.equal(command("baseline-acceptance", baselineRoot, acceptance), 1, "Baseline must demonstrate unresolved acceptance");
    assert.deepEqual(acceptanceCounts("baseline-acceptance"), { tests: 10, pass: 0, fail: 10, skipped: 0, cancelled: 0 });
  }
  checkBaseline(join(patchedRoot, "packages/safejs"));
  for (const path of paths) assert.equal(digest(readFileSync(checkTarget(patchedRoot, path))), manifest.files[path].before);
  execFileSync(applyPatch, [], { input: patch, cwd: patchedRoot, env: environment(patchedRoot), encoding: "utf8" });
  for (const path of paths) assert.equal(digest(readFileSync(checkTarget(patchedRoot, path))), manifest.files[path].after);
  const expected = { ...baseline };
  for (const path of paths) expected[path.slice("packages/safejs/".length)] = manifest.files[path].after;
  assert.deepEqual(hashes(join(patchedRoot, "packages/safejs")), expected, "Unexpected files changed by patch");
  writeFileSync(join(temporary, "patched-hashes.json"), JSON.stringify(expected, null, 2));
  let passed = true;
  if (!applyOnly) {
    passed = command("patched-acceptance", patchedRoot, acceptance) === 0 && passed;
    const counts = acceptanceCounts("patched-acceptance");
    passed = counts.tests === 10 && counts.pass === 10 && counts.fail === 0 && counts.skipped === 0 && counts.cancelled === 0 && passed;
    for (const [label, snapshot] of [["baseline", baselineRoot], ["patched", patchedRoot]]) {
      const invariantStatus = command(`${label}-invariants`, snapshot, [...nodeArgs, join(stress, "wrapper-invariants.probe.mjs")]);
      if (label === "patched") passed = invariantStatus === 0 && passed;
      const suiteStatus = command(`${label}-fullsuite-slow`, snapshot, [
        join(snapshot, "node_modules/vitest/vitest.mjs"), "run", "packages/safejs/src", "packages/safejs/test",
        "--no-cache", "--reporter=default", "--reporter=json", `--outputFile=${join(temporary, `${label}-fullsuite-slow.json`)}`,
      ]);
      passed = suiteStatus === 0 && passed;
    }
  }
  const final = privateState(input);
  writeFileSync(join(temporary, "private-final.json"), JSON.stringify(final, null, 2));
  const initial = JSON.parse(readFileSync(join(temporary, "private-before-copy.json"), "utf8"));
  const comparison = {
    engineUnchanged: JSON.stringify(initial.engine) === JSON.stringify(final.engine),
    revisionUnchanged: initial.revision === final.revision,
    statusUnchanged: initial.status === final.status,
    licenseUnchanged: initial.license === final.license,
  };
  writeFileSync(join(temporary, "private-comparison.json"), JSON.stringify(comparison, null, 2));
  passed = Object.values(comparison).every(Boolean) && passed;
  console.log(JSON.stringify({ ...prepared, comparison, passed: applyOnly ? "application only; no validation" : passed }));
  if (!Object.values(comparison).every(Boolean)) console.error("External drift recorded; do not claim globally unchanged.");
  assert(comparison.engineUnchanged, "Private source drift detected; evidence retained");
  if (!passed) process.exitCode = 1;
}
