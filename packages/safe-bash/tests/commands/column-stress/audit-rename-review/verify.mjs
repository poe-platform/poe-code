import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const commit = "219790c55c0214e6d46524bbdced63c18c360f62";
const historical = "a809635432f18a235b8fb622a05367bedc54b315";
const oldPath = "tests/commands/column/padding-evolution/preserved-source.test.ts";
const newPath = "tests/commands/column/padding-evolution/preserved-source.audit.ts";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 67108864, timeout: 30000 });
const parent = git("rev-parse", `${commit}^`).toString().trim();
const scratch = mkdtempSync("/tmp/safe-bash-column-audit-rename-");
console.log(JSON.stringify({ scratch, commit, actualParent: parent }));
const result = { classification: "tiny-independent-historical-audit-rename-review", commit, parent, historicalSourceCommit: historical, scratch, startedAt: new Date().toISOString(), liveContext: { head: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--short").toString(), index: git("diff", "--cached", "--name-only").toString() }, inspectionNotes: ["Initial inspection tried nonexistent tsconfig.tests.json and received the Git missing-path diagnostic; actual unchanged tsconfig.json was then inspected. No runtime or assertion failure resulted."], processes: [] };
const save = () => writeFileSync(join(scratch, "review-progress.json"), JSON.stringify(result, null, 2) + "\n");
const content = (revision, path) => git("show", `${revision}:${path}`);
const previous = content(parent, oldPath), renamed = content(commit, newPath);
assert(previous.equals(renamed));
assert.equal(hash(renamed), "3e84dc28815cd9c3e2a73cef50cd6457ee12fdcc1f5f91efb35033f783d07172");
const changes = git("diff-tree", "--no-commit-id", "-r", "-M", "--name-status", commit).toString().trim().split("\n");
assert.deepEqual(changes, ["A\ttests/commands/column/padding-evolution/audit-rename/README.md", "A\ttests/commands/column/padding-evolution/audit-rename/receipt.json", `R100\t${oldPath}\t${newPath}`]);
result.rename = { oldPath, newPath, bytes: renamed.length, sha256: hash(renamed), oldTreeEntry: git("ls-tree", parent, oldPath).toString().trim(), newTreeEntry: git("ls-tree", commit, newPath).toString().trim(), rawChanges: git("diff-tree", "--no-commit-id", "-r", "-M", "--raw", commit).toString(), changes };
assert(result.rename.oldTreeEntry.startsWith("100644 blob 86522c287a3055e2563abcb7d4d1e971414f690c\t"));
assert(result.rename.newTreeEntry.startsWith("100644 blob 86522c287a3055e2563abcb7d4d1e971414f690c\t"));
function tree(revision) {
  return git("ls-tree", "-rz", "--full-tree", revision).toString().split("\0").filter(Boolean).map((row) => { const separator = row.indexOf("\t"), [mode, type, blob] = row.slice(0, separator).split(" "); assert.equal(type, "blob"); return { path: row.slice(separator + 1), mode, blob }; });
}
function authenticate(root, entries) {
  for (const entry of entries) { const full = join(root, entry.path); const bytes = entry.mode === "120000" ? Buffer.from(readlinkSync(full)) : readFileSync(full); assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.blob, entry.path); }
  return { entries: entries.length, gitInventorySha256: hash(JSON.stringify(entries)), originalFixtureLinks: entries.filter((entry) => entry.mode === "120000").length };
}
const snapshots = [];
for (const [name, revision] of [["parent", parent], ["renamed", commit]]) {
  const archive = join(scratch, `${name}.tar`), root = join(scratch, name); mkdirSync(root);
  git("archive", "--format=tar", `--output=${archive}`, revision);
  execFileSync("/usr/bin/tar", ["-xf", archive, "-C", root], { timeout: 30000 });
  const entries = tree(revision); snapshots.push({ name, revision, root, entries, archiveSha256: hash(readFileSync(archive)), before: authenticate(root, entries) });
}
const parentRoot = snapshots[0].root, candidate = snapshots[1].root;
const packageBytes = readFileSync(join(candidate, "package.json")); assert(packageBytes.equals(readFileSync(join(parentRoot, "package.json"))));
const packageScript = JSON.parse(packageBytes).scripts.test;
assert(packageScript.includes("globSync('tests/**/*.test.ts', { exclude: path => path === 'tests/commands/regex-execution/continuation/artifacts/native' })"));
function discover(root) {
  const cwd = process.cwd(); process.chdir(root);
  try { return globSync("tests/**/*.test.ts", { exclude: path => path === "tests/commands/regex-execution/continuation/artifacts/native" }).sort(); }
  finally { process.chdir(cwd); }
}
const before = discover(parentRoot), after = discover(candidate);
assert.deepEqual(before.filter((path) => !after.includes(path)), [oldPath]);
assert.deepEqual(after.filter((path) => !before.includes(path)), []);
assert(!after.includes(newPath));
for (const path of after) assert(readFileSync(join(parentRoot, path)).equals(readFileSync(join(candidate, path))), path);
result.discovery = { method: "Actual unchanged package glob with process.cwd bound separately to each whole immutable archive; test runner not launched", script: packageScript, packageJsonSha256: hash(packageBytes), before: { count: before.length, sha256: hash(JSON.stringify(before)), paths: before }, after: { count: after.length, sha256: hash(JSON.stringify(after)), paths: after }, removed: [oldPath], added: [], retainedBehavioralPathsByteIdentical: after.length };
const sourcePaths = ["column", "display", "index", "internal", "options", "table"].map((name) => `src/commands/column/${name}.ts`);
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => { const bytes = readFileSync(join(candidate, path)); assert(bytes.equals(content(historical, path))); return [path, hash(bytes)]; }));
assert.equal(hash(JSON.stringify(sourceHashes)), "e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e");
const dataPath = "tests/commands/column/padding-evolution/preserved-source.json";
assert(readFileSync(join(candidate, dataPath)).equals(content(historical, dataPath)));
const siblings = Object.fromEntries(readdirSync(dirname(join(candidate, dataPath))).filter((name) => name.endsWith(".json")).map((name) => { const path = join(dirname(dataPath), name); assert(readFileSync(join(candidate, path)).equals(readFileSync(join(parentRoot, path)))); return [path, hash(readFileSync(join(candidate, path)))]; }));
result.source = { tree: git("rev-parse", `${commit}:src/commands/column`).toString().trim(), hashes: sourceHashes, sixFileDigest: hash(JSON.stringify(sourceHashes)), unchangedJsonSiblings: siblings, actualAuditRequirements: JSON.parse(readFileSync(join(candidate, dataPath))), scope: "Driver pins three complete files and two suffix sections, not all six complete files; six historical source files are independently authenticated. Whole rename snapshot includes other historical shared changes versus a809; not a single-source-change experiment." };
const prior = JSON.parse(readFileSync(join(repository, "tests/commands/column-stress/padding-evolution/execution-20260827/captures/auth-before.json")));
assert.equal(hash(readFileSync(join(candidate, "package-lock.json"))), prior.packageLock.sha256);
function inventory(directory, root = directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) { const path = join(directory, name), stat = lstatSync(path); if (stat.isSymbolicLink()) files.push({ path: relative(root, path), link: readlinkSync(path) }); else if (stat.isDirectory()) files.push(...inventory(path, root)); else files.push({ path: relative(root, path), sha256: hash(readFileSync(path)) }); }
  return files;
}
const installedLock = JSON.parse(readFileSync(join(repository, "node_modules/.package-lock.json")));
result.dependencies = [];
for (const dependency of prior.dependencies) {
  const directory = join(repository, dependency.path), files = inventory(directory);
  assert.deepEqual(files, dependency.files); assert.equal(JSON.parse(readFileSync(join(directory, "package.json"))).version, dependency.version); assert.equal(installedLock.packages[dependency.path].integrity, dependency.declaredIntegrity);
  const destination = join(candidate, dependency.path); mkdirSync(dirname(destination), { recursive: true }); symlinkSync(directory, destination, "dir");
  result.dependencies.push({ path: dependency.path, version: dependency.version, inventorySha256: hash(JSON.stringify(files)), files: files.length, declaredIntegrity: dependency.declaredIntegrity });
}
const compilerPath = join(candidate, "node_modules/typescript/lib/typescript.js");
const ts = (await import(pathToFileURL(compilerPath).href)).default;
const configs = ["tsconfig.json", "tsconfig.build.json", "scripts/typecheck.mjs", "scripts/typecheck-inputs.mjs"];
result.configs = Object.fromEntries(configs.map((path) => { assert(content(parent, path).equals(content(commit, path))); return [path, hash(content(commit, path))]; }));
const compilerMembership = (root) => { const path = join(root, "tsconfig.json"), config = ts.readConfigFile(path, ts.sys.readFile); assert.equal(config.error, undefined); const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root); assert.equal(parsed.errors.length, 0); return parsed.fileNames.map((file) => relative(root, file)).sort(); };
const oldTypes = compilerMembership(parentRoot), newTypes = compilerMembership(candidate);
assert(oldTypes.includes(oldPath)); assert(newTypes.includes(newPath)); assert(!newTypes.includes(oldPath));
assert.deepEqual(oldTypes.filter((path) => path !== oldPath), newTypes.filter((path) => path !== newPath));
result.compiler = { version: ts.version, parserSha256: hash(readFileSync(compilerPath)), beforeFiles: oldTypes.length, afterFiles: newTypes.length, oldIncluded: true, renamedAuditIncluded: true, removed: [oldPath], added: [newPath], beforeInventorySha256: hash(JSON.stringify(oldTypes)), afterInventorySha256: hash(JSON.stringify(newTypes)), scope: "Actual TypeScript config parsing proves membership only, not full-project typechecking. Separate explicit-file strict check follows." };
const syntax = ts.createSourceFile(newPath, renamed.toString(), ts.ScriptTarget.Latest, true);
const pins = syntax.statements.filter((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(syntax) === "test"); assert.equal(pins.length, 2);
const mutant = join(scratch, "rename-back-discovery-only"); mkdirSync(mutant);
for (const path of after) { mkdirSync(dirname(join(mutant, path)), { recursive: true }); writeFileSync(join(mutant, path), "", { flag: "wx" }); }
mkdirSync(dirname(join(mutant, newPath)), { recursive: true }); writeFileSync(join(mutant, newPath), renamed, { flag: "wx" });
assert.deepEqual(discover(mutant), after); renameSync(join(mutant, newPath), join(mutant, oldPath)); assert.deepEqual(discover(mutant), before);
const changed = Buffer.from(renamed); changed[changed.length - 1] ^= 1; assert.throws(() => assert.equal(hash(changed), hash(renamed)));
result.negatives = { renameBack: { classification: "Separate regular-file path inventory; empty behavioral placeholders never executed", restoredDefaultCount: discover(mutant).length, restoredHistoricalPins: pins.length, sameBeforeInventory: true }, changedByte: { expectedSha256: hash(renamed), mutatedSha256: hash(changed), rejected: true, productOrDriverEdited: false } };
function entries(root) { const output = []; function visit(directory) { for (const name of readdirSync(directory).sort()) { const path = join(directory, name), relativePath = relative(root, path), stat = lstatSync(path); if (stat.isSymbolicLink()) output.push({ path: relativePath, link: readlinkSync(path) }); else if (stat.isDirectory()) { output.push({ path: relativePath, directory: true }); visit(path); } else output.push({ path: relativePath, sha256: hash(readFileSync(path)) }); } } visit(root); return output; }
const runtimeBefore = entries(candidate); save();
async function execute(name, argv) {
  const child = spawn(process.execPath, argv, { cwd: candidate, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", TSX_DISABLE_CACHE: "1", TMPDIR: scratch } });
  const streams = { stdout: [], stderr: [] }, bytes = { stdout: 0, stderr: 0 }; let termination = null;
  const kill = (reason) => { termination ??= reason; if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timer = setTimeout(() => kill("deadline"), 15000);
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", (chunk) => { const remaining = Math.max(0, 65536 - bytes[stream]); bytes[stream] += chunk.length; streams[stream].push(Buffer.from(chunk.subarray(0, remaining))); if (bytes[stream] > 65536) kill(`${stream}-cap`); });
  const outcome = await new Promise((resolve) => child.once("close", (status, signal) => resolve({ status, signal })));
  clearTimeout(timer); let groupAlive = false; try { process.kill(-child.pid, 0); groupAlive = true; kill("surviving-group"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  const record = { name, command: [process.execPath, ...argv], cwd: candidate, pid: child.pid, deadlineMs: 15000, capPerStream: 65536, ...outcome, termination, groupAliveAtClose: groupAlive, stdoutHex: Buffer.concat(streams.stdout).toString("hex"), stderrHex: Buffer.concat(streams.stderr).toString("hex") };
  result.processes.push(record); save(); assert.equal(record.status, 0); assert.equal(record.signal, null); assert.equal(record.termination, null); return record;
}
const explicit = await execute("explicit-historical-audit", ["--import", "tsx", "--test", newPath]);
const tap = Buffer.from(explicit.stdoutHex, "hex").toString(); assert(tap.includes("# tests 2\n") && tap.includes("# pass 2\n") && tap.includes("# fail 0\n"));
await execute("strict-single-audit-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--types", "node", newPath]);
assert.deepEqual(entries(candidate), runtimeBefore);
for (const dependency of prior.dependencies) assert.deepEqual(inventory(join(repository, dependency.path)), dependency.files);
for (const snapshot of snapshots) snapshot.after = authenticate(snapshot.root, snapshot.entries);
const receiptPath = "tests/commands/column/padding-evolution/audit-rename/receipt.json";
result.authorReceipt = { path: receiptPath, sha256: hash(content(commit, receiptPath)), contents: JSON.parse(content(commit, receiptPath)), qualification: "Author live discovery counts are not canonical frozen inventory counts; this review compares the actual Git parent, not observedBaseCommit." };
result.snapshots = snapshots.map(({ entries, ...snapshot }) => snapshot);
result.runtime = { sourceDigest: result.source.sixFileDigest, exactDriverSha256: hash(renamed), parsedTestNames: pins.map((node) => node.expression.arguments[0].text), imports: syntax.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text), productModuleImports: [], sourceAccess: "Five historical files read by snapshot-relative file URLs; all six authenticated independently. JSON sibling read from the snapshot. No live source imports, build, full gate, behavioral suite or module replay.", namespaceBeforeAfterSha256: hash(JSON.stringify(runtimeBefore)), detectsNewEntriesIncludingEmptyDirectories: true, processesClosed: result.processes.length, node: { version: process.version, executable: realpathSync(process.execPath), sha256: hash(readFileSync(process.execPath)) }, lockedDependenciesBeforeAfterUnchanged: true, dependencyTrust: "Reused previously sealed file inventories plus installed version/integrity declarations; no new install or fresh registry/signature validation." };
result.decision = "PASS_RENAME_REVIEW_ONLY_PUBLIC_INTEGRATION_HOLD"; result.endedAt = new Date().toISOString(); save();
writeFileSync(join(scratch, "review.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output: join(scratch, "review.json"), parent, before: before.length, after: after.length, explicitPass: 2, strictTypeStatus: 0, auditStillCompilerIncluded: true, sourceDigest: result.source.sixFileDigest, processesClosed: result.processes.length }));
