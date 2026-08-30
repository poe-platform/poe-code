import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = "tests/commands/archive-stress/pax-independent";
const historical = "tests/commands/archive-stress/final-evidence/gate-3ecvdu";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const hashPattern = /^[a-f0-9]{64}$/u;
const originalAuthor = ["boundaries", "core", "lifecycle", "native", "options", "safety"].map(name => `tests/commands/archive/${name}.test.ts`);
const originalStress = ["acceptance", "native", "long-link-regression", "limits-effects", "hardlink-identity"].map(name => `tests/commands/archive-stress/${name}.test.ts`);
const wiring = "tests/commands/archive/aggregate-integration.test.ts";
const originals = [
  { name: "original-author128", files: originalAuthor, tap: "author-128.tap", count: 128, hash: "931c5b64ec7799d465a8d85c066172773afe0398629bab02d6f70c0d69125423" },
  { name: "original-wiring1", files: [wiring], tap: "default-wiring-1.tap", count: 1, hash: "3e1b36af84e04f1f5e926c0ae4d5a9b3c65721171cdc02bebe370dd96abdaf78" },
  { name: "native-profile-b02-observation-refactored-stress30", files: originalStress, tap: "independent-30.tap", count: 30, hash: "7d7d9aa8bd7d53f8f72115ab2fdc3e4fa1c84b3d19c0af38ada24498fda878d2" },
];
const approvedRefactor = { path: "tests/commands/archive-stress/native.test.ts", before: "c09f07213a209ee4de17ef22d927fbecaee2f2118ce63220d7f429987d7cd2c4", after: "8637e372c0955286bbec9fc1aa9b9465740e212fdbdabb4e31cb272154a10431", classification: "Native-only mtime assertions moved to separately counted P12; original N-in gains direct product byte/time assertions. Same 30 identities, NOT unchanged original oracle." };
const observationPath = "tests/commands/archive-stress/limits-effects.test.ts";
const observationBefore = "b7962d85dd8362b5da7f4df5839fb6e7b1f9cbd19295607252717a4e7018f2ae";
const authorManifestPath = "tests/commands/archive-stress/pax-extensibility-evidence/SHA256SUMS";
const authorManifestHash = "269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f";
const independentNames = [
  "I01 opaque optional bytes cannot change effective size, path, type or literal dot-underscore members",
  "I02 malformed opaque-value framing and checksum mutations fail before publication",
  "I03 essential layout and effective-path controls remain fail-closed beside ignored metadata",
  "I04 discarded values still consume PAX, member, archive and effective-size budgets",
  "I05 fixed local nanoseconds and global precedence have separate virtual and native profile assertions",
  "I06 opaque PAX hardlinks share writes and unsupported publication never copies",
];
const titles = text => text.split("\n").filter(line => line.startsWith("# Subtest: ")).map(line => line.slice(11));
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const gitState = () => ({ head: git("rev-parse", "HEAD"), status: git("status", "--porcelain=v1", "--untracked-files=all"), index: git("diff", "--cached", "--raw") });

