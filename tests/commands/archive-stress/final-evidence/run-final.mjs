import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const end = started + 900000;
const groups = new Set();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const remaining = () => {
  const value = end - Date.now();
  if (value <= 0) throw new Error("900-second combined gate budget exhausted");
  return value;
};
const killGroup = pid => {
  try { process.kill(-pid, "SIGKILL"); return "owned group signalled"; }
  catch (error) { if (error.code === "ESRCH") return "owned group absent"; throw error; }
};
const gateDirectory = await mkdtemp(join(evidenceRoot, "gate-"));
const privateDirectory = await mkdtemp("/tmp/safe-bash-archive-final-");
const report = { classification: "CURRENT WORKING INPUTS; bounded combined archive gate, not whole-repository acceptance", started: new Date(started).toISOString(), budgetSeconds: 900, gateDirectory, privateDirectory, attempts: [], commands: [] };
const environment = { ...process.env };
const loaderOverrides = ["NODE_OPTIONS", "NODE_PATH", "TSX_TSCONFIG_PATH", "TSX_PROJECT", "ESBUILD_BINARY_PATH", ...Object.keys(environment).filter(name => name.startsWith("TS_NODE_"))];
report.loaderOverrides = { cleared: loaderOverrides, originallySet: loaderOverrides.filter(name => Boolean(environment[name])) };
for (const name of loaderOverrides) delete environment[name];
const watchdog = setTimeout(() => {
  for (const pid of groups) killGroup(pid);
  writeFileSync(join(gateDirectory, "watchdog.json"), JSON.stringify({ ...report, failure: "900-second watchdog", time: new Date().toISOString() }, null, 2));
  process.exit(124);
}, 900000);

const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: Math.min(10000, remaining()), maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const gitState = () => ({ time: new Date().toISOString(), head: git("rev-parse", "HEAD"), status: git("status", "--porcelain=v1", "--untracked-files=all"), cached: git("diff", "--cached", "--raw") });
async function pathsUnder(directory, excluded = new Set(), dependency = false) {
  remaining();
  const paths = [];
  for (const name of (await readdir(directory)).sort()) {
    if (excluded.has(name) || name.startsWith(".native-")) continue;
    const path = join(directory, name);
    const original = await lstat(path);
    if (original.isSymbolicLink()) {
      assert.ok(dependency, `source/harness alias is not permitted: ${path}`);
      const resolved = await realpath(path);
      assert.ok(resolved.startsWith(join(root, "node_modules") + sep), `dependency alias escapes installed modules: ${path}`);
    }
    const item = original.isSymbolicLink() ? await stat(path) : original;
    if (item.isDirectory()) paths.push(...await pathsUnder(path, excluded, dependency));
    else { assert.ok(item.isFile(), `non-regular input ${path}`); paths.push(path); }
  }
  return paths;
}
async function inputs() {
  return [
    ...await pathsUnder(join(root, "src")),
    ...await pathsUnder(join(root, "tests/commands/archive"), new Set([".oracle"])),
    ...await pathsUnder(join(root, "tests/commands/archive-stress"), new Set([".runs", "bounds-evidence", "long-link-evidence", "final-evidence", "output", "outputs"])),
    ...await pathsUnder(join(root, "node_modules"), new Set(), true),
    ...["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar", "tests/commands/archive-stress/final-evidence/run-final.mjs", "tests/commands/archive-stress/final-evidence/tsconfig.scope.json"].map(path => join(root, path)),
  ].sort();
}
async function manifest(paths, base = root, requireCopies = false) {
  const files = [];
  for (const path of paths) {
    remaining();
    const metadata = requireCopies ? await lstat(path) : await stat(path);
    if (requireCopies) assert.ok(metadata.isFile() && metadata.nlink === 1, `not an isolated regular file: ${path}`);
    files.push({ path: relative(base, path), bytes: metadata.size, mode: metadata.mode & 0o777, sha256: hash(await readFile(path)) });
  }
  return { sha256: hash(JSON.stringify(files)), files };
}
async function protectedEvidence() {
  const paths = [...await pathsUnder(join(root, "tests/commands/archive-stress/long-link-evidence")), ...await pathsUnder(join(root, "tests/commands/archive-stress/bounds-evidence"))].sort();
  return manifest(paths);
}
async function run(log, args, budget = 120000, executable = process.execPath, cwd = report.frozen) {
  const timeout = Math.min(budget, remaining());
  const command = { log, executable, args, cwd, timeout, started: new Date().toISOString() };
  report.commands.push(command);
  const chunks = [];
  let bytes = 0;
  let exceeded = false;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, detached: true, env: { ...environment, NODE_PATH: "", TSX_DISABLE_CACHE: "1", ARCHIVE_LONG_LINK_NATIVE: "1", ARCHIVE_ACCEPTANCE_SOURCE: join(report.frozen, "src/commands/archive/index.ts"), ARCHIVE_ACCEPTANCE_EVIDENCE: gateDirectory } });
    if (child.pid) groups.add(child.pid);
    const timer = setTimeout(() => { command.timedOut = true; if (child.pid) killGroup(child.pid); }, timeout);
    const collect = chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { exceeded = true; if (child.pid) killGroup(child.pid); }
      else chunks.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("exit", () => { if (child.pid) command.groupCleanup = killGroup(child.pid); });
    child.on("error", error => { clearTimeout(timer); if (child.pid) groups.delete(child.pid); reject(error); });
    child.on("close", (status, signal) => { clearTimeout(timer); if (child.pid) groups.delete(child.pid); resolve({ status, signal }); });
  });
  const output = Buffer.concat(chunks);
  const text = output.toString();
  const counts = {};
  for (const label of ["tests", "pass", "fail", "skipped", "cancelled", "todo"]) {
    const match = new RegExp(`^# ${label} (\\d+)$`, "mu").exec(text);
    if (match) counts[label] = Number(match[1]);
  }
  Object.assign(command, result, { finished: new Date().toISOString(), outputBytes: bytes, outputLimitExceeded: exceeded, counts, failures: [...text.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]), sha256: hash(output) });
  if (log === "built-package.log" && result.status === 0) command.builtChecks = /Built archive checks: 4\/4/u.test(text) ? 4 : 0;
  await writeFile(join(gateDirectory, log), output);
  console.log(JSON.stringify({ log, status: result.status, counts, failures: command.failures, builtChecks: command.builtChecks }));
  return command;
}

