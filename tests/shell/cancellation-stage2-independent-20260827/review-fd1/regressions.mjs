import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const reference = JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(own, "focused-01.json.gz.base64"), "utf8"), "base64")));
const output = path.join(own, `${process.argv[2] ?? "regressions-01"}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
const git = (...args) => {
  const child = spawnSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr.toString());
  return child.stdout;
};
const groups = {
  "maintained-invoke-cleanup-env-getopts": ["tests/shell/invoke.test.ts", "tests/shell/invocation-cleanup-lifecycle.test.ts", "tests/shell/invocation-cleanup-pipeline.test.ts", "tests/shell/env-shebang-host.test.ts", "tests/shell/getopts/scanner.test.ts", "tests/shell/getopts/native.test.ts", "tests/shell/getopts/work.test.ts", "tests/shell/getopts/runtime/host.test.ts", "tests/shell/getopts/runtime/ordering.test.ts", "tests/shell/getopts/runtime/state.test.ts"],
  "maintained-core-owned-output": ["tests/shell/core.test.ts", "tests/integration/owned-output-production-rebase/author/operation.test.ts", "tests/integration/owned-output-production-rebase/author/shell.test.ts"],
  "additional-runtime-state-descriptors": ["tests/shell/runtime-regressions.test.ts", "tests/shell/descriptor-inheritance.test.ts", "tests/shell/descriptor-moves.test.ts", "tests/shell/pipeline-effects.test.ts", "tests/shell/positional-ifs.test.ts"],
};
const names = new Set(Object.values(groups).flat());
for (const name of ["tests/shell/helpers.ts", "tests/shell/bash-bugfix-helpers.ts", "tests/shell-stress/env-split-author/native-frozen.json", "tests/shell/getopts-independent-20260827/stage2/corpus.mjs",
  "tests/shell/getopts-independent-20260827/stage2/fixtures/reset-input.data", "tests/shell/getopts-independent-20260827/stage2/fixtures/shared-source.data",
  "tests/integration/owned-output-production-rebase/author/helpers.ts"]) names.add(name);
for (const name of git("ls-tree", "-r", "--name-only", reference.baseline, "tests/shell/getopts").toString().trim().split("\n")) {
  if (/^tests\/shell\/getopts\/(?:[^/]+\.(?:ts|md)|evidence\/(?:design-v1\/archive.json|freeze.json|scanner-facts.json)|runtime\/[^/]+\.ts)$/.test(name)) names.add(name);
}
const getoptsFreeze = JSON.parse(git("show", `${reference.baseline}:tests/shell/getopts/evidence/freeze.json`));
for (const name of Object.keys(getoptsFreeze.paths)) names.add(`tests/shell/getopts/${name}`);
const testInputs = Object.fromEntries([...names].sort().map(name => [name, git("show", `${reference.baseline}:${name}`).toString("base64")]));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage2-fd1-regressions-")));
const root = path.join(temporary, "source");
const tooling = path.join(temporary, "node_modules");
const result = { capturedAt: new Date().toISOString(), baseline: reference.baseline, candidate: reference.candidate, archiveSha256: reference.archiveSha256,
  temporary, groups, testInputs, testHashes: Object.fromEntries(Object.entries(testInputs).map(([name, data]) => [name, hash(Buffer.from(data, "base64"))])), records: [],
  harness: Object.fromEntries(["regressions.mjs", "regression-guard.mjs"].map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")])) };
const inventory = directory => {
  const entries = {};
  const walk = folder => {
    for (const name of fs.readdirSync(folder).sort()) {
      const filename = path.join(folder, name);
      const stat = fs.lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(filename);
      else { assert.ok(stat.isFile()); assert.notEqual(name, "AGENTS.md"); entries[filename] = hash(fs.readFileSync(filename)); }
    }
  };
  walk(directory);
  return entries;
};
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1" };
function execute(label, args) {
  const hashes = { ...inventory(root), ...inventory(tooling) };
  const guard = path.join(temporary, "regression-guard.mjs");
  hashes[guard] = hash(fs.readFileSync(guard));
  const logs = path.join(temporary, `${label}-loads`);
  fs.mkdirSync(logs);
  const manifest = path.join(temporary, `${label}-manifest.json`);
  const mirrorFiles = { "package.json": hash(fs.readFileSync(path.join(root, "package.json"))) };
  if (fs.existsSync(path.join(root, "dist"))) for (const [name, sha256] of Object.entries(inventory(path.join(root, "dist")))) mirrorFiles[path.relative(root, name)] = sha256;
  fs.writeFileSync(manifest, JSON.stringify({ hashes, logs, mirrorBase: path.join(root, "tests/shell-stress/env-split-author"), mirrorFiles }));
  const started = performance.now();
  const child = spawnSync(process.execPath, args, { cwd: root, env: { ...environment,
    NODE_OPTIONS: `--import=${guard}`, STAGE2_GUARD_MANIFEST: manifest }, timeout: 120000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const record = { label, args, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr,
    durationMs: Math.round(performance.now() - started), loads: fs.readdirSync(logs).flatMap(name => fs.readFileSync(path.join(logs, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))) };
  result.records.push(record);
  console.log(JSON.stringify({ label, status: child.status, signal: child.signal, durationMs: record.durationMs }));
  assert.equal(child.error, undefined, label);
  assert.equal(child.signal, null, label);
  for (const entry of record.loads) if (!entry.dynamicAuthenticatedMirror) assert.equal(entry.sha256, hashes[entry.filename]);
  return record;
}
try {
  fs.mkdirSync(root);
  const archive = Buffer.from(reference.archiveBase64, "base64");
  assert.equal(hash(archive), reference.archiveSha256);
  const extraction = spawnSync("tar", ["-xz", "-C", root], { input: archive });
  assert.equal(extraction.status, 0);
  for (const [name, data] of Object.entries(testInputs)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), Buffer.from(data, "base64"));
  }
  for (const [name, tool] of Object.entries(reference.tools)) {
    const input = path.join(repository, "node_modules", name);
    const before = inventory(input);
    for (const [filename, entry] of Object.entries(tool.files)) assert.equal(before[path.join(input, filename)], entry.sha256);
    fs.mkdirSync(path.dirname(path.join(tooling, name)), { recursive: true });
    fs.cpSync(input, path.join(tooling, name), { recursive: true });
    assert.deepEqual(inventory(input), before);
  }
  fs.copyFileSync(path.join(own, "regression-guard.mjs"), path.join(temporary, "regression-guard.mjs"));
  assert.equal(execute("build", [path.join(tooling, "typescript/bin/tsc"), "-p", "tsconfig.build.json"]).status, 0);
  const sourceBefore = inventory(root);
  const toolsBefore = inventory(tooling);
  for (const [label, files] of Object.entries(groups)) {
    execute(label, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...files]);
    assert.deepEqual(inventory(root), sourceBefore);
    assert.deepEqual(inventory(tooling), toolsBefore);
  }
  result.sourceInventory = sourceBefore;
  result.sourcePostInventory = inventory(root);
  result.completed = true;
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(temporary);
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, failure: result.failure, temporaryRemoved: result.temporaryRemoved }));
}
