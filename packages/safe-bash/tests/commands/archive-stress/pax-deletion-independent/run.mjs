import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = "tests/commands/archive-stress/pax-deletion-independent";
const acceptedOwned = "tests/commands/archive-stress/pax-independent";
const acceptedEvidencePath = `${acceptedOwned}/runs/run-Xznyqe/evidence.json`;
const acceptedEvidenceHash = "3f283022c42a1f0fef7a734daa2fabf5ceae3daa9387a66030ac8c33344e7a70";
const legacyPath = "tests/commands/archive/options.test.ts";
const transportPath = "tests/commands/archive/options.legacy.mts";
const legacyHash = "34e3aa6ac71cc7078371502255c7880994ef0644ecf00dc8da351e785532d66f";
const legacyIdentity = "PAX global/local precedence, deletion and embedded newline";
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
  "D01 local timestamp tombstones mask raw/global once, including excluded real members",
  "D02 global deletion persists per key across unrelated globals and temporary local values",
  "D03 duplicate records and consecutive local headers use last value without losing tombstones",
  "D04 only effective raw fields are decoded and effective sizes preserve following framing",
  "D05 required tombstones reject before member body/effects and cannot resurrect GNU long fallbacks",
  "D06 paired timestamp restoration preserves deleted counterparts with fresh stat and propagates failure",
  "D07 deletion/overrides never bypass structural framing, strict PAX grammar or byte/path limits",
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
assert.ok(ready.authorTests.every(path => path === "tests/commands/archive/pax-deletion.test.ts"));
assert.equal(new Set(ready.authorTests).size, ready.authorTests.length);
assert.ok(Array.isArray(ready.authorNames) && ready.authorNames.length > 0 && ready.authorNames.every(name => typeof name === "string" && name.length > 0));
assert.equal(new Set(ready.authorNames).size, ready.authorNames.length);
assert.ok(ready.inputs && typeof ready.inputs === "object");
for (const [path, hash] of Object.entries(ready.inputs)) {
  assert.ok(!isAbsolute(path) && !path.split("/").includes("..") && !path.startsWith(`${owned}/runs/`));
  assert.match(hash, hashPattern);
  assert.equal(digest(await readFile(join(root, path))), hash, `READY input drift: ${path}`);
}
for (const path of [...ready.authorTests, legacyPath, observationPath, "src/commands/archive/README.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", `${owned}/run.mjs`, `${owned}/helpers.ts`, `${owned}/controls.test.ts`, `${owned}/tsconfig.scope.json`, `${acceptedOwned}/fixtures.ts`, `${acceptedOwned}/controls.test.ts`, `${acceptedOwned}/historical-control.mjs`, `${acceptedOwned}/observation-control.mjs`]) assert.ok(ready.inputs[path], `READY manifest missing ${path}`);
assert.equal(ready.deletionHandoff?.status, "READY");
assert.equal(ready.deletionHandoff.path, "/tmp/safe-bash-pax-deletion-author-detail.txt");
assert.equal(digest(await readFile(ready.deletionHandoff.path)), ready.deletionHandoff.sha256, "author deletion handoff drift");
assert.equal(ready.legacyCorrection?.reviewed, true);
assert.equal(ready.legacyCorrection.before, legacyHash);
assert.equal(ready.legacyCorrection.after, ready.inputs[legacyPath]);
assert.equal(ready.legacyCorrection.identity, legacyIdentity);
assert.equal(ready.legacyCorrection.transport, transportPath);
assert.equal(ready.research?.detailSha256, "f45b65178bddf4f63c970dd0bac4a02067b9e6fc3d33afa9b8518f87d30808b2");
assert.equal(digest(await readFile("/tmp/safe-bash-pax-deletion-research-detail.txt")), ready.research.detailSha256);
assert.equal(digest(await readFile("/tmp/safe-bash-pax-deletion-native-evidence.json")), "bc055d5449cc943a9283c8f3b40fd8a19ca2803b3c2d14bc171e30b08f2ac82e");
assert.ok(Array.isArray(ready.authorEvidence) && ready.authorEvidence.length > 0);
for (const entry of ready.authorEvidence) {
  assert.ok(!isAbsolute(entry.path) && !entry.path.split("/").includes(".."));
  assert.equal(digest(await readFile(join(root, entry.path))), entry.sha256, `author evidence drift: ${entry.path}`);
}
const acceptedBytes = await readFile(join(root, acceptedEvidencePath));
assert.equal(digest(acceptedBytes), acceptedEvidenceHash);
const accepted = JSON.parse(acceptedBytes);
const acceptedRoot = await realpath(accepted.frozen);
assert.equal(await realpath(ready.baseline.root), acceptedRoot);
assert.equal(ready.baseline.evidenceSha256, acceptedEvidenceHash);
assert.equal(ready.historicalControl?.profile, "memory-intact-57a6148");
assert.ok(isAbsolute(ready.historicalControl.root));
assert.equal(ready.historicalControl.evidencePath, `${acceptedOwned}/runs/run-0N6uc7/evidence.json`);
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
const privateRoot = await mkdtemp("/tmp/safe-bash-pax-deletion-independent-");
const frozen = join(privateRoot, "tree");
const report = { schema: 2, classification: "frozen current source/config/fixture closure with globally equivalent TypeScript inputs; original raw159 remains historical", started: new Date(start).toISOString(), readyPath: process.argv[3], readySha256: digest(readyBytes), ready, observedReadyHead, evidence, frozen, commands: [], limits: { seconds: 900, copiedBytes: 256 * 1024 ** 2, files: 10000, commandOutputBytes: 8 * 1024 ** 2 }, exclusions: ["root .git and dist", "nested node_modules/dependency aliases; root locked dependencies copied once", "old .snapshot*, .oracle build trees, .runs and .native-* scratch", "evidence/-evidence/reports/runs output scopes except explicit historical fixtures", "ignored untracked non-TypeScript outputs; actual compiler closure is added explicitly"], baseline: { original: "158/159 OPEN; stress29/30", root56: "33347b76def1b2cbbe3f399b3be330d3f40e6a50", approvedRefactor }, cleanup: [] };
report.baseline.observationRefactor = observationRefactor;
report.classification = "Separate historical baseline literal177, patched literal177, corrected177, author-new and independent-new; globally equivalent current frozen inputs";
report.baseline.priorIndependentGate = "Original158/159, prior176/177 and driver failure immutable; accepted177 at run-Xznyqe remains historical";
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
  `${historical}/BSD-native.tar`,
  `${historical}/BSD-native.tar.gz`,
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
  if (path.startsWith(`${acceptedOwned}/`) && !["fixtures.ts", "controls.test.ts", "historical-control.mjs", "observation-control.mjs"].some(name => path === `${acceptedOwned}/${name}`)) return "accepted reports/driver/evidence audited in place; only unchanged runtime controls copied";
  if (path.startsWith("benchmarks/") || path.startsWith("docs/upstream-patches/")) return "unrelated comparator/upstream-engine material; any actual global compiler input is added explicitly";
  const parents = path.split("/").slice(0, -1);
  if (parents.some(part => part === "node_modules")) return "dependency copies/aliases excluded; root packages copied once";
  if (parents.some(part => part === ".git" || part === "dist" || part === ".oracle" || part === ".runs" || part.startsWith(".snapshot") || part === "build-snapshot" || part.startsWith(".native-"))) return "historical generated snapshot/oracle/scratch output, not current source";
  if (parents.some(part => part === "evidence" || part.endsWith("-evidence") || part === "reports" || part === "runs")) return "evidence/report output; needed typed source and historical fixtures handled explicitly";
  const filename = path.split("/").at(-1);
  const fixture = parents.some(part => /fixtures?|testdata|golden/u.test(part)) || /fixture|\.expected\./u.test(filename);
  if (!fixture && /^(?:REPORT|FINAL-REVIEW|ACCEPTANCE|ROOTREVIEW)(?:\.[^.]+)?\.md$/u.test(filename) && !path.startsWith(`${owned}/`)) return "historical report output, not runtime source; audited separately where required";
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
    if (match[2].startsWith("src/commands/archive/")) {
      assert.equal(digest(await readFile(join(acceptedRoot, match[2]))), match[1], `accepted archive source drift: ${match[2]}`);
      assert.equal(sha256, ready.inputs[match[2]], `new archive source not bound by READY: ${match[2]}`);
    } else assert.equal(sha256, match[1], `historical author evidence drift: ${match[2]}`);
    entries.push({ path: match[2], sha256, historicalSha256: match[1] });
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
  const result = spawnSync("git", ["ls-tree", "-r", "-z", "3f40603372bd07c5390a2370a252da8055de1865", "--", acceptedOwned, "tests/commands/archive-stress/b02-observation-evidence"], { cwd: root, maxBuffer: 4 * 1024 ** 2 });
  assert.equal(result.status, 0);
  const files = [];
  for (const line of result.stdout.toString().split("\0").filter(Boolean)) {
    const [description, path] = line.split("\t");
    const [mode, type, oid] = description.split(" ");
    assert.equal(type, "blob");
    assert.ok(mode === "100644" || mode === "100755");
    const bytes = await readFile(join(root, path));
    const object = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(object, oid, `immutable accepted evidence changed: ${path}`);
    files.push({ path, sha256: digest(bytes) });
  }
  assert.equal(files.length, 273);
  return { count: files.length, sha256: digest(JSON.stringify(files)), files };
}

