import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { output: { type: "string", default: "benchmarks/reports/snapshot.json" }, revision: { type: "string", default: "HEAD" } } });
assert.ok(values.output.endsWith(".json"), "output must end in .json");
const safeJsRoot = process.env.SAFEJS_LOCAL_ROOT;
assert.ok(safeJsRoot, "SAFEJS_LOCAL_ROOT must point to the actual local SafeJS package");
const digest = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const revision = git("rev-parse", "--verify", "--end-of-options", `${values.revision}^{commit}`);
const statusBefore = git("status", "--short");
const archive = execFileSync("git", ["archive", "--format=tar", revision], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const snapshot = await mkdtemp(join(tmpdir(), "safe-bash-head-"));
execFileSync("tar", ["-xf", "-", "-C", snapshot], { input: archive });
const manifests = {};
for (const name of ["package.json", "package-lock.json", "benchmarks/package.json", "benchmarks/package-lock.json"]) {
  const archived = await readFile(join(snapshot, name));
  assert.equal(digest(await readFile(join(root, name))), digest(archived), `cached dependency manifest differs from HEAD: ${name}`);
  manifests[name] = digest(archived);
}
const lock = JSON.parse(await readFile(join(snapshot, "package-lock.json"), "utf8"));
const installed = {};
for (const name of ["typescript", "tsx", "@types/node", "esbuild"]) {
  const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
  assert.equal(metadata.version, lock.packages[`node_modules/${name}`].version, `installed ${name} differs from archived lock`);
  installed[name] = metadata.version;
}
await symlink(join(root, "node_modules"), join(snapshot, "node_modules"), "dir");
await symlink(join(root, "benchmarks/node_modules"), join(snapshot, "benchmarks/node_modules"), "dir");
const safeJsBefore = {
  root: resolve(safeJsRoot),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: safeJsRoot, encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short", "--", "."], { cwd: safeJsRoot, encoding: "utf8" }).trim(),
  packageSha256: digest(await readFile(join(safeJsRoot, "package.json"))),
};
const commands = [];
function run(label, command, args, timeout = 300000) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: snapshot, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SAFEJS_LOCAL_ROOT: resolve(safeJsRoot), NODE_OPTIONS: "--unhandled-rejections=strict" },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const record = {
    label, command: [command, ...args], exitCode: result.status, signal: result.signal,
    error: result.error?.message ?? null, durationMs: performance.now() - started,
    stdoutSha256: digest(stdout), stderrSha256: digest(stderr),
  };
  commands.push(record);
  console.log(`${label}: exit ${result.status}, ${(record.durationMs / 1000).toFixed(1)}s`);
  return { stdout, stderr, record };
}
const startedAt = new Date().toISOString();
const types = run("typecheck", "npm", ["run", "typecheck"]);
const build = run("build", "npm", ["run", "build"]);
const tests = run("tests", "npm", ["test"]);
const smokeSource = `
import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
const shell = new api.Shell({fs: api.createMemoryFileSystem()});
for (const name of ['standardCommands','textProgramCommands','structuredCommands','searchCommands','byteCommands','diffPatchCommands']) shell.use(api[name]());
try {
  await shell.exec('');
  const names = shell.commands.list().map(command => command.name).sort();
  assert.equal(names.length, 49);
  assert.equal(new Set(names).size, 49);
  for (const name of ['sed','awk','jq','rg','base64','gzip','gunzip','diff','patch']) assert.ok(names.includes(name));
  for (const [source, expected] of [
    ["printf 'hello\\n' | sed 's/hello/world/' | awk '{print $1}'", 'world\\n'],
    ["printf '[1,2]' | jq -c 'map(.+1)'", '[2,3]\\n'],
    ["printf 'hello\\n' | rg hello -", 'hello\\n'],
    ["printf hello | base64 | base64 -d", 'hello'],
    ["printf hello | gzip -c | gunzip -c", 'hello'],
  ]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
  }
  console.log(JSON.stringify({count:names.length, names, rootExports:Object.keys(api).sort(), pipelines:5}));
} finally {await shell.dispose();}
`;
const smoke = run("built-package-root-smoke", process.execPath, ["--input-type=module", "--eval", smokeSource]);
const comparison = run("comparison", "npm", ["run", "benchmark", "--", "--output", "benchmarks/reports/snapshot-comparison.json"]);
const tapSummary = Object.fromEntries([...tests.stdout.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gm)].map(match => [match[1], Number(match[2])]));
const exceptionalTests = tests.stdout.split(/(?=^# Subtest: )/m).filter(block => /^not ok |^ok .* # (?:SKIP|TODO)/m.test(block));
const safeJsAfter = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: safeJsRoot, encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short", "--", "."], { cwd: safeJsRoot, encoding: "utf8" }).trim(),
  packageSha256: digest(await readFile(join(safeJsRoot, "package.json"))),
};
const report = {
  schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
  snapshot: { revision, directory: snapshot, archiveSha256: digest(archive), archiveBytes: archive.length, manifests },
  environment: { node: process.version, npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(), platform: platform(), arch: arch(), installed },
  dependencyPolicy: { runtimeDependencies: JSON.parse(await readFile(join(snapshot, "package.json"), "utf8")).dependencies ?? {}, cachedNodeModules: true, integrityScope: "archived manifest/lock SHA256 plus installed tooling versions; not a full node_modules content audit" },
  safeJs: { before: safeJsBefore, after: safeJsAfter, isolated: false, unchangedMetadata: safeJsBefore.revision === safeJsAfter.revision && safeJsBefore.status === safeJsAfter.status && safeJsBefore.packageSha256 === safeJsAfter.packageSha256 },
  worktree: { statusBefore, statusAfter: git("status", "--short"), headAfter: git("rev-parse", "HEAD"), tested: false },
  commands, tapSummary, exceptionalTests,
  diagnostics: { types: types.stdout + types.stderr, build: build.stdout + build.stderr, testStderr: tests.stderr, smoke: smoke.stdout + smoke.stderr, comparison: comparison.stdout + comparison.stderr },
  claims: { movingWorktreeValidated: false, superiorityDemonstrated: false, todosArePasses: false, skipsArePasses: false },
};
const output = resolve(root, values.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(snapshot, "full-tests.tap"), tests.stdout);
try {
  const comparable = JSON.parse(await readFile(join(snapshot, "benchmarks/reports/snapshot-comparison.json"), "utf8"));
  comparable.snapshot = { revision, archiveSha256: digest(archive) };
  await writeFile(output.replace(/\.json$/u, "-comparison.json"), `${JSON.stringify(comparable, null, 2)}\n`);
} catch (error) { console.error(`comparison report unavailable: ${error.message}`); process.exitCode = 1; }
console.log(JSON.stringify({ output, revision, tapSummary }));
if (commands.some(command => command.exitCode !== 0)) process.exitCode = 1;
