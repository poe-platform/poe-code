import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const home = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(home, "../../../..");
const sourceCommit = "4f01c1593486c1abff3b007f9a3b16923b88559f";
const fixtureCommit = "efb1a25aa3e2544cf71aba10f2aaa54b256091ff";
const fixture = "tests/commands/expr/inactive-prefix.test.ts";
const oldMessage = "expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n";
const newMessage = "expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n";
const runName = process.argv[2];
assert(runName && /^run-[a-z0-9-]+$/.test(runName), "opt-in: supply a fresh run-NAME");
const output = path.join(home, runName);
fs.mkdirSync(output);
const temporary = fs.mkdtempSync(path.join(output, ".owned-"));
const candidate = path.join(temporary, "candidate");
fs.mkdirSync(candidate);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const text = (...args) => git(...args).toString().trim();
const snapshot = (directory, prefix = "") => fs.readdirSync(directory).sort().flatMap(name => {
  const relative = prefix + name;
  const absolute = path.join(directory, name);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return [{ path: relative, link: fs.readlinkSync(absolute) }];
  if (stat.isDirectory()) return [{ path: relative, directory: true }, ...snapshot(absolute, relative + "/")];
  assert(stat.isFile(), `unexpected entry ${relative}`);
  return [{ path: relative, bytes: stat.size, sha256: digest(fs.readFileSync(absolute)) }];
});
const executions = [];
const execute = (label, args, expectedStatus) => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, {
    cwd: candidate, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "", TSX_DISABLE_CACHE: "1" },
  });
  fs.writeFileSync(path.join(output, label + ".log"), result.stdout ?? "", { flag: "wx" });
  executions.push({ label, executable: process.execPath, args, started, finished: new Date().toISOString(),
    pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stderr: result.stderr });
  assert.equal(result.error, undefined, label);
  assert.equal(result.signal, null, label);
  assert.equal(result.status, expectedStatus, `${label}: ${result.stderr}`);
  return result.stdout;
};
const rows = [
  ["length", "inactive-length"], ["index", "inactive-index", "z"],
  ["substr", "inactive-substr", "999", "888"], ["match", "inactive-match", "["],
];
const expectedFailures = rows.map(args => `active ${args[0]} still rejects unsupported character locale`);
const strict = ["--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext",
  "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
  "--forceConsistentCasingInFileNames", "--skipLibCheck", "false", "--types", "node"];