async function verifyAcceptedSnapshot() {
  const verified = [];
  for (const entry of accepted.inputs.files) {
    remaining();
    const path = join(acceptedRoot, entry.path);
    const metadata = await lstat(path);
    assert.ok(metadata.isFile() && metadata.nlink === 1, `baseline alias: ${entry.path}`);
    assert.equal(await realpath(path), path);
    assert.equal(metadata.mode & 0o777, entry.mode);
    const sha256 = digest(await readFile(path));
    assert.equal(sha256, entry.copiedSha256, `baseline input drift: ${entry.path}`);
    verified.push({ path: entry.path, sha256 });
  }
  const sha256 = digest(JSON.stringify(verified));
  assert.equal(sha256, accepted.frozenBefore);
  return { root: acceptedRoot, count: verified.length, sha256, evidenceSha256: acceptedEvidenceHash, classification: "historical full-root replay, NOT source-only causal isolation from the newer patched root" };
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

async function describeBuildOutputs() {
  const typescript = (await import(pathToFileURL(join(frozen, "node_modules/typescript/lib/typescript.js")).href)).default;
  const configPath = join(frozen, "tsconfig.build.json");
  const parsed = typescript.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...typescript.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) { throw new Error(typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); },
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.options.outDir && parsed.options.rootDir);
  assert.equal(parsed.options.outFile, undefined);
  assert.equal(parsed.options.incremental, undefined);
  assert.equal(parsed.options.composite, undefined);
  const outDir = relative(frozen, parsed.options.outDir);
  assert.ok(outDir && !isAbsolute(outDir) && !outDir.startsWith("../"));
  assert.ok(!["src", "tests", "node_modules"].some(path => outDir === path || outDir.startsWith(`${path}/`)));
  const outputs = new Set();
  for (const input of parsed.fileNames) {
    assert.ok(input.startsWith(join(frozen, "src") + "/"), `build input escapes source scope: ${input}`);
    for (const output of typescript.getOutputFileNames(parsed, input, false)) {
      const path = relative(frozen, output);
      assert.ok(path.startsWith(`${outDir}/`) && !path.split("/").includes(".."), `undeclared output destination: ${path}`);
      outputs.add(path);
    }
  }
  assert.ok(outputs.size > 0);
  const initialGeneratedTypeInputs = [];
  for (const path of typeClosure.files.filter(path => path.startsWith(`${outDir}/`))) {
    assert.ok(outputs.has(path), `global generated input is not a declared build output: ${path}`);
    initialGeneratedTypeInputs.push({ path, sha256: digest(await readFile(join(frozen, path))) });
  }
  return { configPath: "tsconfig.build.json", configSha256: digest(await readFile(configPath)), compilerSha256: digest(await readFile(join(frozen, "node_modules/typescript/lib/typescript.js"))), outDir, sourceInputs: parsed.fileNames.map(path => relative(frozen, path)).sort(), declaredOutputs: [...outputs].sort(), initialGeneratedTypeInputs, semantics: "All inputs immutable through pre-build; only exact compiler-declared outputs may change during build; non-output inputs remain immutable throughout." };
}