assert.deepEqual(process.argv.slice(2, 3), ["--ready"], "Execution requires --ready /absolute/path/to/root-approved-handoff.json; syntax check with node --check only until READY.");
assert.equal(process.argv.length, 4, "Expected exactly --ready PATH");
assert.ok(isAbsolute(process.argv[3]), "READY manifest path must be absolute");
const readyBytes = await readFile(process.argv[3]);
const ready = JSON.parse(readyBytes.toString());
assert.equal(ready.schema, 1);
assert.equal(ready.status, "READY");
assert.equal(ready.author, "01a0409f-da83-78f0-ab8c-8daa6f96e883");
assert.ok(typeof ready.rootAuthorization === "string" && ready.rootAuthorization.trim().length > 0);
assert.ok(typeof ready.authorHandoff === "string" && ready.authorHandoff.trim().length > 0);
assert.ok(/^[a-f0-9]{40}$/u.test(ready.head));
assert.ok(Array.isArray(ready.authorTests) && ready.authorTests.length > 0);
assert.ok(ready.authorTests.every(path => /^tests\/commands\/archive-stress\/pax-[a-z0-9-]+\.test\.ts$/u.test(path)));
assert.equal(new Set(ready.authorTests).size, ready.authorTests.length);
assert.ok(Array.isArray(ready.authorNames) && ready.authorNames.length > 0 && ready.authorNames.every(name => typeof name === "string" && name.length > 0));
assert.equal(new Set(ready.authorNames).size, ready.authorNames.length);
assert.ok(ready.inputs && typeof ready.inputs === "object");
for (const [path, hash] of Object.entries(ready.inputs)) {
  assert.ok(!isAbsolute(path) && !path.split("/").includes("..") && !path.startsWith(`${owned}/runs/`));
  assert.match(hash, hashPattern);
  assert.equal(digest(await readFile(join(root, path))), hash, `READY input drift: ${path}`);
}
for (const path of [...ready.authorTests, observationPath, "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", `${owned}/run.mjs`, `${owned}/fixtures.ts`, `${owned}/controls.test.ts`, `${owned}/observation-control.mjs`, `${owned}/historical-control.mjs`, `${owned}/tsconfig.scope.json`]) assert.ok(ready.inputs[path], `READY manifest missing ${path}`);
assert.equal(ready.historicalControl?.profile, "memory-intact-57a6148");
assert.ok(isAbsolute(ready.historicalControl.root));
assert.equal(ready.historicalControl.evidencePath, `${owned}/runs/run-0N6uc7/evidence.json`);
assert.equal(ready.historicalControl.evidenceSha256, "6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b");
assert.equal(ready.b02?.status, "READY", "separate completed B02 author handoff required");
assert.equal(ready.b02.fixtureSha256, ready.inputs[observationPath]);
for (const key of ["result", "detail"]) {
  assert.ok(isAbsolute(ready.b02[key].path));
  assert.equal(digest(await readFile(ready.b02[key].path)), ready.b02[key].sha256, `B02 ${key} handoff changed`);
}
for (const name of await readdir(join(root, "src/commands/archive"))) if (name.endsWith(".ts")) assert.ok(ready.inputs[`src/commands/archive/${name}`], `READY missing archive source ${name}`);
const observedReadyHead = git("rev-parse", "HEAD");
const observationRefactor = { path: observationPath, before: observationBefore, after: ready.inputs[observationPath], classification: "Restore the original unbound writeStream only after operation/count assertions for over-limit observation; retain identity/bytes/namespace assertions and add exact full-stat equality before proof reads." };