try {
  git("merge-base", "--is-ancestor", "33347b7", "HEAD");
  report.movingBefore = gitState();
  report.protectedEvidenceBefore = await protectedEvidence();
  report.integrationCommit = "7aaabcc3895fbfe94591c5848f49ffb536e1f84b";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = await manifest(await inputs());
    const frozen = join(privateDirectory, `snapshot-${attempt}`);
    await mkdir(frozen, { mode: 0o700 });
    let copyMatched = true;
    for (const entry of before.files) {
      remaining();
      const original = join(root, entry.path);
      const destination = join(frozen, entry.path);
      const bytes = await readFile(original);
      if (hash(bytes) !== entry.sha256) { copyMatched = false; break; }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx", mode: entry.mode });
      const [sourceStat, copiedStat] = await Promise.all([stat(original), lstat(destination)]);
      assert.ok(copiedStat.isFile() && copiedStat.nlink === 1 && (sourceStat.dev !== copiedStat.dev || sourceStat.ino !== copiedStat.ino));
    }
    const after = await manifest(await inputs());
    const stable = copyMatched && before.sha256 === after.sha256;
    report.attempts.push({ attempt, frozen, before, after, copyMatched, stable, git: gitState() });
    if (!stable) continue;
    const frozenBefore = await manifest(before.files.map(entry => join(frozen, entry.path)), frozen, true);
    assert.equal(frozenBefore.sha256, before.sha256, "frozen copy does not match sealed working input");
    Object.assign(report, { frozen, sealedAt: new Date().toISOString(), sealedInput: before, frozenBefore });
    break;
  }
  assert.ok(report.frozen, "current inputs changed across three bounded sealing attempts; no tests run on an unsealed copy");
  report.aliasAudit = { files: report.frozenBefore.files.length, regular: true, nlinkOne: true, separateSourceInodes: true, liveAliases: 0, snapshotRetainedOutsideProject: true };
  const lock = JSON.parse(await readFile(join(report.frozen, "package-lock.json"), "utf8"));
  report.dependencies = {};
  for (const name of ["tsx", "typescript", "@types/node", "esbuild", `@esbuild/${process.platform}-${process.arch}`]) {
    const installed = JSON.parse(await readFile(join(report.frozen, "node_modules", name, "package.json"), "utf8"));
    assert.equal(installed.version, lock.packages[`node_modules/${name}`].version);
    report.dependencies[name] = { version: installed.version, integrity: lock.packages[`node_modules/${name}`].integrity };
  }
  report.node = { executable: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)), platform: process.platform, arch: process.arch };
  const gnu = join(report.frozen, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar");
  const gnuHash = hash(await readFile(gnu));
  assert.equal(gnuHash, "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
  report.gnu = { path: gnu, sha256: gnuHash };
  const version = await run("gnu-version.log", ["--version"], 5000, gnu);
  assert.equal(version.status, 0);
  assert.match((await readFile(join(gateDirectory, "gnu-version.log"))).toString(), /^tar \(GNU tar\) 1\.35\n/u);
  for (const [name, path] of [["bsd", "/usr/bin/bsdtar"], ["gzip", "/usr/bin/gzip"], ["gunzip", "/usr/bin/gunzip"]]) {
    report[name] = { path, sha256: hash(await readFile(path)) };
    await run(`${name}-version.log`, ["--version"], 5000, path);
  }
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", "--test-concurrency=1"];
  const author = ["boundaries", "core", "lifecycle", "native", "options", "safety"].map(name => `tests/commands/archive/${name}.test.ts`);
  const stress = ["acceptance", "native", "long-link-regression", "limits-effects", "hardlink-identity"].map(name => `tests/commands/archive-stress/${name}.test.ts`);
  await run("author-128.tap", [...testArgs, ...author]);
  await run("default-wiring-1.tap", [...testArgs, "tests/commands/archive/aggregate-integration.test.ts"]);
  await run("independent-30.tap", [...testArgs, ...stress]);
  await run("native-author-subset-5.tap", [...testArgs, "tests/commands/archive/native.test.ts"]);
  await run("source-build.log", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], 180000);
  await run("built-package.log", ["tests/commands/archive/built-package.mjs"], 60000);
  await run("scoped-types.log", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/archive-stress/final-evidence/tsconfig.scope.json"], 90000);
  report.frozenAfter = await manifest(report.sealedInput.files.map(entry => join(report.frozen, entry.path)), report.frozen, true);
  report.movingAfterInputs = await manifest(await inputs());
  report.movingAfter = gitState();
  report.protectedEvidenceAfter = await protectedEvidence();
  report.stable = { frozenInputs: report.frozenBefore.sha256 === report.frozenAfter.sha256, protectedEvidence: report.protectedEvidenceBefore.sha256 === report.protectedEvidenceAfter.sha256, movingInputs: report.sealedInput.sha256 === report.movingAfterInputs.sha256 };
  report.countChecks = { author128: report.commands.find(command => command.log === "author-128.tap").counts.tests === 128, wiring1: report.commands.find(command => command.log === "default-wiring-1.tap").counts.tests === 1, stress30: report.commands.find(command => command.log === "independent-30.tap").counts.tests === 30, subset5: report.commands.find(command => command.log === "native-author-subset-5.tap").counts.tests === 5 };
  report.reviews = {};
  for (const name of ["integration-review", "long-link-fix", "bounds-tests", "patch-review"]) {
    const path = `/tmp/safe-bash-archive-${name}-detail.txt`;
    try { const bytes = await readFile(path); report.reviews[name] = { path, sha256: hash(bytes), text: bytes.toString() }; }
    catch (error) { if (error.code !== "ENOENT") throw error; report.reviews[name] = { path, ready: false }; }
  }
  report.gatePass = report.commands.every(command => command.status === 0 && !command.outputLimitExceeded && !command.timedOut && (command.counts.skipped ?? 0) === 0 && (command.counts.cancelled ?? 0) === 0) && report.stable.frozenInputs && report.stable.protectedEvidence && Object.values(report.countChecks).every(Boolean);
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  report.gatePass = false;
} finally {
  for (const pid of groups) killGroup(pid);
  report.cleanup = [];
  for (const attempt of report.attempts) {
    for (const path of ["tests/commands/archive", "tests/commands/archive-stress", "tests/commands/archive-stress/long-link-evidence"]) {
      const directory = join(attempt.frozen, path);
      let names;
      try { names = await readdir(directory); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      for (const name of names) if (name.startsWith(".native-")) {
        report.cleanup.push(join(directory, name));
        await rm(join(directory, name), { recursive: true, force: true });
      }
    }
  }
  report.finished = new Date().toISOString();
  report.elapsedMilliseconds = Date.now() - started;
  await writeFile(join(gateDirectory, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  clearTimeout(watchdog);
  console.log(`Evidence: ${join(gateDirectory, "evidence.json")}`);
  console.log(`Retained current-input snapshot: ${report.frozen ?? privateDirectory}`);
  process.exitCode = report.gatePass ? 0 : 1;
}