async function observeFrozenTree() {
  const files = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      remaining();
      const path = join(directory, name);
      const metadata = await lstat(path);
      assert.ok(!metadata.isSymbolicLink(), `frozen tree alias: ${path}`);
      if (metadata.isDirectory()) await visit(path);
      else {
        assert.ok(metadata.isFile() && metadata.nlink === 1, `nonregular/shared frozen entry: ${path}`);
        files.push({ path: relative(frozen, path), mode: metadata.mode & 0o777, bytes: metadata.size, sha256: digest(await readFile(path)) });
      }
    }
  }
  await visit(frozen);
  files.sort((first, second) => first.path.localeCompare(second.path));
  return { sha256: digest(JSON.stringify(files)), files };
}

function enforceBuildChanges(before, after, allowedOutputs) {
  const previous = new Map(before.files.map(entry => [entry.path, entry]));
  const current = new Map(after.files.map(entry => [entry.path, entry]));
  const changes = [];
  for (const path of [...new Set([...previous.keys(), ...current.keys()])].sort()) {
    if (JSON.stringify(previous.get(path)) === JSON.stringify(current.get(path))) continue;
    assert.ok(allowedOutputs.has(path), `build changed an undeclared output/input: ${path}`);
    changes.push({ path, before: previous.get(path) ?? null, after: current.get(path) ?? null, classification: "declared build output" });
  }
  return changes;
}