const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
let completed = false;
try {
  const original = git("show", `${sourceCommit}:${fixture}`).toString();
  const overlay = git("show", `${fixtureCommit}:${fixture}`).toString();
  const oldLiteral = JSON.stringify(oldMessage), newLiteral = JSON.stringify(newMessage);
  assert.equal(text("diff-tree", "--no-commit-id", "--name-only", "-r", fixtureCommit), fixture);
  assert.equal(text("diff", "--numstat", `${fixtureCommit}^`, fixtureCommit), `1\t1\t${fixture}`);
  assert.equal(git("show", `${fixtureCommit}^:${fixture}`).toString(), original);
  assert.equal(original.split(oldLiteral).length, 2);
  assert.equal(original.replace(oldLiteral, newLiteral), overlay);
  const parsed = ts.createSourceFile(fixture, overlay, ts.ScriptTarget.Latest, true);
  let prefixDefinitions = 0, messageLiterals = 0, activeLoops = 0;
  const inspect = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "inactivePrefixes") {
      prefixDefinitions++;
      assert(ts.isAsExpression(node.initializer));
      assert(ts.isArrayLiteralExpression(node.initializer.expression));
      assert.deepEqual(node.initializer.expression.elements.map(element => {
        assert(ts.isArrayLiteralExpression(element));
        return element.elements.map(value => { assert(ts.isStringLiteral(value)); return value.text; });
      }), rows);
    }
    if (ts.isStringLiteral(node) && node.text === newMessage) {
      messageLiterals++;
      let ancestor = node.parent;
      while (ancestor && !ts.isForOfStatement(ancestor)) ancestor = ancestor.parent;
      assert(ancestor && ancestor.expression.getText(parsed) === "inactivePrefixes");
      activeLoops++;
      assert.match(ancestor.getText(parsed), /LC_ALL: "unsupported-inactive-profile"/);
      assert.match(ancestor.getText(parsed), /assert\.deepEqual\(observed\.jobs, \[\]\)/);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  assert.deepEqual([prefixDefinitions, messageLiterals, activeLoops], [1, 1, 1]);
  save("delta.json", { sourceCommit, fixtureCommit, fixtureParent: text("rev-parse", `${fixtureCommit}^`),
    fixture, originalSha256: digest(original), overlaySha256: digest(overlay), oldMessage, newMessage,
    commitChangedFiles: 1, changedLiteralCount: 1, expandedAssertions: 4, changedInputs: 0,
    exactWholeFileReplacement: true, unchanged: ["argv", "options", "LC_ALL", "status 2", "empty stdout", "jobs", "encoding", "cancellation", "all other bytes"],
    rows: rows.map(args => ({ args, options: {}, env: { LC_ALL: "unsupported-inactive-profile" },
      before: [2, "", oldMessage], after: [2, "", newMessage], jobs: [] })) });
  const inputs = ["src", "package.json", "package-lock.json", "tsconfig.json", fixture,
    "tests/commands/expr/helpers.ts", "tests/commands/expr/contracts.test.ts"];
  const archive = git("archive", "--format=tar", sourceCommit, ...inputs);
  execFileSync("tar", ["-xf", "-", "-C", candidate], { input: archive });
  const archiveEntries = snapshot(candidate);
  const tracked = git("ls-tree", "-rz", sourceCommit, "--", ...inputs).toString().split("\0").filter(Boolean);
  assert.equal(archiveEntries.filter(entry => entry.sha256).length, tracked.length);
  for (const record of tracked) {
    const [metadata, filename] = record.split("\t");
    const [mode, kind, object] = metadata.split(" ");
    assert.equal(kind, "blob"); assert.equal(mode, "100644");
    const bytes = fs.readFileSync(path.join(candidate, filename));
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), object);
  }
  const sourceBefore = snapshot(path.join(candidate, "src"));
  save("inputs.json", archiveEntries);
  const tooling = ["typescript", "tsx", "@types/node", "esbuild"].map(name => {
    const manifest = fs.readFileSync(path.join(repository, "node_modules", name, "package.json"));
    return { name, version: JSON.parse(manifest).version, packageJsonSha256: digest(manifest) };
  });
  save("binding.json", { sourceCommit, fixtureCommit, sourceGitTree: text("rev-parse", `${sourceCommit}:src`),
    sourceSha256: digest(JSON.stringify(sourceBefore)), sourceFileCount: sourceBefore.filter(entry => entry.sha256).length,
    inputs, archiveSha256: digest(archive), inputFileCount: tracked.length, captureDriverSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
    liveHeadContextOnly: text("rev-parse", "HEAD"), node: process.version, platform: process.platform, arch: process.arch,
    tooling, compilerSha256: digest(fs.readFileSync(compiler)), liveSourceUsed: false, dependenciesInstalled: false,
    externalToolchainCaveat: "Existing node_modules symlink; versions and selected file hashes, not a fully frozen or rebuilt toolchain." });
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(candidate, "node_modules"), "dir");
  execute("worker-build", [compiler, ...strict, "--rootDir", "src", "--outDir", "dist", "src/commands/regex-execution/worker.ts"], 0);
  const sealedTree = snapshot(candidate);
  const generated = sealedTree.filter(entry => entry.path === "dist" || entry.path.startsWith("dist/") || entry.path === "node_modules");
  assert.deepEqual(sealedTree.filter(entry => !generated.includes(entry)), archiveEntries);
  save("generated.json", generated);
  const integrity = [];
  const checkTree = (label, contents) => {
    const expected = sealedTree.map(entry => entry.path === fixture ? { ...entry, bytes: Buffer.byteLength(contents), sha256: digest(contents) } : entry);
    const actual = snapshot(candidate);
    assert.deepEqual(actual, expected, label + ": full tree including appended files/directories/symlinks");
    assert.deepEqual(snapshot(path.join(candidate, "src")), sourceBefore);
    integrity.push({ label, treeSha256: digest(JSON.stringify(actual)), sourceSha256: digest(JSON.stringify(sourceBefore)),
      entries: actual.length, fixtureSha256: digest(contents), completeEntrySetChecked: true, sourceUnchanged: true, generatedWorkerUnchanged: true });
  };
  const results = {};
  let baselineNames;
  const runtime = (label, contents, fail) => {
    fs.writeFileSync(path.join(candidate, fixture), contents);
    checkTree(label + "-before", contents);
    const tap = execute(label, ["--import", "tsx", "--test", "--test-reporter=tap", fixture], fail ? 1 : 0);
    const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
      const match = tap.match(new RegExp(`^# ${key} (\\d+)$`, "m")); assert(match); return [key, Number(match[1])];
    }));
    assert.deepEqual(counts, { tests: 68, pass: 68 - fail, fail, cancelled: 0, skipped: 0, todo: 0 });
    const names = [...tap.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map(match => match[1]);
    baselineNames ??= names;
    assert.deepEqual(names, baselineNames);
    const failures = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(failures, fail ? expectedFailures : []);
    if (fail) assert.equal([...tap.matchAll(/code: 'ERR_ASSERTION'/g)].length, 4);
    checkTree(label + "-after", contents);
    results[label] = { ...counts, failures };
  };
  checkTree("initial", original);
  execute("original-strict-types", [compiler, ...strict, "--noEmit", "--listFiles", fixture], 0);
  runtime("original-4f", original, 4);
  runtime("efb-fixture-overlay", overlay, 0);
  execute("overlay-strict-types", [compiler, ...strict, "--noEmit", "--listFiles", fixture], 0);
  checkTree("overlay-types-after", overlay);
  const wrongWording = overlay.replace(newLiteral, JSON.stringify(newMessage.replace("qualified", "WRONG-INDEPENDENT-CONTROL")));
  const tuple = `[2, "", ${newLiteral}]`;
  assert.equal(overlay.split(tuple).length, 2);
  const wrongStatus = overlay.replace(tuple, `[0, "", ${newLiteral}]`);
  runtime("negative-wording", wrongWording, 4);
  runtime("negative-status", wrongStatus, 4);
  fs.writeFileSync(path.join(candidate, fixture), overlay);
  checkTree("restored-overlay-final", overlay);
  save("integrity.json", integrity);
  save("summary.json", { sourceCommit, fixtureCommit, results, strictOriginalStatus: 0, strictOverlayStatus: 0, workerBuildStatus: 0,
    sourceBeforeSha256: digest(JSON.stringify(sourceBefore)), sourceAfterSha256: digest(JSON.stringify(snapshot(path.join(candidate, "src")))),
    mutationControls: { wrongWordingSha256: digest(wrongWording), wrongStatusSha256: digest(wrongStatus), onlyOwnedTemporaryFixtureCopies: true },
    original225HistoricalNotRescored: "221/225 remains immutable historical RED", older217Separate: "217/217 different source composition, not merged",
    untouchedNotRerun: ["contracts.test.ts:40 stale en_US assertion (1)", "byte-cap RED (1)", "encounter-ordering failures (19)"],
    scope: "Independent fixture-only 4f-source + efb-fixture overlay; not current HEAD, public expr, GNU, whole gate, or product qualification." });
  completed = true;
} finally {
  save("executions.json", executions);
  fs.rmSync(temporary, { recursive: true, force: true });
  save("cleanup.json", { completed, temporaryRemoved: !fs.existsSync(temporary), ownedRunningChildren: 0,
    model: "Synchronous bounded children settled; worker threads belong to exited Node test processes; no detached children or separate lifecycle instrumentation.",
    nativeOracleStarted: false, globalBuild: false, hostTools: ["git", "tar", "node"], finished: new Date().toISOString() });
}
