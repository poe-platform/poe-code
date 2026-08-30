import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(evidence, "../../../..");
const sourceCommit = "4f01c1593486c1abff3b007f9a3b16923b88559f";
const fixtureCommit = "efb1a25aa3e2544cf71aba10f2aaa54b256091ff";
const acceptedCommit = "21220b465537bf45ffcfb36740956a69f43bf75e";
const namedCommit = "246aa440c988d6c09464480956c4eff69009f7e4";
const fixture = "tests/commands/expr/inactive-prefix.test.ts";
const oldDiagnostic = "expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n";
const newDiagnostic = "expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n";
const runName = process.argv[2];
assert(runName && /^run-[a-zA-Z0-9-]+$/.test(runName), "supply a new isolated run-NAME");
const output = path.join(evidence, runName);
fs.mkdirSync(output);
const work = path.join(output, ".work");
fs.mkdirSync(work);
const source = path.join(work, "source");
fs.mkdirSync(source);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const snapshot = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return snapshot(entryPath);
  assert(entry.isFile(), `unexpected nonfile ${entryPath}`);
  const bytes = fs.readFileSync(entryPath);
  return [{ path: path.relative(source, entryPath), size: bytes.length, sha256: hash(bytes) }];
});
const run = (name, args, expectedStatus = 0) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd: source, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const record = { executable: process.execPath, args, cwd: source, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
  save(`${name}.json`, record);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
  return record;
};
const counts = stdout => Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
  const match = stdout.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
  assert(match, `missing TAP count ${key}`);
  return [key, Number(match[1])];
}));
let completed = false;
try {
  const original = git("show", `${sourceCommit}:${fixture}`);
  const overlay = git("show", `${fixtureCommit}:${fixture}`);
  assert.deepEqual(original, fs.readFileSync(path.join(evidence, "original-4f01c159.test.ts.data")));
  const oldLiteral = JSON.stringify(oldDiagnostic);
  const newLiteral = JSON.stringify(newDiagnostic);
  assert.equal(original.toString().split(oldLiteral).length - 1, 1);
  assert.equal(original.toString().replace(oldLiteral, newLiteral), overlay.toString());
  assert.equal(git("diff-tree", "--no-commit-id", "--name-only", "-r", fixtureCommit).toString().trim(), fixture);
  const ast = ts.createSourceFile(fixture, original.toString(), ts.ScriptTarget.Latest, true);
  let prefixes;
  const inspect = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "inactivePrefixes") {
      assert(node.initializer && ts.isAsExpression(node.initializer));
      const array = node.initializer.expression;
      assert(ts.isArrayLiteralExpression(array));
      prefixes = array.elements.map(element => {
        assert(ts.isArrayLiteralExpression(element));
        return element.elements.map(value => { assert(ts.isStringLiteral(value)); return value.text; });
      });
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  assert.equal(prefixes.length, 4);
  save("assertion-delta.json", { sourceCommit, fixtureCommit, fixture, originalSha256: hash(original), overlaySha256: hash(overlay), changedSourceLines: 1, changedStringLiterals: 1, expandedAssertionDelta: 4, exactReplacementOnly: true, unrelatedCaseChanges: 0, inputs: prefixes, unchanged: ["argv", "env", "options", "status 2", "stdout empty", "jobs empty", "encoding", "cancellation", "all other assertions"], oldDiagnostic, newDiagnostic });
  fs.writeFileSync(path.join(output, "overlay.test.ts.data"), overlay, { flag: "wx" });
  const archivePaths = ["src", "package.json", "package-lock.json", "tsconfig.json", fixture, "tests/commands/expr/helpers.ts", "tests/commands/expr/contracts.test.ts"];
  const archive = git("archive", "--format=tar", sourceCommit, ...archivePaths);
  const archiveFile = path.join(work, "source.tar");
  fs.writeFileSync(archiveFile, archive, { flag: "wx" });
  execFileSync("tar", ["-xf", archiveFile, "-C", source]);
  const archiveBefore = snapshot(source);
  for (const entry of archiveBefore) assert.equal(entry.sha256, hash(git("show", `${sourceCommit}:${entry.path}`)));
  save("archive-before.json", archiveBefore);
  const sourceBefore = snapshot(path.join(source, "src"));
  save("source-before.json", sourceBefore);
  const sourceTreeSha256 = hash(JSON.stringify(sourceBefore));
  const tooling = ["typescript", "tsx", "@types/node"].map(name => {
    const bytes = fs.readFileSync(path.join(root, "node_modules", name, "package.json"));
    return { name, version: JSON.parse(bytes).version, packageJsonSha256: hash(bytes) };
  });
  const compiler = path.join(root, "node_modules/typescript/lib/tsc.js");
  save("binding.json", { classification: "NEW author fixture-only overlay cohort, not a rescore of the independent immutable 4f review", sourceCommit, fixtureCommit, acceptedCommit, namedCommit, sourceGitTree: git("rev-parse", `${sourceCommit}:src`).toString().trim(), sourceTreeSha256, archivePaths, archiveSha256: hash(archive), archiveFileCount: archiveBefore.length, sourceFileCount: sourceBefore.length, overlays: [{ path: fixture, before: hash(original), after: hash(overlay) }], liveHeadAtCapture: git("rev-parse", "HEAD").toString().trim(), node: process.version, platform: process.platform, arch: process.arch, tooling, compilerSha256: hash(fs.readFileSync(compiler)), dependenciesInstalled: false, nativeOracleInvoked: false, repeatWorkerOverlay: false, globalBuild: false, prerequisites: "Existing local TS/tsx/@types/node tooling via symlink; regex worker-only strict compilation from immutable 4f source into isolated dist. No live product files or built artifacts copied." });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(source, "node_modules"), "dir");
  const strict = ["--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "false", "--types", "node"];
  run("worker-prerequisite-build", [compiler, ...strict, "--rootDir", "src", "--outDir", "dist", "src/commands/regex-execution/worker.ts"]);
  const workerBefore = snapshot(path.join(source, "dist"));
  save("worker-build-before.json", workerBefore);
  const baseline = run("baseline-4f-original", ["--import", "tsx", "--test", "--test-reporter=tap", fixture], 1);
  const baselineCounts = counts(baseline.stdout);
  assert.deepEqual(baselineCounts, { tests: 68, pass: 64, fail: 4, cancelled: 0, skipped: 0, todo: 0 });
  const failureNames = [...baseline.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(failureNames, prefixes.map(args => `active ${args[0]} still rejects unsupported character locale`));
  const nonGenerated = () => fs.readdirSync(source).filter(name => !["node_modules", "dist"].includes(name)).sort().flatMap(name => {
    const item = path.join(source, name);
    if (fs.statSync(item).isDirectory()) return snapshot(item);
    const bytes = fs.readFileSync(item);
    return [{ path: name, size: bytes.length, sha256: hash(bytes) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
  const sortedArchive = [...archiveBefore].sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(nonGenerated(), sortedArchive);
  fs.writeFileSync(path.join(source, fixture), overlay);
  run("strict-scoped-types", [compiler, ...strict, "--noEmit", "--listFiles", fixture]);
  const candidate = run("new-fixture-overlay", ["--import", "tsx", "--test", "--test-reporter=tap", fixture]);
  const candidateCounts = counts(candidate.stdout);
  assert.deepEqual(candidateCounts, { tests: 68, pass: 68, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const baselineNames = [...baseline.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map(match => match[1]);
  const candidateNames = [...candidate.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(candidateNames, baselineNames);
  const observer = `import assert from 'node:assert/strict';
import { run } from './tests/commands/expr/helpers.ts';
import { RegexSession } from './src/commands/regex-execution/client.ts';
import { createMemoryFileSystem } from './src/fs/memory/index.ts';
const noFileSystem = new Proxy(createMemoryFileSystem(), { get() { throw new Error('argv-only expr accessed the filesystem'); } });
const originalMatch = RegexSession.prototype.matchExpr;
const jobs = [];
RegexSession.prototype.matchExpr = async function (...args) { jobs.push(Buffer.from(args[1]).toString()); return originalMatch.apply(this, args); };
const rows = [];
try {
  for (const args of ${JSON.stringify(prefixes)}) {
    jobs.length = 0;
    const env = { LC_ALL: 'unsupported-inactive-profile' };
    const actual = await run(args, {}, { env, fs: noFileSystem });
    const tuple = [actual.exitCode, actual.stdout, actual.stderr];
    assert.deepEqual(tuple, [2, '', ${JSON.stringify(newDiagnostic)}]);
    assert.deepEqual(jobs, []);
    rows.push({ args, options: {}, env, cwd: '/', stdin: 'throw-on-acquisition', fs: 'throw-on-access', signal: 'fresh non-aborted AbortController', originalExpected: [2, '', ${JSON.stringify(oldDiagnostic)}], newExpected: [2, '', ${JSON.stringify(newDiagnostic)}], actual: tuple, jobs: [...jobs], stdoutHex: actual.stdoutHex, stderrHex: Buffer.from(actual.stderr).toString('hex') });
  }
} finally { RegexSession.prototype.matchExpr = originalMatch; }
console.log(JSON.stringify(rows));
`;
  const observations = run("four-row-observations", ["--import", "tsx", "--input-type=module", "-e", observer]);
  save("exact-four-rows.json", JSON.parse(observations.stdout));
  const after = nonGenerated();
  const expected = sortedArchive.map(entry => entry.path === fixture ? { ...entry, size: overlay.length, sha256: hash(overlay) } : entry);
  assert.deepEqual(after, expected);
  assert.deepEqual(snapshot(path.join(source, "src")), sourceBefore);
  assert.deepEqual(snapshot(path.join(source, "dist")), workerBefore);
  save("archive-after.json", after);
  save("integrity.json", { sourceUnchanged: true, sourceTreeSha256, productOverlayCount: 0, fixtureOverlayCount: 1, exactExpectedArchiveTree: true, detectsNewEntriesOutsideDeclaredGeneratedRoots: true, generatedRoots: ["node_modules (existing toolchain symlink)", "dist (isolated worker build; full tree compared before/after execution)"], baselineArchiveCheckedBeforeOverlay: true, workerArtifactsUnchanged: true, contractsTestUnchanged: true, liveTreeNotUsedAsCandidate: true });
  save("summary.json", { sourceCommit, fixtureCommit, baselineOriginal: baselineCounts, newFixtureOverlay: candidateCounts, failureNames, changedExpandedAssertions: 4, changedInputCount: 0, unchangedTestNames: true, strictScopedTypesStatus: 0, workerPrerequisiteBuildStatus: 0, probeRows: 4, probeRowsNotAdditionalTests: true, independentOriginal225NotRescored: true, separateOld217NotRequalified: true, separateContractsOldEnUSRefusalNotRun: true, oldOneByteRedAnd19SequenceFailuresNotChangedOrRerun: true, sourceTreeSha256 });
  completed = true;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
  save("cleanup.json", { completed, temporaryDirectoryRemoved: !fs.existsSync(work), ownedRunningProcesses: 0, processModel: "Synchronous bounded child processes, none detached; Node worker threads exit with their test process. No separate worker-lifecycle instrumentation in this fixture-only cohort.", nativeOracleProcessesStarted: false, hostToolsUsed: ["git", "tar", "node"], captureDriverSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), timestamp: new Date().toISOString() });
}