async function observeCapturedInputs(manifest) {
  const files = [];
  for (const entry of manifest.files) files.push({ path: entry.path, sha256: digest(await readFile(join(frozen, entry.path))) });
  return { sha256: digest(JSON.stringify(files)), files };
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
  report.acceptedSnapshotBefore = await verifyAcceptedSnapshot();
  typeClosure = await listTypeInputs(root, "global-inputs-live-before");
  report.typeClosureLiveBefore = typeClosure;
  report.inputs = await inventory();
  await copyInputs(report.inputs);
  report.frozenBefore = await verifyFrozen(report.inputs);
  const legacyBytes = await readFile(join(acceptedRoot, legacyPath));
  assert.equal(digest(legacyBytes), legacyHash);
  assert.equal(report.inputs.files.some(entry => entry.path === transportPath), false, "legacy transport must never exist in the live source capture");
  await writeFile(join(frozen, transportPath), legacyBytes, { flag: "wx", mode: 0o644 });
  const legacyMetadata = await lstat(join(frozen, transportPath));
  assert.ok(legacyMetadata.isFile() && legacyMetadata.nlink === 1);
  report.legacyTransport = { original: legacyPath, path: transportPath, sha256: digest(legacyBytes), bytes: legacyBytes.length, scope: "temporary frozen test sibling only; exact bytes/relative imports unchanged; separately scoped typed" };
  report.completeFrozenBefore = digest(JSON.stringify({ sourceClosure: report.frozenBefore, legacyTransport: report.legacyTransport }));
  report.sealLive = await inventory();
  assert.equal(report.sealLive.sha256, report.inputs.sha256, "live tree changed while sealing; no product was run, request a new READY window");
  report.sealedGit = gitState();
  report.typeClosureFrozenBefore = await listTypeInputs(frozen, "global-inputs-frozen-before");
  assert.deepEqual(report.typeClosureFrozenBefore.files, typeClosure.files, "global TypeScript input closure is not equivalent; do not execute a partial global gate");
  report.globalInputEquivalence = true;
  report.globalInputEquivalencePhase = "live versus frozen before build; post-build generated-input changes recorded separately";
  report.dependencies = [await verifyLockedDependencies("")];
  report.generatedBinShims = report.inputs.files.filter(entry => entry.binShim);
  report.environment = { controlled: controlledEnvironment, clearedNames: clearedEnvironment, otherInheritedValues: "not recorded" };
  await writeFile(controlledEnvironment.npm_config_userconfig, "", { flag: "wx", mode: 0o600 });
  const packageMetadata = JSON.parse(await readFile(join(frozen, "package.json"), "utf8"));
  assert.equal(packageMetadata.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageMetadata.scripts.build, "tsc -p tsconfig.build.json");
  for (const script of ["pretypecheck", "posttypecheck", "prebuild", "postbuild"]) assert.equal(packageMetadata.scripts[script], undefined, `unreviewed npm lifecycle hook: ${script}`);
  report.buildOutputGuard = await describeBuildOutputs();
  const declaredOutputs = new Set(report.buildOutputGuard.declaredOutputs);
  const nonOutputManifest = { files: report.inputs.files.filter(entry => !declaredOutputs.has(entry.path)) };
  report.buildOutputGuard.nonOutputBefore = await verifyFrozen(nonOutputManifest);
  report.buildOutputGuard.nonOutputCount = nonOutputManifest.files.length;
  report.node = { path: process.execPath, version: process.version, sha256: digest(await readFile(process.execPath)), platform: process.platform, arch: process.arch };
  const npmPath = await realpath(join(dirname(process.execPath), "npm"));
  report.npm = { path: npmPath, sha256: digest(await readFile(npmPath)) };
  const gnuPath = join(frozen, "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar");
  report.gnu = { path: gnuPath, sha256: digest(await readFile(gnuPath)) };
  assert.equal(report.gnu.sha256, "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
  report.bsd = { path: "/usr/bin/bsdtar", sha256: digest(await readFile("/usr/bin/bsdtar")) };
  assert.equal(report.bsd.sha256, "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9");
  const baselineBytes = await readFile(join(acceptedRoot, historical, "evidence.json"));
  assert.equal(digest(baselineBytes), "c794511fe12403bf8e9301855750eb171e8c8d117623848e5b8961e1a131941b");
  const baseline = JSON.parse(baselineBytes.toString());
  const originalPaths = [...originalAuthor, ...originalStress, wiring, "tests/commands/archive/built-package.mjs", "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/helpers.ts", "tests/commands/archive-stress/fixtures.ts"];
  for (const path of originalPaths) {
    const original = baseline.sealedInput.files.find(entry => entry.path === path);
    assert.ok(original, `original fixture absent from historical manifest: ${path}`);
    if (path === approvedRefactor.path) assert.equal(original.sha256, approvedRefactor.before);
    if (path === observationPath) assert.equal(original.sha256, observationBefore);
    const expected = path === legacyPath ? ready.inputs[legacyPath] : path === approvedRefactor.path ? approvedRefactor.after : path === observationPath ? observationRefactor.after : original.sha256;
    assert.equal(digest(await readFile(join(frozen, path))), expected, `original corpus changed beyond approved profile refactor: ${path}`);
  }
  const historicalPrefix = "tests/commands/archive-stress/";
  report.protectedBefore = report.inputs.files.filter(entry => entry.path.startsWith(historicalPrefix) && !entry.path.startsWith(`${owned}/`)).map(({ path, sha256 }) => ({ path, sha256 }));
  for (const cohort of originals) {
    const content = await readFile(join(acceptedRoot, historical, cohort.tap));
    assert.equal(digest(content), cohort.hash);
    cohort.names = titles(content.toString());
    assert.equal(cohort.names.length, cohort.count);
  }
  await run("gnu-version", gnuPath, ["--version"], 5000);
  await run("bsd-version", "/usr/bin/bsdtar", ["--version"], 5000);
  const historicalRoot = await realpath(ready.historicalControl.root);
  const observation = await run("historical-observation-control", process.execPath, ["--unhandled-rejections=strict", "--import", join(historicalRoot, "node_modules/tsx/dist/loader.mjs"), join(frozen, acceptedOwned, "historical-control.mjs"), historicalRoot, join(root, ready.historicalControl.evidencePath)], 15000, historicalRoot);
  observation.accounting = "Separate pinned historical control, three phases: no-tar, over-limit unchanged effects, positive publication witness. Not added to main177. Unchanged omission assertions do not target current MemoryFS.";
  observation.provenance = ready.historicalControl;
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", "--test-concurrency=1"];
  const acceptedAuthor = accepted.commands.find(command => command.name === "author-targets");
  const acceptedIndependent = accepted.commands.find(command => command.name === "independent6");
  const oldCohorts = [...originals,
    { name: "accepted-author12", files: ["tests/commands/archive-stress/pax-extensibility.test.ts", "tests/commands/archive-stress/pax-native.test.ts"], names: acceptedAuthor.names, count: acceptedAuthor.counts.tests },
    { name: "accepted-independent6", files: [`${acceptedOwned}/controls.test.ts`], names: acceptedIndependent.names, count: acceptedIndependent.counts.tests },
  ];
  for (const path of [...oldCohorts.flatMap(cohort => cohort.files), "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/helpers.ts", `${acceptedOwned}/fixtures.ts`]) {
    const original = accepted.inputs.files.find(entry => entry.path === path);
    assert.ok(original, `accepted cohort input missing: ${path}`);
    assert.equal(digest(await readFile(join(frozen, path))), path === legacyPath ? ready.inputs[legacyPath] : original.sha256, `accepted corpus assertion drift: ${path}`);
  }
  async function executeCohorts(profile, cohorts, cwd, literal = false) {
    for (const cohort of cohorts) {
      const files = cohort.files.map(path => literal && path === legacyPath ? transportPath : path);
      const command = await run(`${profile}-${cohort.name}`, process.execPath, [...testArgs, ...files], 120000, cwd);
      command.profile = profile;
      command.expectedNames = cohort.names;
      command.identityMatch = JSON.stringify(command.names) === JSON.stringify(cohort.names);
      command.expectedCount = cohort.count;
      command.countMatch = command.counts.tests === cohort.count;
    }
  }
  await executeCohorts("baseline-literal177", oldCohorts, acceptedRoot);
  report.acceptedSnapshotAfterReplay = await verifyAcceptedSnapshot();
  await executeCohorts("patched-literal177", oldCohorts, frozen, true);
  await executeCohorts("corrected177", oldCohorts, frozen);
  await executeCohorts("author-new", [{ name: "deletion", files: ready.authorTests, names: ready.authorNames, count: ready.authorNames.length }], frozen);
  await executeCohorts("independent-new", [{ name: "deletion7", files: [`${owned}/controls.test.ts`], names: independentNames, count: independentNames.length }], frozen);
  await run("scoped-types", process.execPath, ["node_modules/typescript/bin/tsc", "-p", `${owned}/tsconfig.scope.json`], 90000);
  await run("global-typecheck", npmPath, ["run", "typecheck"], 180000);
  report.buildOutputGuard.allInputsBeforeBuild = await verifyFrozen(report.inputs);
  assert.equal(report.buildOutputGuard.allInputsBeforeBuild, report.frozenBefore);
  assert.equal(digest(await readFile(join(frozen, transportPath))), legacyHash);
  report.buildOutputGuard.treeBeforeBuild = await observeFrozenTree();
  const build = await run("global-build", npmPath, ["run", "build"], 180000);
  report.buildOutputGuard.treeAfterBuild = await observeFrozenTree();
  report.buildOutputGuard.outputChanges = enforceBuildChanges(report.buildOutputGuard.treeBeforeBuild, report.buildOutputGuard.treeAfterBuild, declaredOutputs);
  report.buildOutputGuard.nonOutputAfterBuild = await verifyFrozen(nonOutputManifest);
  assert.equal(report.buildOutputGuard.nonOutputAfterBuild, report.buildOutputGuard.nonOutputBefore);
  await run("global-typecheck-postbuild", npmPath, ["run", "typecheck"], 180000);
  const built = await run("built4", process.execPath, ["tests/commands/archive/built-package.mjs"], 60000);
  built.validFreshBuild = build.status === 0;
  built.reportedFourChecks = (await readFile(join(evidence, "built4/stdout.log"), "utf8")).includes("Built archive checks: 4/4 (API, zero runtime dependencies, gzip pipeline, listing pipeline)");
  report.buildOutputGuard.treeAfterChecks = await observeFrozenTree();
  assert.equal(report.buildOutputGuard.treeAfterChecks.sha256, report.buildOutputGuard.treeAfterBuild.sha256, "post-build checks changed frozen files");
  report.buildOutputGuard.nonOutputAfter = await verifyFrozen(nonOutputManifest);
  assert.equal(report.buildOutputGuard.nonOutputAfter, report.buildOutputGuard.nonOutputBefore);
  report.capturedInputsAfter = await observeCapturedInputs(report.inputs);
  report.frozenAfter = report.capturedInputsAfter.sha256;
  report.allInputBytesStable = report.frozenAfter === report.frozenBefore;
  report.nonOutputInputsStable = true;
  assert.equal(digest(await readFile(join(frozen, transportPath))), legacyHash);
  report.completeFrozenAfter = digest(JSON.stringify({ sourceClosure: report.frozenAfter, legacyTransport: report.legacyTransport }));
  report.completeFrozenStable = report.completeFrozenAfter === report.completeFrozenBefore;
  report.acceptedSnapshotAfter = await verifyAcceptedSnapshot();
  report.typeClosureFrozenAfter = await listTypeInputs(frozen, "global-inputs-frozen-after");
  const initialTypePaths = new Set(typeClosure.files);
  const finalTypePaths = new Set(report.typeClosureFrozenAfter.files);
  report.buildOutputGuard.compilerInputChanges = {
    added: report.typeClosureFrozenAfter.files.filter(path => !initialTypePaths.has(path)),
    removed: typeClosure.files.filter(path => !finalTypePaths.has(path)),
  };
  for (const path of [...report.buildOutputGuard.compilerInputChanges.added, ...report.buildOutputGuard.compilerInputChanges.removed]) {
    assert.ok(declaredOutputs.has(path), `post-build nongenerated compiler input changed: ${path}`);
  }
  assert.deepEqual(report.typeClosureFrozenAfter.files.filter(path => !declaredOutputs.has(path)), typeClosure.files.filter(path => !declaredOutputs.has(path)), "post-build nongenerated compiler closure changed");
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
  report.readyInputDrift = [];
  for (const [path, expected] of Object.entries(ready.inputs)) {
    const actual = digest(await readFile(join(root, path)));
    if (actual !== expected) report.readyInputDrift.push({ path, expected, actual });
  }
  report.authorEvidenceAfter = [];
  for (const entry of ready.authorEvidence) {
    const sha256 = digest(await readFile(join(root, entry.path)));
    assert.equal(sha256, entry.sha256, `author seal drift: ${entry.path}`);
    report.authorEvidenceAfter.push({ path: entry.path, sha256 });
  }
  const profiles = ["baseline-literal177", "patched-literal177", "corrected177", "author-new", "independent-new"];
  report.accounting = Object.fromEntries(profiles.map(profile => {
    const commands = report.commands.filter(command => command.profile === profile);
    const names = commands.flatMap(command => command.names);
    return [profile, {
      tests: commands.reduce((total, command) => total + (command.counts.tests ?? 0), 0),
      pass: commands.reduce((total, command) => total + (command.counts.pass ?? 0), 0),
      fail: commands.reduce((total, command) => total + (command.counts.fail ?? 0), 0),
      uniqueNames: new Set(names).size,
      duplicateNames: names.filter((name, index) => names.indexOf(name) !== index),
      skipped: commands.reduce((total, command) => total + (command.counts.skipped ?? 0), 0),
      cancelled: commands.reduce((total, command) => total + (command.counts.cancelled ?? 0), 0),
      todo: commands.reduce((total, command) => total + (command.counts.todo ?? 0), 0),
    }];
  }));
  const correctedCommands = report.commands.filter(command => ["corrected177", "author-new", "independent-new"].includes(command.profile));
  const correctedNames = correctedCommands.flatMap(command => command.names);
  report.correctedAccounting = { tests: correctedNames.length, uniqueNames: new Set(correctedNames).size, builtChecksSeparate: 4, historicalControlSeparate: "one control/three phases", nativeResearchSeparate: "eight research vectors, not product tests", oldNativeControls: "P12 and I05 remain subsets of the accepted177" };
  const clean = command => command.status === 0 && !command.timedOut && !command.limited && command.identityMatch !== false && command.countMatch !== false && (command.counts.fail ?? 0) === 0 && (command.counts.skipped ?? 0) === 0 && (command.counts.cancelled ?? 0) === 0 && (command.counts.todo ?? 0) === 0;
  const literalCommands = report.commands.filter(command => command.profile === "patched-literal177");
  const literalFailures = literalCommands.filter(command => !clean(command));
  const conflict = literalFailures[0];
  const conflictText = conflict ? await readFile(join(evidence, conflict.name, "stdout.log"), "utf8") : "";
  report.legacyConflict = {
    historicalIdentity: legacyIdentity, originalSha256: legacyHash, correctedSha256: ready.inputs[legacyPath], rawProfile: report.accounting["patched-literal177"],
    classification: "Actual literal failure retained, not a passing assertion; only the explicitly approved line108 raw-mtime expectation may differ",
    exactApprovedConflict: literalFailures.length === 1 && conflict.status === 1 && !conflict.timedOut && !conflict.limited && conflict.identityMatch && conflict.countMatch && conflict.counts.fail === 1 && conflict.counts.pass === 127 && conflict.counts.skipped === 0 && conflict.counts.cancelled === 0 && conflict.counts.todo === 0 && conflict.failures.length === 1 && conflict.failures[0].endsWith(legacyIdentity) && /options\.legacy\.mts:108:/u.test(conflictText) && /expected: 1700000000000/u.test(conflictText),
  };
  report.gatePass = report.commands.filter(command => command.profile !== "patched-literal177").every(clean) && report.legacyConflict.exactApprovedConflict && report.accounting["baseline-literal177"].tests === 177 && report.accounting["patched-literal177"].tests === 177 && report.accounting["corrected177"].tests === 177 && report.correctedAccounting.tests === report.correctedAccounting.uniqueNames && Object.values(report.accounting).every(cohort => cohort.duplicateNames.length === 0) && report.readyInputDrift.length === 0 && report.protectedEvidenceStable && report.historicalStable && report.priorCheckpointsStable && report.toolingStable && built.validFreshBuild && built.reportedFourChecks;
  report.nativeConflict = "Original raw158/159,29/30,176/177 and driverexit1 histories remain immutable. This corrected177 additionally has the explicit ONE deletion oracle correction; patched literal177 is never relabeled passing. GNU/BSD global/empty-time/AppleDouble profiles remain observations, not normative deletion expectations.";
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
  console.log("Historical baseline literal177, patched literal177 conflict, corrected177, author-new, independent7, historical control and built4 are separate; see raw profile accounting.");
  process.exitCode = report.gatePass ? 0 : 1;
}