const start = Date.now();
const deadline = start + 900000;
const groups = new Set();
await mkdir(join(root, owned, "runs"), { recursive: true });
const evidence = await mkdtemp(join(root, owned, "runs/run-"));
const privateRoot = await mkdtemp("/tmp/safe-bash-pax-independent-");
const frozen = join(privateRoot, "tree");
const report = { schema: 2, classification: "frozen current source/config/fixture closure with globally equivalent TypeScript inputs; original raw159 remains historical", started: new Date(start).toISOString(), readyPath: process.argv[3], readySha256: digest(readyBytes), ready, observedReadyHead, evidence, frozen, commands: [], limits: { seconds: 900, copiedBytes: 256 * 1024 ** 2, files: 10000, commandOutputBytes: 8 * 1024 ** 2 }, exclusions: ["root .git and dist", "nested node_modules/dependency aliases; root locked dependencies copied once", "old .snapshot*, .oracle build trees, .runs and .native-* scratch", "evidence/-evidence/reports/runs output scopes except explicit historical fixtures", "ignored untracked non-TypeScript outputs; actual compiler closure is added explicitly"], baseline: { original: "158/159 OPEN; stress29/30", root56: "33347b76def1b2cbbe3f399b3be330d3f40e6a50", approvedRefactor }, cleanup: [] };
report.baseline.observationRefactor = observationRefactor;
report.baseline.priorIndependentGate = "176/177 OPEN; run-0N6uc7 and REPORT.md immutable";
const remaining = () => {
  const milliseconds = deadline - Date.now();
  assert.ok(milliseconds > 0, "overall 900-second budget exceeded");
  return milliseconds;
};
function killOwned(pid) {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 * 1024 });
  const rows = (result.stdout ?? "").trim().split("\n").map(line => line.trim().split(/\s+/u).map(Number));
  const descendants = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of rows) if (descendants.has(parent) && !descendants.has(child)) { descendants.add(child); changed = true; }
  }
  for (const target of [...descendants].reverse()) {
    for (const identifier of [-target, target]) {
      try { process.kill(identifier, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") report.cleanup.push({ target: identifier, error: error.message }); }
    }
  }
}
const watchdog = setTimeout(() => {
  for (const pid of groups) killOwned(pid);
  writeFileSync(join(evidence, "watchdog.json"), JSON.stringify({ ...report, error: "overall deadline" }, null, 2));
  process.exit(124);
}, 900000);
const insideRoot = path => path === root.replace(/\/$/u, "") || path.startsWith(root);
const requiredHistorical = [
  "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar",
  ...originals.map(cohort => `${historical}/${cohort.tap}`),
  `${historical}/evidence.json`, `${historical}/native-BSD-in.json`,
  `${historical}/BSD-native.tar`, `${historical}/BSD-native.tar.gz`,
  "tests/commands/archive-stress/final-evidence/ROOTREVIEW.md",
];
let typeClosure;

async function listTypeInputs(directory, label) {
  const canonicalDirectory = await realpath(directory);
  const args = [join(directory, "node_modules/typescript/bin/tsc"), "--listFilesOnly", "--pretty", "false", "-p", "tsconfig.json"];
  const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8", timeout: Math.min(90000, remaining()), maxBuffer: 16 * 1024 * 1024, env: environment });
  await writeFile(join(evidence, `${label}.stdout.log`), result.stdout ?? "", { flag: "wx" });
  await writeFile(join(evidence, `${label}.stderr.log`), result.stderr ?? "", { flag: "wx" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `TypeScript input discovery failed: ${label}: ${result.stderr}`);
  const paths = result.stdout.trim().split("\n").filter(Boolean).map(path => {
    assert.ok(isAbsolute(path), `compiler output is not a path: ${path}`);
    const lexical = relative(directory, path);
    const normalized = lexical.startsWith("../") ? relative(canonicalDirectory, path) : lexical;
    assert.ok(!normalized.startsWith("../") && !isAbsolute(normalized), `compiler input escapes capture root: ${path}`);
    assert.ok(!normalized.includes("/node_modules/") || normalized.startsWith("node_modules/"), `global typing requires unapproved nested dependency: ${path}`);
    return normalized;
  }).sort();
  return { label, args, status: result.status, files: paths, total: paths.length, project: paths.filter(path => !path.startsWith("node_modules/")).length, dependency: paths.filter(path => path.startsWith("node_modules/")).length, sha256: digest(JSON.stringify(paths)) };
}

function exclusionReason(path) {
  if (path.startsWith("src/")) return undefined;
  const parents = path.split("/").slice(0, -1);
  if (parents.some(part => part === "node_modules")) return "dependency copies/aliases excluded; root packages copied once";
  if (parents.some(part => part === ".git" || part === "dist" || part === ".oracle" || part === ".runs" || part.startsWith(".snapshot") || part === "build-snapshot" || part.startsWith(".native-"))) return "historical generated snapshot/oracle/scratch output, not current source";
  if (parents.some(part => part === "evidence" || part.endsWith("-evidence") || part === "reports" || part === "runs")) return "evidence/report output; needed typed source and historical fixtures handled explicitly";
  const filename = path.split("/").at(-1);
  const fixture = parents.some(part => /fixtures?|testdata|golden/u.test(part)) || /fixture|\.expected\./u.test(filename);
  if (!fixture && /\.(?:tap|log|stdout|stderr|sha256|tar|tgz|gz|zip)$/u.test(filename)) return "generated transcripts/checksum/archive outputs, not this gate's runtime fixtures";
  if (!fixture && filename.endsWith(".json") && !/^(?:package(?:-lock)?|tsconfig[^/]*|[^/]*schema[^/]*)\.json$/u.test(filename) && !path.startsWith("tests/commands/archive/")) return "non-config result JSON; legitimate named fixtures and actual compiler inputs retained separately";
  return undefined;
}

async function auditAuthorManifest() {
  const bytes = await readFile(join(root, authorManifestPath));
  assert.equal(digest(bytes), authorManifestHash, "author manifest changed after handoff");
  const entries = [];
  for (const line of bytes.toString().trim().split("\n")) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match && !isAbsolute(match[2]) && !match[2].split("/").includes(".."), "invalid author manifest record");
    const sha256 = digest(await readFile(join(root, match[2])));
    assert.equal(sha256, match[1], `author input/evidence drift: ${match[2]}`);
    entries.push({ path: match[2], sha256 });
  }
  assert.equal(entries.length, 167, "author manifest denominator changed");
  return { path: authorManifestPath, sha256: authorManifestHash, count: entries.length, entries };
}

