import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = fileURLToPath(new URL("./", import.meta.url));
const commit = "e36dab2b6abc216ddc89e5786a0eba76f08a1722";
const oracleRelative = "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar";
const pins = {
  gnu: ["49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", "tar (GNU tar) 1.35"],
  bsd: ["bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", "bsdtar 3.5.3 - libarchive 3.7.4 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8"],
  gzip: ["7bd218bc6b12fced475163901547a796736f72f99533cbec60eea150ed21afa3", "Apple gzip 479"],
  gunzip: ["5ba665e19226838310b102c16b6cebed89f2048ccfc5bba2e8083deb80acec73", "Apple gzip 479"],
};
const files = ["tests/commands/archive/native.test.ts", "tests/commands/archive-stress/pax-independent/controls.test.ts"];
const support = ["tests/commands/archive/helpers.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts", "package.json", "package-lock.json", "tsconfig.json"];
const dependencies = ["tsx", "esbuild", "@esbuild/darwin-arm64"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = path => sha256(readFileSync(path));
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: repository, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
const gitText = (...args) => git(...args).toString().trim();
const systemEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };

function profile() {
  const supplied = process.env.GNU_TAR;
  assert.ok(supplied && isAbsolute(supplied), "GNU_TAR must explicitly name an already-existing absolute GNU tar 1.35 executable; no download/install fallback");
  const paths = { gnu: supplied, bsd: "/usr/bin/bsdtar", gzip: "/usr/bin/gzip", gunzip: "/usr/bin/gunzip" };
  return Object.fromEntries(Object.entries(paths).map(([name, path]) => {
    assert.ok(lstatSync(path).isFile(), `${name}: expected a regular file at ${path}`);
    assert.equal(digest(path), pins[name][0], `${name}: pinned executable SHA256 mismatch at ${path}`);
    const result = spawnSync(path, ["--version"], { env: systemEnv, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name}: version probe failed`);
    const version = name === "gzip" || name === "gunzip" ? result.stderr : result.stdout;
    assert.equal(version.split("\n")[0].trim(), pins[name][1], `${name}: version/dialect mismatch`);
    return [name, { suppliedPath: path, realPath: realpathSync(path), sha256: pins[name][0], versionStdout: result.stdout, versionStderr: result.stderr, versionStatus: result.status }];
  }));
}

function walk(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const local = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `snapshot input cannot be a symlink: ${path}`);
    return stat.isDirectory() ? walk(path, local) : (assert.ok(stat.isFile()), [{ path: local, sha256: digest(path), bytes: stat.size, mode: stat.mode & 0o777 }]);
  });
}

function captureLive() {
  return {
    at: new Date().toISOString(), head: gitText("rev-parse", "HEAD"),
    status: gitText("status", "--porcelain=v1", "--untracked-files=all"),
    index: gitText("diff", "--cached", "--name-status"),
    trackedDiffSha256: sha256(git("diff", "HEAD", "--binary")),
  };
}

function workPath(argument) {
  assert.ok(argument, "explicit new /tmp/safe-bash-archive-prerequisites-* workspace is required");
  const path = resolve(argument);
  assert.ok(/^\/(?:private\/)?tmp\/safe-bash-archive-prerequisites-[^/]+$/.test(path), "workspace must be a dedicated direct /tmp child");
  return path;
}

function prepare(work) {
  assert.equal(realpathSync(process.cwd()), repository, "run only from the assigned repository");
  assert.equal(gitText("rev-parse", "--show-toplevel"), repository);
  const tools = profile();
  mkdirSync(work, { mode: 0o700 });
  for (const directory of ["tree", "evidence", "tmp", "home", "trace", "native-fixtures"]) mkdirSync(join(work, directory));
  const tree = join(work, "tree");
  json(join(work, "evidence/live-before.json"), captureLive());
  const records = git("ls-tree", "-rz", commit, "--", "src", ...files, ...support).toString().split("\0").filter(Boolean).map(line => {
    const [metadata, path] = line.split("\t");
    const [mode, type, oid] = metadata.split(" ");
    assert.equal(type, "blob");
    assert.ok(["100644", "100755"].includes(mode));
    return { path, mode, oid };
  });
  for (const path of [...files, ...support]) assert.ok(records.some(record => record.path === path), `missing frozen input ${path}`);
  const packed = execFileSync("/usr/bin/git", ["cat-file", "--batch"], { cwd: repository, input: records.map(record => record.oid).join("\n") + "\n", timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  let offset = 0;
  for (const record of records) {
    const end = packed.indexOf(10, offset);
    const [oid, type, length] = packed.subarray(offset, end).toString().split(" ");
    assert.equal(oid, record.oid);
    assert.equal(type, "blob");
    const contents = packed.subarray(end + 1, end + 1 + Number(length));
    const target = join(tree, record.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, { flag: "wx", mode: record.mode === "100755" ? 0o555 : 0o444 });
    record.sha256 = sha256(contents);
    record.liveSha256 = existsSync(join(repository, record.path)) ? digest(join(repository, record.path)) : null;
    record.liveMatchesCommit = record.sha256 === record.liveSha256;
    offset = end + 2 + Number(length);
  }
  assert.equal(offset, packed.length);
  const lock = JSON.parse(readFileSync(join(tree, "package-lock.json")));
  const dependencyProfiles = [];
  for (const name of dependencies) {
    const path = `node_modules/${name}`;
    const installed = JSON.parse(readFileSync(join(repository, path, "package.json")));
    assert.equal(installed.version, lock.packages[path].version, `installed lock version drift: ${name}`);
    const before = walk(join(repository, path));
    for (const entry of before) {
      const target = join(tree, path, entry.path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repository, path, entry.path), target);
      chmodSync(target, entry.mode & 0o111 ? 0o555 : 0o444);
      assert.equal(digest(target), entry.sha256);
    }
    assert.deepEqual(walk(join(repository, path)), before, `dependency changed while copying ${name}`);
    dependencyProfiles.push({ name, version: installed.version, lockIntegrityMetadata: lock.packages[path].integrity, registryIntegrityIndependentlyVerified: false, sourceFiles: before });
  }
  const manifest = walk(tree);
  json(join(work, "evidence/source-git-blobs.json"), records);
  json(join(work, "evidence/dependencies.json"), dependencyProfiles);
  json(join(work, "evidence/frozen-manifest.json"), manifest);
  const gate = "tests/integration/full-gate-20260827";
  const classificationPath = `${gate}/evidence/classification.json`;
  const rawPath = `${gate}/evidence/first/test.stdout.log`;
  const classification = JSON.parse(readFileSync(join(repository, classificationPath)));
  const historical = classification.failures.filter(row => row.classification === "native-prerequisite" && files.includes(row.path));
  assert.equal(historical.length, 6);
  assert.ok(historical.every(row => row.observed.code === "ENOENT"));
  json(join(work, "evidence/historical-six.json"), historical);
  const raw = readFileSync(join(repository, rawPath), "utf8").split("\n");
  const excerpt = historical.map(row => {
    assert.ok(raw[row.tapLine - 1].startsWith("not ok "));
    const end = raw.findIndex((line, index) => index >= row.tapLine && line === "  ...");
    assert.ok(end > row.tapLine);
    return { originalPath: rawPath, firstLine: row.tapLine - 1, lastLine: end + 1, text: raw.slice(row.tapLine - 2, end + 1).join("\n") + "\n" };
  });
  json(join(work, "evidence/historical-raw-excerpts.json"), excerpt);
  json(join(work, "evidence/historical-evidence-hashes.json"), [classificationPath, rawPath, `${gate}/REPORT.md`, `${gate}/evidence/native-prerequisites.json`, "tests/commands/archive/native-profile.json", "tests/commands/archive-stress/final-evidence/ROOTREVIEW.md", "tests/commands/archive-stress/pax-independent/REPORT.md", "tests/commands/archive-stress/pax-independent/FINAL-REVIEW.md", "tests/commands/archive-stress/pax-deletion-independent/REPORT.md", "tests/commands/archive-stress/pax-deletion-independent/FINAL-REVIEW.md"].map(path => ({ path, sha256: digest(join(repository, path)) })));
  const metadata = {
    commit, commitTree: gitText("rev-parse", `${commit}^{tree}`), preparedAt: new Date().toISOString(),
    work: realpathSync(work), files, snapshotId: sha256(readFileSync(join(work, "evidence/frozen-manifest.json"))),
    sourceGitBlobManifestSha256: digest(join(work, "evidence/source-git-blobs.json")),
    tools, node: { path: process.execPath, realPath: realpathSync(process.execPath), sha256: digest(process.execPath), version: process.version, platform: process.platform, arch: process.arch },
    runnerSha256: digest(fileURLToPath(import.meta.url)), traceSha256: digest(join(owner, "trace-native.mjs")),
    scope: "Historical e36dab2 source/test Git blobs; installed lock-matching loader closure copied as regular files. Not current HEAD, dirty source, whole-product gate or full historical archive cohort.",
    budget: { testProcesses: 2, casesPerProcess: 11, historicalAffectedCases: 6, testOracleCallsExpected: 17, prepareVersionProbes: 4, copiedGnuVersionProbes: 1, testProcessDeadlineMs: 120000, testCaseDeadlineMs: 60000, outputCapPerProcessBytes: 16777216 },
    environment: { ...systemEnv, HOME: join(work, "home"), TMPDIR: join(work, "tmp"), TSX_DISABLE_CACHE: "1", GNU_TAR: join(tree, oracleRelative), ARCHIVE_PREREQUISITE_TRACE: join(work, "trace"), ARCHIVE_ACCEPTANCE_EVIDENCE: join(work, "native-fixtures") },
    exactSixNames: historical.map(row => row.name),
  };
  json(join(work, "prepared.json"), metadata);
  console.log(JSON.stringify(metadata, null, 2));
}

const groupExists = pid => {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
};

async function testPhase(work, metadata, name) {
  const args = ["--unhandled-rejections=strict", "--import", join(owner, "trace-native.mjs"), "--import", "tsx", "--test", "--test-reporter=tap", "--test-timeout=60000", "--test-concurrency=1", ...files];
  const startedAt = new Date().toISOString();
  const child = spawn(metadata.node.path, args, { cwd: join(work, "tree"), env: metadata.environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  let captured = 0;
  let killed = null;
  const stop = reason => {
    killed ??= reason;
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const timer = setTimeout(() => stop("120000ms process deadline"), 120000);
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
    captured += chunk.length;
    if (captured > 16777216) stop("16MiB process output limit");
    else chunks.push(Buffer.from(chunk));
  });
  const outcome = await new Promise((resolveResult, reject) => { child.on("error", reject); child.on("close", (code, signal) => resolveResult({ code, signal })); }).finally(() => clearTimeout(timer));
  const residualGroup = groupExists(child.pid);
  if (residualGroup) stop("remaining owned process group after close");
  for (let attempt = 0; attempt < 20 && groupExists(child.pid); attempt++) await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  const result = { name, executable: metadata.node.path, args, cwd: join(work, "tree"), environment: metadata.environment, startedAt, endedAt: new Date().toISOString(), pid: child.pid, ...outcome, captured, killed, residualGroup, groupAbsent: !groupExists(child.pid) };
  const output = Buffer.concat(stdout).toString();
  const cases = [...output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(match => ({ name: match[2], status: match[1] === "ok" ? "pass" : "fail" }));
  const counters = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  result.accounting = { cases, counters };
  writeFileSync(join(work, "evidence", `${name}.stdout.log`), output, { flag: "wx" });
  writeFileSync(join(work, "evidence", `${name}.stderr.log`), Buffer.concat(stderr), { flag: "wx" });
  json(join(work, "evidence", `${name}.result.json`), result);
  renameSync(join(work, "trace"), join(work, "evidence", `${name}-trace`));
  mkdirSync(join(work, "trace"));
  assert.equal(killed, null, "bounded process required forced cleanup; inspect raw evidence");
  assert.equal(result.groupAbsent, true);
  assert.equal(cases.length, 11);
  assert.equal(counters.tests, 11);
  for (const key of ["cancelled", "skipped", "todo"]) assert.equal(counters[key], 0);
  assert.equal(cases.filter(row => row.status === "pass").length, counters.pass);
  assert.equal(cases.filter(row => row.status === "fail").length, counters.fail);
  return result;
}

async function run(work) {
  assert.ok(readFileSync("/tmp/safe-bash-archive-prerequisites-plan.txt", "utf8").includes(JSON.parse(readFileSync(join(work, "prepared.json"))).snapshotId), "publish the exact frozen snapshot and budget before testing");
  const metadata = JSON.parse(readFileSync(join(work, "prepared.json")));
  assert.equal(digest(fileURLToPath(import.meta.url)), metadata.runnerSha256);
  assert.equal(digest(join(owner, "trace-native.mjs")), metadata.traceSha256);
  assert.equal(digest(process.execPath), metadata.node.sha256);
  for (const tool of Object.values(metadata.tools)) assert.equal(digest(tool.suppliedPath), tool.sha256);
  const tree = join(work, "tree");
  const sealed = JSON.parse(readFileSync(join(work, "evidence/frozen-manifest.json")));
  assert.deepEqual(walk(tree), sealed);
  const oracle = join(tree, oracleRelative);
  assert.equal(existsSync(oracle), false);
  const baseline = await testPhase(work, metadata, "missing-prerequisite");
  assert.equal(baseline.code, 1);
  assert.equal(baseline.accounting.counters.fail, 6);
  assert.deepEqual(baseline.accounting.cases.filter(row => row.status === "fail").map(row => row.name).sort(), [...metadata.exactSixNames].sort());
  assert.equal((readFileSync(join(work, "evidence/missing-prerequisite.stdout.log"), "utf8").match(/code: 'ENOENT'/g) ?? []).length, 6);
  assert.deepEqual(walk(tree), sealed);
  mkdirSync(dirname(oracle), { recursive: true });
  copyFileSync(metadata.tools.gnu.suppliedPath, oracle);
  chmodSync(oracle, 0o555);
  assert.equal(digest(oracle), pins.gnu[0]);
  const versionStdout = execFileSync(oracle, ["--version"], { env: systemEnv, timeout: 5000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 65536 });
  assert.equal(versionStdout, metadata.tools.gnu.versionStdout);
  json(join(work, "evidence/setup-only-delta.json"), { from: "missing-prerequisite", to: "configured-prerequisite", addedRegularFiles: [{ path: oracleRelative, sha256: digest(oracle), bytes: lstatSync(oracle).size, versionStdout }], sourceChanges: [], testChanges: [], configChanges: [], environmentChanges: [], explanation: "Both test files hardcode this relative executable; GNU_TAR is explicit runner input, not an API honored by these test bodies. Both child environments use the same absolute target and /usr/bin:/bin PATH. No wrapper substituted for the hash-pinned native executable." });
  const configured = await testPhase(work, metadata, "configured-prerequisite");
  const finalManifest = walk(tree);
  json(join(work, "evidence/after-manifest.json"), finalManifest);
  assert.deepEqual(finalManifest.filter(row => row.path !== oracleRelative), sealed);
  for (const tool of Object.values(metadata.tools)) assert.equal(digest(tool.suppliedPath), tool.sha256);
  json(join(work, "evidence/live-after.json"), captureLive());
  json(join(work, "evidence/cleanup.json"), { ownedRoot: realpathSync(work), retained: ["regular frozen tree", "raw evidence", "recorded native fixture archives"], nativeFixtureRemainders: readdirSync(join(tree, "tests/commands/archive")).filter(name => name.startsWith(".native-test-")), tmpRemainders: readdirSync(join(work, "tmp")), processGroupsAbsent: [baseline.groupAbsent, configured.groupAbsent], primaryToolsRehashedUnchanged: true });
  const calls = readFileSync(join(work, "evidence/configured-prerequisite-trace/calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const finishes = calls.filter(row => row.event === "finish");
  json(join(work, "evidence/summary.json"), { commit, snapshotId: metadata.snapshotId, baseline: baseline.accounting, configured: configured.accounting, actualNativeInvocations: finishes.length, byExecutable: Object.fromEntries(["gtar", "bsdtar"].map(name => [name, finishes.filter(row => row.executable.endsWith(`/${name}`)).length])), historicalFullGateUnchanged: true, noCurrentHeadOrFullGateClaim: true });
  assert.equal(configured.code, 0, "remaining configured semantic failure is preserved, not waived");
  assert.equal(configured.accounting.counters.pass, 11);
  assert.equal(finishes.length, 17);
  assert.equal(calls.filter(row => row.event === "start").length, finishes.length);
  assert.deepEqual(readdirSync(join(work, "tmp")), []);
  console.log(JSON.stringify({ work, snapshotId: metadata.snapshotId, baseline: baseline.accounting.counters, configured: configured.accounting.counters, nativeInvocations: finishes.length }, null, 2));
}

try {
  const [mode, argument] = process.argv.slice(2);
  if (mode === "check-tools") console.log(JSON.stringify(profile(), null, 2));
  else if (mode === "prepare") prepare(workPath(argument));
  else if (mode === "run") await run(workPath(argument));
  else throw new Error("Usage: GNU_TAR=/absolute/existing/gtar node runner.mjs check-tools|prepare /tmp/safe-bash-archive-prerequisites-ID; node runner.mjs run /tmp/safe-bash-archive-prerequisites-ID");
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
}
