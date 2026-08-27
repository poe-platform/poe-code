import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, release, type } from "node:os";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const own = dirname(fileURLToPath(import.meta.url));
const [mode, requested] = process.argv.slice(2);
assert.ok(mode === "baseline" || mode === "candidate", "explicit baseline|candidate capture only");
assert.ok(requested, "requires a fresh output directory under this task's directory");
const output = resolve(requested);
assert.ok(output.startsWith(`${own}/`) && !relative(own, output).split("/").includes(".."));
mkdirSync(output, { recursive: false });
const baseline = JSON.parse(readFileSync(join(own, "baseline.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const patchFile = (path, text) => {
  execFileSync("apply_patch", [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
};
const save = (name, data) => patchFile(join(output, name), typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`);
const inventory = directory => Object.fromEntries(readdirSync(directory, { recursive: true }).sort().flatMap(name => {
  const path = join(directory, name);
  const stat = lstatSync(path);
  assert.equal(stat.isSymbolicLink(), false, path);
  return [[name, stat.isDirectory() ? "directory" : hash(readFileSync(path))]];
}));
const scratch = mkdtempSync(join(own, ".work-"));
const commands = [];
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", LANGUAGE: "C", TZ: "UTC" };
const run = (command, args, options = {}) => {
  const observed = spawnSync(command, args, { cwd: scratch, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options });
  commands.push({ command, args, status: observed.status, signal: observed.signal, error: observed.error?.message ?? null, stdout: observed.stdout, stderr: observed.stderr });
  assert.ifError(observed.error);
  assert.equal(observed.signal, null);
  assert.equal(observed.status, 0, `${command}: ${observed.stderr || observed.stdout}`);
  return observed;
};
const started = new Date().toISOString();
let failure;
try {
  execFileSync(process.execPath, [join(own, "verify.mjs")], { cwd: root });
  const archive = execFileSync("git", ["archive", baseline.base, "src", "package.json", "tsconfig.json", "tsconfig.build.json", "tests/commands/expr", "tests/commands/expr-author"], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  run("/usr/bin/tar", ["-xf", "-"], { input: archive });
  const before = inventory(join(scratch, "src"));
  const worker = "src/commands/expr/bre-worker.ts";
  assert.equal(hash(readFileSync(join(scratch, worker))), baseline.sourceHashes[worker]);
  if (mode === "candidate") {
    const replacement = readFileSync(join(own, "candidate-bre-worker.ts.data"), "utf8");
    const original = readFileSync(join(scratch, worker), "utf8");
    const patch = `*** Begin Patch\n*** Update File: ${worker}\n@@\n${original.trimEnd().split("\n").map(line => `-${line}`).join("\n")}\n${replacement.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
    run("apply_patch", [], { input: patch, env: { ...environment, PATH: process.env.PATH } });
  }
  const candidateInputs = inventory(join(scratch, "src"));
  assert.deepEqual(Object.keys(candidateInputs), Object.keys(before));
  for (const [path, digest] of Object.entries(before)) if (path !== "commands/expr/bre-worker.ts") assert.equal(candidateInputs[path], digest, path);
  save("preparation.json", { mode, base: baseline.base, started, source: candidateInputs["commands/expr/bre-worker.ts"], archiveSha256: hash(archive), baselineInputs: before, candidateInputs, driverHashes: Object.fromEntries(["capture.mjs", "observe.mjs"].map(name => [name, hash(readFileSync(join(own, name)))])) });
  run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"]);
  const runtime = run(process.execPath, [join(own, "observe.mjs"), scratch]);
  const observations = JSON.parse(runtime.stdout);
  save("observations.json", observations);
  const tests = ["regex-limits", "regex-protocol", "regex-lifecycle", "abort-reason-regression"]
    .map(name => `tests/commands/expr/${name}.test.ts`);
  {
    const testSource = join(root, "tests/commands/expr/repeat-history");
    for (const name of readdirSync(testSource)) {
      assert.ok(name.endsWith(".ts"));
      patchFile(join(scratch, "tests/commands/expr/repeat-history", name), readFileSync(join(testSource, name), "utf8"));
      if (name.endsWith(".test.ts") || mode === "candidate" && name.endsWith(".checks.ts")) tests.push(`tests/commands/expr/repeat-history/${name}`);
    }
    run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tests/commands/expr/tsconfig.json"]);
  }
  const testsRun = run(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...tests]);
  save("tests.tap", testsRun.stdout);
  assert.deepEqual(inventory(join(scratch, "src")), candidateInputs, "post-run candidate tree detects changed, removed and NEW source files");
  const testInputs = Object.fromEntries(tests.map(path => [path, hash(readFileSync(join(scratch, path)))]));
  save("provenance.json", { mode, base: baseline.base, started, ended: new Date().toISOString(), host: { type: type(), release: release(), arch: arch(), node: process.version }, environment, archiveSha256: hash(archive), baselineInputs: before, candidateInputs, testInputs, source: candidateInputs["commands/expr/bre-worker.ts"], compiledWorker: hash(readFileSync(join(scratch, "dist/commands/expr/bre-worker.js"))), typescript: hash(readFileSync(join(root, "node_modules/typescript/lib/typescript.js"))), postRunSourceEntries: "full file/directory entry set and hashes; includes new entries and empty directories; symlinks refused", observationsOnly: "source candidate, not normative or native acceptance" });
} catch (error) {
  failure = error;
  save("failure.json", { message: error.message, stack: error.stack });
} finally {
  save("commands.json", commands);
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: true, allSynchronousChildrenAwaited: true, workerClosure: "observe finally awaits session.close/executor.dispose/shell.dispose; test runner must exit; parent child timeout is bounded", final: new Date().toISOString() });
}
if (failure) throw failure;
console.log(JSON.stringify({ mode, output, completed: true }));