async function auditHistoricalEvidence() {
  const document = JSON.parse(await readFile(join(root, "tests/commands/archive-stress/pax-extensibility-evidence/final-HFChdx/evidence.json"), "utf8"));
  const expected = document.protectedEvidenceBefore;
  const files = [];
  for (const entry of expected.files) {
    remaining();
    const sha256 = digest(await readFile(join(root, entry.path)));
    assert.equal(sha256, entry.sha256, `historical stage evidence changed: ${entry.path}`);
    files.push({ path: entry.path, sha256 });
  }
  return { count: files.length, authorManifestHash: expected.sha256, sha256: digest(JSON.stringify(files)), files };
}

async function auditPriorCheckpoints() {
  assert.equal(digest(await readFile(join(root, owned, "FINAL-REVIEW.md"))), "65f06144aec10c57e2dac7800c45db921c92cd41a8d26dc6a9f5d592f849448f", "historical FINAL-REVIEW.md changed");
  assert.equal(digest(await readFile(join(root, owned, "runs/run-x0G87j/evidence.json"))), "b7cbe9c7eccd5a8fd09fbfb33ae7fe9df9a0fca1f6892fcb66599fba736898d6", "historical driver failure changed");
  assert.equal(digest(await readFile(join(root, owned, "REPORT.md"))), "aad80f8f9e48068b29b64877521c7608c3b2e4eda3116db7a60358690bde811a", "historical REPORT.md changed");
  assert.equal(digest(await readFile(join(root, owned, "runs/run-0N6uc7/evidence.json"))), "6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b", "historical176/177 evidence changed");
  const files = [];
  async function visit(path) {
    const metadata = await lstat(join(root, path));
    if (metadata.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) await visit(`${path}/${name}`);
    } else {
      assert.ok(metadata.isFile(), `historical evidence alias: ${path}`);
      files.push({ path, sha256: digest(await readFile(join(root, path))) });
    }
  }
  for (const name of ["run-9Q9lJM", "run-0N6uc7", "run-x0G87j"]) await visit(`${owned}/runs/${name}`);
  for (const name of ["REPORT.md", "FINAL-REVIEW.md", "final-audit.json"]) await visit(`${owned}/${name}`);
  return { count: files.length, sha256: digest(JSON.stringify(files)), files };
}

