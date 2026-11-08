import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessNative, digest, policy } from "../preflight.mjs";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const destination = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2]); assert.equal(existsSync(destination), false);
const metadataPath = "tests/commands/filesystem-inspection-stress/tree/EXTERNAL-ARTIFACTS.json";
const metadata = JSON.parse(readFileSync(join(root, metadataPath)));
const sourcePaths = [metadataPath, "tests/commands/filesystem-inspection-stress/tree/sealed/provenance.json", "tests/integration/full-gate-20260827/preflight-repair/policy.json", "tests/integration/full-gate-20260827/preflight-repair/preflight.mjs", "scripts/verify-whole-gate.mjs", "package.json"];
const sourceHashes = () => sourcePaths.map(path => ({ path, sha256: digest(readFileSync(join(root, path))) }));
const inspect = artifact => {
  const stat = lstatSync(artifact.externalPath);
  const result = { path: artifact.externalPath, resolved: realpathSync(artifact.externalPath), bytes: stat.size,
    mode: (stat.mode & 0o777).toString(8).padStart(4, "0"), sha256: digest(readFileSync(artifact.externalPath)), regular: stat.isFile() && !stat.isSymbolicLink() };
  assert.equal(result.regular, true); assert.equal(result.bytes, artifact.bytes);
  assert.equal(result.mode, artifact.modeOctal); assert.equal(result.sha256, artifact.sha256);
  return result;
};
const temporary = mkdtempSync(join(tmpdir(), "safe-bash-native-readiness-"));
const report = { date: new Date().toISOString(), candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), node: process.version, platform: process.platform, arch: process.arch, suiteLaunched: false, downloads: 0, installations: 0, goldenRecaptures: 0, productTests: 0, sources: sourceHashes() };
try {
  report.treeBefore = metadata.artifacts.map(inspect);
  const binary = metadata.artifacts.find(artifact => artifact.externalBasename === "tree").externalPath;
  const environment = { ...process.env, TREE_NATIVE_BIN: binary };
  report.native = assessNative(policy.native, root, environment);
  assert.equal(policy.native.length, 49); assert.equal(report.native.assets.length, 49); assert.deepEqual(report.native.issues, []);
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", TERM: "dumb" } });
  report.version = { status: version.status, signal: version.signal, error: version.error?.message, stdout: version.stdout, stderr: version.stderr };
  assert.equal(version.status, 0); assert.equal(version.error, undefined); assert.equal(version.stderr, ""); assert.match(version.stdout, /tree v2\.2\.1/u);
  report.treeAfter = metadata.artifacts.map(inspect); assert.deepEqual(report.treeAfter, report.treeBefore);
  const concurrency = 2, journal = join(temporary, "events.jsonl"), files = [];
  const copyTools = (source, target) => {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) {
      const actual = realpathSync(join(source, name)), destination = join(target, name), stat = lstatSync(actual);
      assert.ok(actual.startsWith(realpathSync(join(root, "node_modules")) + "/"));
      if (stat.isDirectory()) copyTools(actual, destination);
      else { assert.ok(stat.isFile()); copyFileSync(actual, destination); chmodSync(destination, stat.mode & 0o777); assert.equal(digest(readFileSync(destination)), digest(readFileSync(actual))); }
    }
  };
  copyTools(join(root, "node_modules"), join(temporary, "node_modules"));
  mkdirSync(join(temporary, "tests"));
  for (let index = 0; index < 6; index++) {
    const path = join(temporary, "tests", `control-${index}.test.ts`); files.push(path);
    writeFileSync(path, `import test from 'node:test';
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
test('file scheduling control ${index}', async () => {
  appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ id: ${index}, phase: 'start' }) + '\\n');
  try { await setTimeout(250); }
  finally { appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ id: ${index}, phase: 'finish' }) + '\\n'); }
});\n`);
  }
  const testScript = JSON.parse(readFileSync(join(root, "package.json"))).scripts.test;
  const historicalCommit = "3ee476a8bdd750b889b0b83eb0f5927d7b5be670";
  const historical = JSON.parse(execFileSync("git", ["show", `${historicalCommit}:package.json`], { cwd: root })).scripts.test;
  report.concurrency = { proposedFileConcurrency: concurrency, historicalCommit, qualification: "Actual package evaluators against six miniature .test.ts files and regular-file copied dev tools, not product tests or an internal-worker/startup-time guarantee.", attempts: [] };
  for (const [label, script, flag] of [["historical-trailing", historical, "--test-concurrency=2"], ["corrected-prefix", testScript, "--test-concurrency=2"], ["invalid-option", testScript, "--safe-bash-invalid-test-option"]]) {
    rmSync(journal, { force: true });
    const prefix = 'node --input-type=module -e "', suffix = '" --';
    assert.ok(script.startsWith(prefix) && script.endsWith(suffix));
    const args = ["--input-type=module", "-e", script.slice(prefix.length, -suffix.length), "--", flag];
    const result = spawnSync(process.execPath, args, { cwd: temporary, encoding: "utf8", env: { ...process.env, TSX_DISABLE_CACHE: "1" }, timeout: 15000, maxBuffer: 1024 * 1024 });
    const observation = { label, script, flag, status: result.status, stdout: result.stdout, stderr: result.stderr, events: existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
    report.concurrency.attempts.push(observation);
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    if (label === "invalid-option") { assert.notEqual(result.status, 0); assert.equal(observation.events.length, 0); continue; }
    assert.equal(result.status, 0);
    const active = new Set(), started = new Set(), finished = new Set(); let maximum = 0;
    for (const event of observation.events) {
      if (event.phase === "start") { assert.equal(started.has(event.id), false); started.add(event.id); active.add(event.id); }
      else { assert.ok(active.has(event.id)); active.delete(event.id); finished.add(event.id); }
      maximum = Math.max(maximum, active.size);
    }
    observation.maximumActive = maximum;
    assert.equal(started.size, files.length); assert.equal(finished.size, files.length); assert.equal(active.size, 0);
    if (label === "historical-trailing") assert.ok(maximum > concurrency, "historical counterexample not reproduced on this host");
    else { assert.ok(maximum <= concurrency); report.concurrency.maximumActive = maximum; }
  }
  report.concurrency.successorCommand = "npm test -- --test-concurrency=2";
  assert.deepEqual(sourceHashes(), report.sources);
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary);
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, native: report.native?.assets.length, issues: report.native?.issues.length, maximumFileConcurrency: report.concurrency?.maximumActive, suiteLaunched: false, cleaned: report.cleaned, destination }));
}
