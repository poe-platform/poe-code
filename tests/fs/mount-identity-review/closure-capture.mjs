import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "4fa4ba9502dac843bd13aa5031d128a3171f597d";
const previousRevision = "029d67e60c7a18831066d36f50e55132afb05d7c";
const owned = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const label = process.argv[2] ?? "closure-4fa4ba9";
assert.match(label, /^[a-z0-9-]+$/);
const output = join(owned, "evidence", label);
assert.equal(existsSync(output), false, "never rewrite an existing checkpoint");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
const show = (revision, path) => execFileSync("git", ["show", `${revision}:${path}`], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const oldFiles = git("ls-tree", "-r", "--name-only", "8d461cc", "--", "tests/fs/mount-identity-review").split("\n");
const historicalBefore = oldFiles.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))), committedSha256: sha256(show("8d461cc", path)) }));
assert.ok(historicalBefore.every((row) => row.sha256 === row.committedSha256));
const started = new Date().toISOString();
const statusBefore = git("status", "--porcelain=v1");
const processes = () => execFileSync("ps", ["-axo", "pid=,ppid=,lstart=,etime=,args="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const processesBefore = processes();
const temporary = mkdtempSync(join(owned, ".closure-archive-"));
const independentNames = ["identity-review.test.ts", "native-review.test.ts", "contract-edges.test.ts", "tsconfig.json", "native-tsconfig.json", "closure-fs-tsconfig.json", "closure-capture.mjs"];
const independent = independentNames.map((name) => ({ path: `tests/fs/mount-identity-review/${name}`, sha256: sha256(readFileSync(join(owned, name))) }));
const commands = [];
const original = ["tests/fs/mount/copy-identity.test.ts"];
const required = ["tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"];
const cohortFiles = [...original, ...required];
const historicalManifest = JSON.parse(show(revision, "tests/fs/mount/evidence/identity-contract-20260826/original/required49-source-manifest.json"));
const fixtures = cohortFiles.map((path) => ({ path,
  oldBlob: git("rev-parse", `${previousRevision}:${path}`), fixedBlob: git("rev-parse", `${revision}:${path}`),
  oldSha256: sha256(show(previousRevision, path)), fixedSha256: sha256(show(revision, path)),
  priorReproductionSha256: historicalManifest.testHashes[path],
}));
assert.ok(fixtures.every((row) => row.oldBlob === row.fixedBlob && row.oldSha256 === row.fixedSha256 && row.fixedSha256 === row.priorReproductionSha256));
assert.equal(sha256(show("d4f5e53", original[0])), fixtures[0].fixedSha256);
assert.equal(sha256(show("fa539de", "src/contracts/filesystem.md")), sha256(show(revision, "src/contracts/filesystem.md")));

function save(name, data) {
  const path = join(output, `${name}.json`);
  assert.equal(existsSync(path), false);
  const text = JSON.stringify(data, null, 2);
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${relative(repository, path)}\n${text.split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
}

function freeze(pin, name) {
  const directory = join(temporary, name);
  mkdirSync(directory, { recursive: true });
  const selected = git("ls-tree", "-r", "--name-only", pin, "--", "src", "tests/fs", "tests/stress/adapters", "tests/stress/s3-policy", "tests/stress/remote-cancellation", "tests/integration/adapter-tools", "tests/integration/adapter-tools-diagnostics", "package.json", "package-lock.json", "tsconfig.json").split("\n")
    .filter((path) => path.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json"].includes(path)
      || !path.includes("/evidence/") && (/\.(ts|mjs)$/.test(path) || path.endsWith("/reference.json")));
  const tar = execFileSync("git", ["archive", "--format=tar", pin, ...selected], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  const tarPath = join(directory, "inputs.tar");
  writeFileSync(tarPath, tar);
  execFileSync("tar", ["-xf", tarPath, "-C", directory]);
  const manifest = selected.map((path) => ({ path, blob: git("rev-parse", `${pin}:${path}`), sha256: sha256(readFileSync(join(directory, path))) }));
  const testDirectory = join(directory, "tests/fs/mount-identity-review");
  mkdirSync(testDirectory, { recursive: true });
  for (const name of independentNames) copyFileSync(join(owned, name), join(testDirectory, name));
  symlinkSync(join(repository, "node_modules"), join(directory, "node_modules"), "dir");
  mkdirSync(join(directory, ".fixtures"));
  return { pin, directory, selected, manifest, archiveSha256: sha256(tar) };
}

function command(snapshot, name, argv, extraEnvironment = {}) {
  const environment = { ...process.env, TMPDIR: join(snapshot.directory, ".fixtures"), TMP: join(snapshot.directory, ".fixtures"), TEMP: join(snapshot.directory, ".fixtures"), ...extraEnvironment };
  for (const key of ["AUDIT_CASE", "DIAGNOSTIC_REVISION", "DIAGNOSTIC_MATRIX_REVISION", "DIAGNOSTIC_MUTATION", "MOUNT_IDENTITY_REVIEW_EVIDENCE", "NATIVE_IDENTITY_REVIEW_EVIDENCE", "IDENTITY_EDGE_EVIDENCE"]) if (!(key in extraEnvironment)) delete environment[key];
  const began = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, { cwd: snapshot.directory, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  const summary = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((field) => {
    const matches = [...result.stdout.matchAll(new RegExp(`^# ${field} (\\d+)$`, "gm"))];
    return [field, matches.length ? Number(matches.at(-1)[1]) : null];
  }));
  const item = { name, revision: snapshot.pin, executable: process.execPath, argv, started: began, ended: new Date().toISOString(), exit: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, summary,
    failures: [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]) };
  commands.push({ name, exit: item.exit, summary, failures: item.failures });
  console.log(JSON.stringify(commands.at(-1)));
  return item;
}

function tests(snapshot, name, files, environment = {}) {
  const item = command(snapshot, name, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...files], environment);
  const observations = {};
  for (const [key, path] of Object.entries(environment)) if (key.endsWith("_EVIDENCE") && existsSync(path)) observations[key] = JSON.parse(readFileSync(path, "utf8"));
  item.observations = observations;
  save(name, item);
  return item;
}

function proof(snapshot, name, baseline = true, edges = true) {
  return tests(snapshot, name, [...(baseline ? ["tests/fs/mount-identity-review/identity-review.test.ts"] : []), ...(edges ? ["tests/fs/mount-identity-review/contract-edges.test.ts"] : [])], {
    MOUNT_IDENTITY_REVIEW_EVIDENCE: join(snapshot.directory, `${name}-baseline.json`), IDENTITY_EDGE_EVIDENCE: join(snapshot.directory, `${name}-edges.json`),
  });
}

function stable(snapshot) {
  const changed = snapshot.manifest.filter(({ path, sha256: expected }) => sha256(readFileSync(join(snapshot.directory, path))) !== expected);
  assert.deepEqual(changed, [], "archived committed inputs restored exactly");
  for (const row of independent) assert.equal(sha256(readFileSync(join(snapshot.directory, row.path))), row.sha256);
}

let summary;
try {
  const baseline = freeze(previousRevision, "previous");
  const fixed = freeze(revision, "fixed");
  save("provenance", { revision, previousRevision, contract: git("rev-parse", "fa539de"), evidenceCommit: "0db472ad0af0d5d9b2d927415731fe348e611c5a", started, fixtures, independent, historicalBefore, statusBefore, processesBefore,
    snapshots: [baseline, fixed].map(({ directory, ...data }) => data),
    sourceDiff: git("diff", previousRevision, revision, "--", "src/fs/memory", "src/fs/real", "src/fs/mount", "src/fs/readonly", "src/fs/overlay"),
    lastSourceDelta: git("show", "--format=fuller", revision, "--", "src/fs", "tests/fs/mount/identity-scope.test.ts"),
    changedFixtureDiff: git("diff", previousRevision, revision, "--", "tests/fs/mount/mount.test.ts", "tests/fs/readonly/metadata.test.ts", "tests/fs/overlay/review-regressions.test.ts"),
    tooling: { node: process.version, platform: process.platform, architecture: process.arch, packages: Object.fromEntries(["typescript", "tsx", "esbuild", "@types/node"].map((name) => { const content = readFileSync(join(repository, "node_modules", name, "package.json")); return [name, { version: JSON.parse(content).version, sha256: sha256(content) }]; })) },
  });
  tests(baseline, "previous-original4", original);
  tests(baseline, "previous-required49", required);
  tests(fixed, "fixed-original4", original);
  tests(fixed, "fixed-required49", required);
  proof(fixed, "fixed-independent19", true, false);
  proof(fixed, "fixed-contract-edges", false, true);
  tests(fixed, "fixed-native12", ["tests/fs/mount-identity-review/native-review.test.ts"], { NATIVE_IDENTITY_REVIEW_EVIDENCE: join(fixed.directory, "fixed-native.json") });
  const ownTypes = command(fixed, "fixed-own-types", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/tsconfig.json"]);
  save("fixed-own-types", ownTypes);
  save("fixed-fs-types", command(fixed, "fixed-fs-types", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/closure-fs-tsconfig.json"]));
  const mutations = [
    { name: "mount-alias-guard-removed", path: "src/fs/mount/index.ts", changes: [['      if (identity === "same") fail("EINVAL");\n', ""]], baseline: true, edges: false },
    { name: "native-scope-per-instance", path: "src/fs/real/index.ts", changes: [
      ["function fileStat(stats: Stats): FileStat {", "function fileStat(stats: Stats, identityScope: symbol): FileStat {"],
      ['{ identityScope: Symbol.for("virtual-bash.fs.native") }', "{ identityScope }"],
      ["  private readonly configuredRoot: string;", '  private readonly identityScope = Symbol("native-instance");\n  private readonly configuredRoot: string;'],
      ["fileStat(await native.stat(target))", "fileStat(await native.stat(target), this.identityScope)"],
      ["fileStat(await native.lstat(target))", "fileStat(await native.lstat(target), this.identityScope)"],
    ], baseline: true, edges: false },
    { name: "readonly-scope-forwarding-removed", path: "src/fs/readonly/index.ts", changes: [["    ...(identityScope === undefined ? {} : { identityScope }),\n", ""]], baseline: true, edges: true },
    { name: "overlay-scope-forwarding-removed", path: "src/fs/overlay/index.ts", changes: [["    ...(identityScope === undefined ? {} : { identityScope }),\n", ""]], baseline: true, edges: true },
    { name: "unknown-identity-guard-removed", path: "src/fs/mount/index.ts", changes: [['      if (target.stat && identity === "unknown") fail("ENOTSUP");\n', ""]], baseline: false, edges: true },
    { name: "missing-target-exclusive-removed", path: "src/fs/mount/index.ts", changes: [['flag: options.exclusive || !target.stat ? "wx" : "w"', 'flag: options.exclusive ? "wx" : "w"']], baseline: false, edges: true },
    { name: "generic-delegation-before-unknown-guard", path: "src/fs/mount/index.ts", changes: [[
      '      if (target.stat && identity === "unknown") fail("ENOTSUP");\n      if (origin.mount === target.mount) {\n        await origin.mount.backend.copyFile(origin.local, target.local, { ...options, exclusive: options.exclusive || !target.stat });\n        return;\n      }',
      '      if (origin.mount === target.mount) {\n        await origin.mount.backend.copyFile(origin.local, target.local, { ...options, exclusive: options.exclusive || !target.stat });\n        return;\n      }\n      if (target.stat && identity === "unknown") fail("ENOTSUP");',
    ]], baseline: false, edges: true },
  ];
  const mutationResults = [];
  for (const mutation of mutations) {
    const path = join(fixed.directory, mutation.path);
    const originalSource = readFileSync(path, "utf8");
    let changed = originalSource;
    for (const [from, to] of mutation.changes) { assert.equal(changed.split(from).length, 2, `${mutation.name}: exact mutation anchor`); changed = changed.replace(from, to); }
    const patch = (before, after) => `*** Begin Patch\n*** Update File: ${mutation.path}\n@@\n${before.trimEnd().split("\n").map((line) => `-${line}`).join("\n")}\n${after.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
    const removalPatch = patch(originalSource, changed);
    execFileSync("apply_patch", [], { cwd: fixed.directory, input: removalPatch });
    assert.equal(readFileSync(path, "utf8"), changed);
    const result = proof(fixed, `mutant-${mutation.name}`, mutation.baseline, mutation.edges);
    const types = command(fixed, `mutant-${mutation.name}-types`, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/tsconfig.json"]);
    execFileSync("apply_patch", [], { cwd: fixed.directory, input: patch(changed, originalSource) });
    stable(fixed);
    const evidence = { name: mutation.name, path: mutation.path, originalSha256: sha256(originalSource), mutantSha256: sha256(changed), restoredSha256: sha256(readFileSync(path)), changes: mutation.changes, removalPatch, types, exit: result.exit, summary: result.summary, failures: result.failures, killed: result.exit === 1 && result.summary.fail > 0 && result.summary.cancelled === 0 && result.summary.skipped === 0 && types.exit === 0 };
    mutationResults.push(evidence);
  }
  save("mutation-provenance", mutationResults);
  proof(fixed, "restored-independent-and-edges");
  const fullGroups = ["memory", "real", "mount", "readonly", "overlay", "s3", "webdav", "conformance"];
  for (const group of fullGroups) tests(fixed, `fs-${group}`, fixed.selected.filter((path) => path.startsWith(`tests/fs/${group}/`) && path.endsWith(".test.ts")));
  tests(fixed, "safety-adapters", fixed.selected.filter((path) => path.startsWith("tests/stress/adapters/") && path.endsWith(".test.ts")));
  tests(fixed, "safety-s3-policy", ["tests/stress/s3-policy/rename.test.ts"]);
  tests(fixed, "safety-s3-bounded", ["tests/stress/s3-policy/bounded-races.test.ts"]);
  const remote = command(fixed, "safety-remote24", ["tests/stress/remote-cancellation/run.mjs"], { AUDIT_REPEATS: "1", AUDIT_VERBOSE: "1" });
  save("safety-remote24", remote);
  tests(fixed, "revised-matrix79", ["tests/integration/adapter-tools/matrix.test.ts"]);
  tests(fixed, "diagnostics8", ["tests/integration/adapter-tools-diagnostics/eight-cases.test.ts"]);
  stable(fixed);
  stable(baseline);
  summary = { revision, started, ended: new Date().toISOString(), commands, mutationKills: mutationResults.filter((row) => row.killed).length, mutationTotal: mutationResults.length, sourcesRestoredAndStable: true, historicalBefore };
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const globalTypesStarted = new Date().toISOString();
const globalSourceBefore = git("status", "--porcelain=v1");
const npm = spawnSync("npm", ["run", "typecheck"], { cwd: repository, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
const globalTypes = { command: ["npm", "run", "typecheck"], cwd: repository, started: globalTypesStarted, ended: new Date().toISOString(), head: git("rev-parse", "HEAD"), statusBefore: globalSourceBefore, statusAfter: git("status", "--porcelain=v1"), exit: npm.status, signal: npm.signal, error: npm.error?.message, stdout: npm.stdout, stderr: npm.stderr, cohort: "current worktree, not frozen source" };
save("current-global-types", globalTypes);
summary.globalTypecheckExit = npm.status;
summary.historicalAfter = oldFiles.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) }));
assert.deepEqual(summary.historicalAfter, historicalBefore.map(({ path, sha256 }) => ({ path, sha256 })));
summary.historicalUnchanged = true;
summary.statusAfter = git("status", "--porcelain=v1");
summary.processesAfter = processes();
summary.liveHead = git("rev-parse", "HEAD");
summary.liveSourceComparison = git("diff", revision, "--", "src/fs", "src/contracts");
save("summary", summary);
console.log(JSON.stringify({ completed: true, output, globalTypecheckExit: npm.status, mutationKills: summary.mutationKills, cohortFailures: commands.filter((row) => row.exit !== 0).map(({ name, summary }) => ({ name, summary })) }, null, 2));
