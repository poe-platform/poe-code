import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const [directoryArgument, outputArgument] = process.argv.slice(2);
assert.ok(directoryArgument && outputArgument, "usage: runtime-review.mjs EXACT_QUALIFIED_RUN NEW_OUTPUT");
const directory = resolve(directoryArgument), output = resolve(outputArgument);
assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const original = JSON.parse(readFileSync(join(directory, "result.json")));
assert.equal(original.sourceCommit, "847dfd766eddbc8f0438f5f999f27ba6a20b8ca7");
assert.equal(original.exitCode, 0);
const source = original.root;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const report = { startedAt: new Date().toISOString(), sourceCommit: original.sourceCommit, originalQualified: directory, experiments: [] };
const work = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-inventory-runtime-independent-")));
function run(command, args, cwd, timeout = 120000) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", TSX_DISABLE_CACHE: "1", TZ: "UTC", LC_ALL: "C" } });
  return { command: [command, ...args], cwd, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
try {
  for (const entry of original.harness) assert.equal(hash(readFileSync(join(source, entry.path))), entry.sha256);
  const { currentConsumers } = await import(pathToFileURL(join(source, "scripts/verify-current-consumers.mjs")).href);
  const { consumerGroups, negativeGroups } = await import(pathToFileURL(join(source, "tests/plugins/qualified-current-release/consumers.mjs")).href);
  const { manifest } = await import(pathToFileURL(join(source, "tests/plugins/stream-five-public/harness.mjs")).href);
  const independent = original.currentConsumers.groups.find(group => group.name === "webdav-atomic");
  assert.ok(independent);
  assert.deepEqual(independent.runtime, []);
  const emitted = join(directory, "consumer/webdav-atomic/emitted");
  const identity = join(emitted, "package.json");
  assert.equal(existsSync(identity), false);
  json(identity, { name: "independent-atomic-public-consumer", private: true, type: "module" });
  try {
    const result = run(process.execPath, ["--experimental-permission", `--allow-fs-read=${join(directory, "consumer")}`,
      "--unhandled-rejections=strict", join(emitted, "independent.mjs")], join(directory, "consumer"));
    json(join(output, "self-contained-atomic-consumer.json"), result);
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    const observations = JSON.parse(result.stdout);
    assert.equal(observations.passed, true);
    assert.equal(observations.calls, 1);
    assert.ok(observations.methods.length >= 1);
    assert.ok(observations.methods.every(method => method === "PROPFIND"));
    report.selfContainedAtomic = { status: "passes-without-service", observations,
      fixtureSha256: hash(readFileSync(join(source, "tests/fs/webdav/atomic-extension-independent/consumer.mts"))),
      setup: "only a consumer identity package.json beside emitted program, as required by original fixture; no source/fixture edits or service" };
  } finally { rmSync(identity); }
  const timestamp = structuredClone(consumerGroups.find(group => group.name === "webdav-timestamp-independent"));
  assert.equal(timestamp.nodeTests, 23);
  consumerGroups.splice(0, consumerGroups.length, timestamp);
  negativeGroups.splice(0, negativeGroups.length);
  const testedPath = "tests/fs/webdav/release-timestamp-independent/independent.test.mts";
  const sentinel = "INDEPENDENT_RUNTIME_SENTINEL";
  for (const mode of ["declared-runtime", "omitted-runtime"]) {
    const experiment = join(work, mode); mkdirSync(experiment);
    const root = join(experiment, "snapshot");
    cpSync(source, root, { recursive: true, dereference: true,
      filter: path => path !== join(source, "dist") && !path.includes("/.oracle/") });
    const target = join(root, testedPath);
    const originalBytes = readFileSync(target);
    const patch = `*** Begin Patch\n*** Update File: ${target}\n@@\n+throw new Error("${sentinel}");\n import assert from "node:assert/strict";\n*** End Patch\n`;
    const changed = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 1024 * 1024 });
    assert.equal(changed.status, 0, changed.stderr);
    const tests = manifest(root, "tests");
    const state = { sourceCommit: original.sourceCommit, directory: experiment, root, tests, steps: [] };
    timestamp.runtime = mode === "declared-runtime" ? ["independent.test.mjs"] : [];
    let error;
    try { currentConsumers(state); } catch (failure) { error = failure.stack; }
    const selected = state.currentConsumers.groups[0];
    const record = { mode, error, inputOriginalSha256: hash(originalBytes), inputMutantSha256: hash(readFileSync(target)),
      setup: "Exact currentConsumers function, bounded to one current canonical group; negative type groups separately proven by the unmodified qualified run. Sentinel and runtime array changed only in owned scratch/process memory.",
      consumer: selected, steps: state.steps, negativeTypes: state.currentConsumers.negativeTypes };
    report.experiments.push({ mode, rejected: error !== undefined, compiled: selected.compile,
      runtimeResults: selected.runtimeResults, sentinelObserved: selected.error?.includes(sentinel) ?? false });
    json(join(output, `${mode}.json`), record);
    assert.equal(selected.compile, "pass");
    if (mode === "declared-runtime") {
      assert.ok(error); assert.match(selected.error, /INDEPENDENT_RUNTIME_SENTINEL/);
    } else {
      assert.equal(error, undefined, error); assert.deepEqual(selected.runtimeResults, []);
    }
    assert.equal(hash(readFileSync(target)), record.inputMutantSha256);
    rmSync(experiment, { recursive: true, force: true });
  }
  report.status = "review-found-runtime-routing-gaps";
} catch (error) { report.error = error.stack; report.status = "review-harness-failed"; process.exitCode = 1; }
finally {
  rmSync(work, { recursive: true, force: true });
  report.cleaned = !existsSync(work); report.finishedAt = new Date().toISOString();
  json(join(output, "report.json"), report);
  console.log(JSON.stringify({ status: report.status, output, cleaned: report.cleaned, error: report.error }));
}
