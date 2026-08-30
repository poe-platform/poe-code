import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = "/Users/kjopek/Workspace/safe-bash";
const baseline = "b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed";
const sourceRevision = "695eb07";
const classificationRevision = "476da9d";
const prefix = "tests/commands/diff-patch-stress/";
const historicalEvidence = "/tmp/safe-bash-diff-checkpoint-Fpgf5L-evidence";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const blobHash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const execute = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const git = (...args) => execute("git", args);
const sourceCommit = git("rev-parse", sourceRevision).toString().trim();
const evidence = mkdtempSync("/tmp/safe-bash-original-thirty-replay-");
const snapshot = join(evidence, "snapshot");
mkdirSync(snapshot);
const classificationBytes = git("show", `${classificationRevision}:${prefix}gnu-target-classification/evidence.json`);
const classification = JSON.parse(classificationBytes);
const failures = classification.failures;
assert.equal(failures.length, 30);
assert.equal(new Set(failures.map(item => item.name)).size, 30);
for (const artifact of classification.frozenArtifacts) {
  assert.equal(sha256(readFileSync(join(historicalEvidence, artifact.name))), artifact.sha256);
}
const suites = ["compatibility", "fuzz", "formats", "parser-regressions"];
const historicalPaths = ["tests", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
for (const [revision, paths, name] of [[baseline, historicalPaths, "historical.tar"], [sourceCommit, ["src"], "source.tar"]]) {
  const archive = git("archive", "--format=tar", revision, ...paths);
  writeFileSync(join(evidence, name), archive);
  execute("tar", ["-xf", "-", "-C", snapshot], { input: archive });
}
symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"));
assert.equal(realpathSync(join(snapshot, "node_modules")), realpathSync(join(root, "node_modules")));
const filesAt = (revision, paths) => git("ls-tree", "-r", "--full-tree", revision, "--", ...paths).toString().trim().split("\n").map(line => {
  const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line);
  assert(match, line);
  assert.equal(match[1], "100644", `No snapshot symlinks: ${line}`);
  return { path: match[3], gitBlob: match[2] };
});
const historicalFiles = filesAt(baseline, historicalPaths);
const sourceFiles = filesAt(sourceCommit, ["src"]);
const capture = entries => entries.map(entry => {
  const bytes = readFileSync(join(snapshot, entry.path));
  assert.equal(blobHash(bytes), entry.gitBlob, `Git object mismatch: ${entry.path}`);
  return { ...entry, sha256: sha256(bytes) };
});
const before = { historical: capture(historicalFiles), source: capture(sourceFiles) };
for (const entry of [...historicalFiles, ...sourceFiles]) chmodSync(join(snapshot, entry.path), 0o444);
const directories = new Set();
for (const entry of sourceFiles) {
  let directory = dirname(join(snapshot, entry.path));
  while (directory.startsWith(`${snapshot}/src`)) {
    directories.add(directory);
    directory = dirname(directory);
  }
}
for (const directory of [...directories].sort((left, right) => right.length - left.length)) chmodSync(directory, 0o555);
chmodSync(join(snapshot, "src"), 0o555);
const patchPath = "src/commands/diff-patch/patch.ts";
assert.equal(before.source.find(entry => entry.path === patchPath).sha256, "b344c6f7b0f6afaccdab75778a12c11c868d7f8bccd5d453c56e552039e619fe");
const liveDiffPatchBefore = sourceFiles.filter(entry => entry.path.startsWith("src/commands/diff-patch/")).map(entry => ({ path: entry.path, sha256: sha256(readFileSync(join(root, entry.path))) }));
assert.deepEqual(liveDiffPatchBefore, before.source.filter(entry => entry.path.startsWith("src/commands/diff-patch/")).map(({ path, sha256 }) => ({ path, sha256 })));
const identities = classification.identities.map(identity => {
  const bytes = readFileSync(identity.binary);
  assert.equal(sha256(bytes), identity.sha256);
  const version = execute(identity.binary, ["--version"], { cwd: snapshot, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" } }).trim();
  assert.equal(version.split("\n")[0], identity.version.split("\n")[0]);
  return { ...identity, realpath: realpathSync(identity.binary), version };
});
const oldEnvironment = JSON.parse(readFileSync(join(historicalEvidence, "environment.json")));
assert.equal(process.version, oldEnvironment.node);
assert.equal(process.platform, oldEnvironment.platform);
assert.equal(process.arch, oldEnvironment.arch);
const environment = { ...process.env, ...oldEnvironment.env };
delete environment.PARSER_EVIDENCE;
delete environment.NODE_OPTIONS;
delete environment.DIFF_PATCH_FUZZ_INDEX;
const suiteRuns = JSON.parse(readFileSync(join(historicalEvidence, "suite-runs.json")));
const correctedParser = JSON.parse(readFileSync(join(historicalEvidence, "parser-regressions-corrected.run.json")));
const selectedFiles = suites.flatMap(suite => readdirSync(join(snapshot, prefix, suite)).filter(name => name.endsWith(".test.ts")).map(name => `${prefix}${suite}/${name}`));
const typescript = createRequire(join(root, "package.json"))("typescript");
const pending = [...selectedFiles];
const graph = new Map();
while (pending.length) {
  const path = pending.pop();
  if (graph.has(path)) continue;
  const text = readFileSync(join(snapshot, path), "utf8");
  const tree = typescript.createSourceFile(path, text, typescript.ScriptTarget.Latest, true);
  const imports = [];
  const visit = node => {
    if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier) imports.push(node.moduleSpecifier.text);
    if (typescript.isCallExpression(node) && node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
      assert(typescript.isStringLiteral(node.arguments[0]), `Computed dynamic import in ${path}`);
      imports.push(node.arguments[0].text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(tree);
  const edges = imports.map(specifier => {
    if (specifier.startsWith("node:")) return { specifier, builtin: true };
    assert(specifier.startsWith("."), `Nonrelative product/test import: ${path}: ${specifier}`);
    const candidate = resolve(snapshot, dirname(path), specifier);
    const target = existsSync(candidate) ? candidate : candidate.replace(/\.js$/, ".ts");
    assert(target.startsWith(`${snapshot}/`), `Import escapes snapshot: ${path}: ${specifier}`);
    assert(existsSync(target), `Unresolved: ${path}: ${specifier}`);
    const destination = relative(snapshot, target);
    pending.push(destination);
    return { specifier, destination };
  });
  graph.set(path, edges);
}
writeFileSync(join(evidence, "import-graph.json"), `${JSON.stringify(Object.fromEntries([...graph].sort()), null, 2)}\n`);
writeFileSync(join(evidence, "manifest-before.json"), `${JSON.stringify(before, null, 2)}\n`);
const outcomes = [];
const runs = [];
for (const suite of suites) {
  const selected = failures.filter(item => suite === "formats" ? item.artifact === "formats-full.stdout"
    : suite === "parser-regressions" ? item.artifact === "parser-regressions-corrected.stdout"
    : item.artifact === "compatibility.stdout" && (suite === "fuzz" ? item.category === "gnu-patch-defect" : item.category !== "gnu-patch-defect"));
  const pattern = `^(?:${selected.map(item => item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
  const originalArgs = suite === "formats" ? suiteRuns.find(run => run.name === "formats-full").args
    : suite === "parser-regressions" ? correctedParser.args
    : ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...selectedFiles.filter(path => path.startsWith(`${prefix}${suite}/`))];
  const testOffset = originalArgs.findIndex(argument => argument.endsWith(".test.ts"));
  const args = [...originalArgs.slice(0, testOffset), `--test-name-pattern=${pattern}`, ...originalArgs.slice(testOffset)];
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: snapshot, env: environment, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  for (const stream of ["stdout", "stderr"]) writeFileSync(join(evidence, `${suite}.${stream}`), result[stream] ?? "");
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  const headers = [...result.stdout.matchAll(/^(not ok|ok) (\d+) - (.+)$/gm)];
  const harnessSkips = headers.filter(match => match[3].includes("# SKIP")).length;
  for (const item of selected) {
    const matching = headers.filter(match => match[3] === item.name || match[3].startsWith(`${item.name} # `));
    assert.equal(matching.length, 1, `Expected exactly one literal test: ${item.name}`);
    const match = matching[0];
    assert.equal(match[3], item.name, `Selected skip/TODO: ${match[3]}`);
    const end = result.stdout.indexOf("\n# Subtest:", match.index);
    const block = result.stdout.slice(match.index, end === -1 ? undefined : end);
    assert(!/failureType: '(?:cancelledByParent|testTimeoutFailure)'/.test(block), `Selected cancellation: ${item.name}`);
    outcomes.push({ ...item, suite, status: match[1] === "ok" ? "pass" : "fail", failure: match[1] === "ok" ? null : block.trim() });
  }
  const selectedHeaders = headers.filter(match => !match[3].includes("# SKIP"));
  const fileHarness = selectedHeaders.filter(match => !selected.some(item => item.name === match[3]));
  assert(fileHarness.every(match => match[1] === "ok" && match[3].endsWith(".test.ts")), `Unexpected harness outcome: ${JSON.stringify(fileHarness)}`);
  assert.equal(Number(result.stdout.match(/^# cancelled (\d+)$/m)?.[1] ?? 0), 0);
  runs.push({ suite, cwd: snapshot, executable: process.execPath, originalArgs, args, status: result.status, durationMs: Date.now() - started,
    selected: selected.length, harnessSkips, emptyFileHarnessPasses: fileHarness.length,
    summary: result.stdout.split("\n").filter(line => /^# (tests|pass|fail|cancelled|skipped|todo|duration_ms)/.test(line)),
    logs: ["stdout", "stderr"].map(stream => ({ path: join(evidence, `${suite}.${stream}`), sha256: sha256(result[stream] ?? "") })) });
  console.log(JSON.stringify({ suite, selected: selected.length, passed: outcomes.filter(item => item.suite === suite && item.status === "pass").length, failed: outcomes.filter(item => item.suite === suite && item.status === "fail").length, harnessSkips }));
}
assert.equal(outcomes.length, 30);
const after = { historical: capture(historicalFiles), source: capture(sourceFiles) };
assert.deepEqual(after, before);
const liveDiffPatchAfter = liveDiffPatchBefore.map(entry => ({ path: entry.path, sha256: sha256(readFileSync(join(root, entry.path))) }));
assert.deepEqual(liveDiffPatchAfter, liveDiffPatchBefore);
for (const identity of identities) assert.equal(sha256(readFileSync(identity.binary)), identity.sha256);
writeFileSync(join(evidence, "manifest-after.json"), `${JSON.stringify(after, null, 2)}\n`);
const result = {
  capturedAt: new Date().toISOString(), baseline, sourceCommit, classificationRevision: git("rev-parse", classificationRevision).toString().trim(),
  reproducerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  classificationSha256: sha256(classificationBytes), root, snapshot, evidence, node: process.version, executable: process.execPath,
  platform: process.platform, arch: process.arch, nodeModules: realpathSync(join(snapshot, "node_modules")),
  environment: Object.fromEntries(Object.keys(oldEnvironment.env).map(key => [key, environment[key] ?? null])),
  environmentNotes: "Original corrected parser: PARSER_EVIDENCE unset. No fuzz index or NODE_OPTIONS. Historical GIT_DIR/WORK_TREE retained verbatim but unused: direct selected test invocations do not invoke git. Every test cwd is the new snapshot. Native child environments and flags unchanged in immutable helpers.",
  tooling: { tsx: createRequire(join(root, "package.json"))("tsx/package.json").version, typescript: typescript.version },
  oracles: identities, selected: 30, passed: outcomes.filter(item => item.status === "pass").length,
  failed: outcomes.filter(item => item.status === "fail").length, selectedSkipped: 0, selectedCancelled: 0,
  hashesUnchanged: true, historicalFilesVerified: historicalFiles.length, sourceFilesVerified: sourceFiles.length,
  sourceTree: git("rev-parse", `${sourceCommit}:src`).toString().trim(),
  diffPatchTree: git("rev-parse", `${sourceCommit}:src/commands/diff-patch`).toString().trim(),
  liveDiffPatchBefore, liveDiffPatchAfter,
  importGraph: { path: join(evidence, "import-graph.json"), sha256: sha256(readFileSync(join(evidence, "import-graph.json"))), files: graph.size, escapes: 0, method: "TypeScript AST static/dynamic literal import closure; all non-builtin imports resolve within snapshot. No runtime loader instrumentation or test edits." },
  artifacts: ["historical.tar", "source.tar", "manifest-before.json", "manifest-after.json"].map(name => ({ path: join(evidence, name), sha256: sha256(readFileSync(join(evidence, name))) })),
  manifest: { historical: before.historical.filter(entry => !entry.path.startsWith("tests/") || suites.some(suite => entry.path.startsWith(`${prefix}${suite}/`))), source: before.source },
  runs, outcomes,
};
writeFileSync(join(evidence, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ result: join(evidence, "result.json"), selected: result.selected, passed: result.passed, failed: result.failed }));