async function inventory() {
  const entries = [];
  const exclusions = [];
  const selected = new Set();
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  for (const path of result.stdout.toString().split("\0").filter(Boolean)) {
    const reason = exclusionReason(path);
    if (reason) exclusions.push({ path, reason });
    else selected.add(path);
  }
  for (const path of typeClosure.files) {
    if (path.startsWith("node_modules/")) continue;
    assert.ok(!path.split("/").some(part => part === ".oracle" || part.startsWith(".snapshot") || part === "build-snapshot"), `global compiler unexpectedly includes old generated snapshot: ${path}`);
    selected.add(path);
  }
  for (const path of requiredHistorical) selected.add(path);
  let bytes = 0;
  async function add(path, dependency = false) {
    remaining();
    const source = join(root, path);
    const physical = await realpath(source);
    assert.ok(insideRoot(physical), `input alias escapes repository: ${path}`);
    const original = await lstat(source);
    const metadata = await stat(source);
    if (metadata.isDirectory()) {
      assert.ok(dependency && !original.isSymbolicLink(), `directory/symlink selected as input: ${path}`);
      for (const name of (await readdir(source)).sort()) await add(`${path}/${name}`, true);
      return;
    }
    assert.ok(dependency || physical === source, `nondependency input alias prohibited: ${path}`);
    if (dependency) assert.ok(physical.startsWith(join(root, "node_modules") + "/"), `dependency escapes root tooling: ${path}`);
    assert.ok(metadata.isFile(), `nonregular input: ${path}`);
    bytes += metadata.size;
    assert.ok(bytes <= report.limits.copiedBytes && entries.length < report.limits.files, "input capture bound exceeded");
    const content = await readFile(source);
    const binShim = original.isSymbolicLink() && path.startsWith("node_modules/.bin/");
    const transformed = binShim ? Buffer.from(`#!/bin/sh\nexec ${quote(join(frozen, relative(root, physical)))} "$@"\n`) : content;
    entries.push({ path, physical: relative(root, physical), symlink: original.isSymbolicLink(), bytes: content.length, sha256: digest(content), mode: metadata.mode & 0o777, copiedBytes: transformed.length, copiedSha256: digest(transformed), binShim });
  }
  for (const path of [...selected].sort()) await add(path);
  await add("node_modules", true);
  entries.sort((first, second) => first.path.localeCompare(second.path));
  return { sha256: digest(JSON.stringify(entries)), bytes, excludedFiles: exclusions, files: entries, requiredHistorical };
}

async function copyInputs(manifest) {
  for (const entry of manifest.files) {
    remaining();
    const content = await readFile(join(root, entry.path));
    assert.equal(digest(content), entry.sha256, `copy race: ${entry.path}`);
    const destination = join(frozen, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    const copied = entry.binShim ? Buffer.from(`#!/bin/sh\nexec ${quote(join(frozen, entry.physical))} "$@"\n`) : content;
    await writeFile(destination, copied, { flag: "wx", mode: entry.mode });
    await chmod(destination, entry.mode);
    const originalStat = await stat(join(root, entry.path));
    const copiedStat = await lstat(destination);
    assert.ok(copiedStat.isFile() && copiedStat.nlink === 1 && !(copiedStat.dev === originalStat.dev && copiedStat.ino === originalStat.ino), `copy alias: ${entry.path}`);
  }
}

async function verifyFrozen(manifest) {
  const verified = [];
  for (const entry of manifest.files) {
    remaining();
    const path = join(frozen, entry.path);
    const metadata = await lstat(path);
    assert.ok(metadata.isFile() && metadata.nlink === 1, `frozen alias: ${entry.path}`);
    assert.equal(metadata.mode & 0o777, entry.mode, `frozen mode drift: ${entry.path}`);
    const sha256 = digest(await readFile(path));
    assert.equal(sha256, entry.copiedSha256, `frozen input drift: ${entry.path}`);
    verified.push({ path: entry.path, sha256 });
  }
  return digest(JSON.stringify(verified));
}

async function verifyLockedDependencies(base) {
  const lock = JSON.parse(await readFile(join(frozen, base, "package-lock.json"), "utf8"));
  const installed = [];
  async function scan(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith(".")) continue;
      const path = join(directory, name);
      if (name.startsWith("@")) { await scan(path); continue; }
      const metadata = await lstat(path);
      if (!metadata.isDirectory()) continue;
      const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      const location = relative(join(frozen, base), path);
      const expected = lock.packages[location];
      assert.ok(expected && expected.integrity && expected.version === pkg.version, `unlocked/version-mismatched installed package: ${location}`);
      installed.push({ path: location, name: pkg.name, version: pkg.version, integrity: expected.integrity });
      try { await scan(join(path, "node_modules")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  await scan(join(frozen, base, "node_modules"));
  for (const [path, expected] of Object.entries(lock.packages)) {
    if (!path || expected.optional) continue;
    assert.ok(installed.some(pkg => pkg.path === path), `required locked dependency absent: ${base}/${path}`);
  }
  return { base, lockSha256: digest(await readFile(join(frozen, base, "package-lock.json"))), installed, integrityQualification: "versions and integrity metadata checked offline; package content hashes sealed; registry tarball integrity not re-established" };
}

const environment = { ...process.env };
const clearedEnvironment = ["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "BASH_ENV", "ENV", "TSX_TSCONFIG_PATH", "TSX_PROJECT", "ESBUILD_BINARY_PATH", ...Object.keys(environment).filter(name => name.startsWith("TS_NODE_") || name.startsWith("ARCHIVE_") || name.toLowerCase().startsWith("npm_config_"))];
for (const name of clearedEnvironment) delete environment[name];
const controlledEnvironment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1", npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_cache: join(privateRoot, "npm-cache"), npm_config_userconfig: join(privateRoot, "empty-npmrc"), npm_config_script_shell: "/bin/sh" };
Object.assign(environment, controlledEnvironment);

async function run(name, executable, args, milliseconds = 120000, cwd = frozen) {
  const directory = join(evidence, name);
  await mkdir(directory);
  const started = Date.now();
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  let limited = false;
  let timedOut = false;
  const child = spawn(executable, args, { cwd, env: { ...environment, TMPDIR: privateRoot, ARCHIVE_LONG_LINK_NATIVE: "1", ARCHIVE_ACCEPTANCE_SOURCE: join(cwd, "src/commands/archive/index.ts"), ARCHIVE_ACCEPTANCE_EVIDENCE: directory, ARCHIVE_PAX_EVIDENCE: directory }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  if (child.pid) groups.add(child.pid);
  const kill = () => { if (child.pid) killOwned(child.pid); };
  const timer = setTimeout(() => { timedOut = true; kill(); }, Math.min(milliseconds, remaining()));
  const collect = chunks => chunk => {
    outputBytes += chunk.length;
    if (outputBytes > report.limits.commandOutputBytes) { limited = true; kill(); }
    else chunks.push(Buffer.from(chunk));
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  const result = await new Promise(resolveResult => {
    child.once("error", error => resolveResult({ status: null, signal: null, error: error.message }));
    child.once("close", (status, signal) => resolveResult({ status, signal }));
  });
  clearTimeout(timer);
  if (child.pid) { kill(); groups.delete(child.pid); }
  const text = Buffer.concat(stdout).toString();
  await writeFile(join(directory, "stdout.log"), Buffer.concat(stdout));
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr));
  const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const command = { name, executable, args, cwd, ...result, timedOut, limited, outputBytes, elapsedMs: Date.now() - started, counts, names: titles(text), failures: text.split("\n").filter(line => line.startsWith("not ok ")), stdoutSha256: digest(Buffer.concat(stdout)), stderrSha256: digest(Buffer.concat(stderr)) };
  report.commands.push(command);
  return command;
}

try {
  report.gitBefore = gitState();
  await writeFile(join(evidence, "ready.json"), readyBytes);
  report.authorManifestBefore = await auditAuthorManifest();
  report.historicalBefore = await auditHistoricalEvidence();
  report.priorCheckpointsBefore = await auditPriorCheckpoints();
  typeClosure = await listTypeInputs(root, "global-inputs-live-before");
  report.typeClosureLiveBefore = typeClosure;
  report.inputs = await inventory();
  await copyInputs(report.inputs);
  report.frozenBefore = await verifyFrozen(report.inputs);
  report.sealLive = await inventory();
  assert.equal(report.sealLive.sha256, report.inputs.sha256, "live tree changed while sealing; no product was run, request a new READY window");
  report.sealedGit = gitState();
  report.typeClosureFrozenBefore = await listTypeInputs(frozen, "global-inputs-frozen-before");
  assert.deepEqual(report.typeClosureFrozenBefore.files, typeClosure.files, "global TypeScript input closure is not equivalent; do not execute a partial global gate");
  report.globalInputEquivalence = true;
  report.dependencies = [await verifyLockedDependencies("")];
  report.generatedBinShims = report.inputs.files.filter(entry => entry.binShim);
  report.environment = { controlled: controlledEnvironment, clearedNames: clearedEnvironment, otherInheritedValues: "not recorded" };
  await writeFile(controlledEnvironment.npm_config_userconfig, "", { flag: "wx", mode: 0o600 });
  const packageMetadata = JSON.parse(await readFile(join(frozen, "package.json"), "utf8"));
  assert.equal(packageMetadata.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageMetadata.scripts.build, "tsc -p tsconfig.build.json");
  for (const script of ["pretypecheck", "posttypecheck", "prebuild", "postbuild"]) assert.equal(packageMetadata.scripts[script], undefined, `unreviewed npm lifecycle hook: ${script}`);
  report.node = { path: process.execPath, version: process.version, sha256: digest(await readFile(process.execPath)), platform: process.platform, arch: process.arch };
  const npmPath = await realpath(join(dirname(process.execPath), "npm"));
  report.npm = { path: npmPath, sha256: digest(await readFile(npmPath)) };
  const gnuPath = join(frozen, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar");
  report.gnu = { path: gnuPath, sha256: digest(await readFile(gnuPath)) };
  assert.equal(report.gnu.sha256, "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
  report.bsd = { path: "/usr/bin/bsdtar", sha256: digest(await readFile("/usr/bin/bsdtar")) };
  assert.equal(report.bsd.sha256, "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9");
  const baselineBytes = await readFile(join(frozen, historical, "evidence.json"));
  assert.equal(digest(baselineBytes), "c794511fe12403bf8e9301855750eb171e8c8d117623848e5b8961e1a131941b");
  const baseline = JSON.parse(baselineBytes.toString());
  const originalPaths = [...originalAuthor, ...originalStress, wiring, "tests/commands/archive/built-package.mjs", "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/helpers.ts", "tests/commands/archive-stress/fixtures.ts"];
  for (const path of originalPaths) {
    const original = baseline.sealedInput.files.find(entry => entry.path === path);
    assert.ok(original, `original fixture absent from historical manifest: ${path}`);
    if (path === approvedRefactor.path) assert.equal(original.sha256, approvedRefactor.before);
    if (path === observationPath) assert.equal(original.sha256, observationBefore);
    const expected = path === approvedRefactor.path ? approvedRefactor.after : path === observationPath ? observationRefactor.after : original.sha256;
    assert.equal(digest(await readFile(join(frozen, path))), expected, `original corpus changed beyond approved profile refactor: ${path}`);
  }
  const historicalPrefix = "tests/commands/archive-stress/";
  report.protectedBefore = report.inputs.files.filter(entry => entry.path.startsWith(historicalPrefix) && !entry.path.startsWith(`${owned}/`)).map(({ path, sha256 }) => ({ path, sha256 }));
  for (const cohort of originals) {
    const content = await readFile(join(frozen, historical, cohort.tap));
    assert.equal(digest(content), cohort.hash);
    cohort.names = titles(content.toString());
    assert.equal(cohort.names.length, cohort.count);
  }
  await run("gnu-version", gnuPath, ["--version"], 5000);
  await run("bsd-version", "/usr/bin/bsdtar", ["--version"], 5000);
  const historicalRoot = await realpath(ready.historicalControl.root);
  const observation = await run("historical-observation-control", process.execPath, ["--unhandled-rejections=strict", "--import", join(historicalRoot, "node_modules/tsx/dist/loader.mjs"), join(frozen, owned, "historical-control.mjs"), historicalRoot, join(root, ready.historicalControl.evidencePath)], 15000, historicalRoot);
  observation.accounting = "Separate pinned historical control, three phases: no-tar, over-limit unchanged effects, positive publication witness. Not added to main177. Unchanged omission assertions do not target current MemoryFS.";
  observation.provenance = ready.historicalControl;
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", "--test-concurrency=1"];
  for (const cohort of [...originals, { name: "author-targets", files: ready.authorTests, names: ready.authorNames, count: ready.authorNames.length }, { name: "independent6", files: [`${owned}/controls.test.ts`], names: independentNames, count: 6 }]) {
    const command = await run(cohort.name, process.execPath, [...testArgs, ...cohort.files]);
    command.expectedNames = cohort.names;
    command.identityMatch = JSON.stringify(command.names) === JSON.stringify(cohort.names);
    command.expectedCount = cohort.count;
    command.countMatch = command.counts.tests === cohort.count;
  }
  await run("scoped-types", process.execPath, ["node_modules/typescript/bin/tsc", "-p", `${owned}/tsconfig.scope.json`], 90000);
  await run("global-typecheck", npmPath, ["run", "typecheck"], 180000);
  const build = await run("global-build", npmPath, ["run", "build"], 180000);
  const built = await run("built4", process.execPath, ["tests/commands/archive/built-package.mjs"], 60000);
  built.validFreshBuild = build.status === 0;
  built.reportedFourChecks = (await readFile(join(evidence, "built4/stdout.log"), "utf8")).includes("Built archive checks: 4/4 (API, zero runtime dependencies, gzip pipeline, listing pipeline)");
  report.frozenAfter = await verifyFrozen(report.inputs);
  report.typeClosureFrozenAfter = await listTypeInputs(frozen, "global-inputs-frozen-after");
  assert.deepEqual(report.typeClosureFrozenAfter.files, typeClosure.files, "post-run global input closure changed");
  report.typeClosureLiveAfter = await listTypeInputs(root, "global-inputs-live-after");
  const liveAfter = await inventory();
  report.liveAfterSha256 = liveAfter.sha256;
  report.movingTreeStable = liveAfter.sha256 === report.inputs.sha256;
  const afterMap = new Map(liveAfter.files.map(entry => [entry.path, entry.sha256]));
  report.protectedEvidenceStable = report.protectedBefore.every(entry => afterMap.get(entry.path) === entry.sha256);
  report.authorManifestAfter = await auditAuthorManifest();
  report.historicalAfter = await auditHistoricalEvidence();
  report.historicalStable = report.historicalBefore.sha256 === report.historicalAfter.sha256;
  report.priorCheckpointsAfter = await auditPriorCheckpoints();
  report.priorCheckpointsStable = report.priorCheckpointsBefore.sha256 === report.priorCheckpointsAfter.sha256;
  report.toolingStable = digest(await readFile(process.execPath)) === report.node.sha256 && digest(await readFile(npmPath)) === report.npm.sha256 && digest(await readFile("/usr/bin/bsdtar")) === report.bsd.sha256;
  const mainCommands = report.commands.filter(command => command.expectedCount !== undefined);
  const allNames = mainCommands.flatMap(command => command.names);
  report.accounting = { mainTests: mainCommands.reduce((total, command) => total + (command.counts.tests ?? 0), 0), uniqueNames: new Set(allNames).size, duplicateNames: allNames.filter((name, index) => allNames.indexOf(name) !== index), nativeOnlyAuthorIdentity: "P12 native-only global/local mtime profiles are explicit, not virtual acceptance expectations", mixedIndependentNativeIdentity: independentNames[4], builtChecksSeparate: 4 };
  report.gatePass = report.commands.every(command => command.status === 0 && !command.timedOut && !command.limited && command.identityMatch !== false && command.countMatch !== false && (command.counts.skipped ?? 0) === 0 && (command.counts.cancelled ?? 0) === 0 && (command.counts.todo ?? 0) === 0) && report.protectedEvidenceStable && report.historicalStable && report.priorCheckpointsStable && report.toolingStable && built.validFreshBuild && built.reportedFourChecks && report.accounting.duplicateNames.length === 0;
  report.nativeConflict = "Historical original raw159 remains158/159, stress29/30; prior independent gate remains176/177. New30 preserves IDs with the reviewed native-only assertion move to P12 plus B02 observation-surface correction and stronger full-stat assertion; it is native-profile AND B02-observation refactored, not an unchanged oracle. P12 and I05 retain exact BSD missing-global conflict. Literal ._ members remain product files.";
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  report.gatePass = false;
} finally {
  for (const pid of groups) killOwned(pid);
  clearTimeout(watchdog);
  report.finished = new Date().toISOString();
  report.elapsedMs = Date.now() - start;
  report.gitAfter = gitState();
  await writeFile(join(evidence, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Evidence: ${join(evidence, "evidence.json")}`);
  console.log(`Retained full current-input snapshot: ${frozen}`);
  console.log("Historical raw159, profile-refactored30, author targets, independent6 and built checks remain separate; see evidence accounting.");
  process.exitCode = report.gatePass ? 0 : 1;
}
