import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const candidate = join(root, 'candidate');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = async (path, value) => writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const git = (args) => execFileSync('git', args, { cwd: repository, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const freeze = JSON.parse(await readFile(join(root, 'freeze.json')));
const build = JSON.parse(await readFile(join(root, 'build.json')));
assert.equal(freeze.commit, 'cd37ce07c1f41f3797e19e0f701b662823338843');
assert.equal(build.status, 0);
const records = [...freeze.files, ...freeze.dependencies, ...build.files];
const actualPaths = [];
async function walk(directory = candidate) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const metadata = await lstat(path);
    assert(!metadata.isSymbolicLink(), path);
    assert.equal(await realpath(path), path);
    if (metadata.isDirectory()) await walk(path);
    else {
      assert(metadata.isFile(), path);
      assert.equal(metadata.nlink, 1, `Hard-linked input: ${path}`);
      assert.equal(metadata.mode & 0o222, 0, `Writable input: ${path}`);
      actualPaths.push(relative(candidate, path));
    }
  }
}
await walk();
assert.deepEqual(actualPaths.sort(), records.map((entry) => entry.path).sort());
for (const entry of records) {
  const bytes = await readFile(join(candidate, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const require = createRequire(join(candidate, 'package.json'));
const typescript = require('./node_modules/typescript/lib/typescript.js');
const entries = ['dist/commands/file/index.js', 'dist/contracts/index.js', 'dist/shell/index.js'];
const closure = new Map();
const builtins = new Set();
async function inspect(path) {
  if (closure.has(path)) return;
  const bytes = await readFile(join(candidate, path));
  const source = typescript.createSourceFile(path, bytes.toString(), typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
  const imports = [];
  const dynamicCalls = [];
  function visit(node) {
    if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert(typescript.isStringLiteral(node.moduleSpecifier), `Computed static import: ${path}`);
      imports.push(node.moduleSpecifier.text);
    }
    if (typescript.isCallExpression(node) && (node.expression.kind === typescript.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) dynamicCalls.push(node.getText(source));
    typescript.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(dynamicCalls.length, 0, `Dynamic runtime import needs review: ${path}`);
  closure.set(path, { path, bytes: bytes.length, sha256: hash(bytes), imports, dynamicCalls });
  for (const specifier of imports) {
    if (specifier.startsWith('node:')) {
      assert(!/^node:(?:fs(?:\/promises)?|child_process|zlib)$/u.test(specifier), `${path}: ${specifier}`);
      builtins.add(specifier);
    } else {
      assert(specifier.startsWith('.'), `External product dependency: ${path}: ${specifier}`);
      const target = resolve(candidate, dirname(path), specifier);
      assert(target.startsWith(`${candidate}/dist/`), `Escaped closure: ${target}`);
      await inspect(relative(candidate, target));
    }
  }
}
for (const entry of entries) await inspect(entry);
const closureFiles = [...closure.values()].sort((left, right) => left.path.localeCompare(right.path));
const oldFreeze = JSON.parse(await readFile('/tmp/safe-bash-file-run.WeB7Vfsc/freeze.json'));
const oldBuild = JSON.parse(await readFile('/tmp/safe-bash-file-run.WeB7Vfsc/build.json'));
const oldHashes = new Map(oldFreeze.files.map((entry) => [entry.path, entry.sha256]));
const oldEmittedHashes = new Map(oldBuild.files.map((entry) => [entry.path, entry.sha256]));
const sourceChanges = freeze.files.filter((entry) => oldHashes.get(entry.path) !== entry.sha256).map((entry) => ({ path: entry.path, oldSha256: oldHashes.get(entry.path) ?? null, finalSha256: entry.sha256 }));
const closureChanges = closureFiles.filter((entry) => oldEmittedHashes.get(entry.path) !== entry.sha256).map((entry) => ({ path: entry.path, oldSha256: oldEmittedHashes.get(entry.path) ?? null, finalSha256: entry.sha256 }));
await save('static-closure.json', { checkedAt: new Date().toISOString(), entrypoints: entries, productLoadedEntries: [], productModulesLoaded: 0, classification: 'STATIC AST import/export closure only; no candidate modules executed', builtinImports: [...builtins].sort(), files: closureFiles, changedSinceOldBuild: closureChanges, familyApi: ['fileCommands', 'createFileCommands', 'createFileCommand'], registration: 'Manual real Shell plugin registration remains planned, not executed; root public exports are out of scope' });
await save('snapshot-integrity.json', { checkedAt: new Date().toISOString(), commit: freeze.commit, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, sourceFiles: freeze.files.length, dependencyFiles: freeze.dependencies.length, compiledFiles: build.files.length, totalRegularFiles: records.length, symlinks: 0, hardLinkedFiles: 0, writableFiles: 0, allManifestHashesVerified: true, lockedPackages: freeze.packageChecks.length, lockQualification: freeze.lockQualification, productCalls: 0, nativeCalls: 0 });
await save('source-deltas.json', { initialCommit: oldFreeze.commit, sqliteCommit: '9f7fed68077a68ef3decb114ace83ad47b75ae14', finalCommit: freeze.commit, sourceChanges, closureChanges, observation: 'Static deltas only, no measured SQLite/TEXT/candidate effects yet' });
for (const [name, before, after, paths] of [
  ['sqlite-source.diff', oldFreeze.commit, '9f7fed68077a68ef3decb114ace83ad47b75ae14', ['src/commands/file/classify.ts']],
  ['text-source.diff', '9f7fed68077a68ef3decb114ace83ad47b75ae14', freeze.commit, ['src/commands/file']],
]) await writeFile(join(root, name), git(['diff', before, after, '--', ...paths]), { flag: 'wx' });
const handoff = await readFile('/tmp/safe-bash-file-text-fix-detail.txt');
await writeFile(join(root, 'author-handoff.txt'), handoff, { flag: 'wx' });
const runner = await readFile(join(root, 'holdout/v2-runner.mjs'));
assert.equal(hash(runner), 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756');
await save('ready-binding.json', { candidateCommit: freeze.commit, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, authorHandoffSha256: hash(handoff), finalV2RunnerSha256: hash(runner), originalPreseal: '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297', sealedCaseInputs: 40, sealedContentAssertions: 80, historicalNativeObservations: 109, fixtureChanges: [], oracleChanges: [], harnessChangesThisPhase: [], options: { limits: { maxSniffBytes: 65536, maxReadFileBytes: 65536 } }, profile: 'Approved bounded-read profile: readFile cap64KiB, not default1MiB; other family defaults unchanged; family and Shell sink budgets remain distinct', plannedBounds: { sequentialChildren: true, perCaseTimeoutMs: 60000, globalTimeoutMs: 600000, initialCases: 40, retries: 0 }, readyState: 'FROZEN_BUILT_INPUTS_PREPARED_NOT_EXECUTED', freshProductCases: 0, reusedProductCasesAsFinalEvidence: 0, nativeCalls: 0, productLoadedEntries: [], remainingAdmission: 'Read completed independent prep report; explicitly verify GO final F29v2 and F33/F34 against exact runner hash before any candidate import/execution. Original child bridge not yet rebound/executed.' });
console.log(JSON.stringify({ verifiedRegularFiles: records.length, staticClosureFiles: closureFiles.length, changedClosureFiles: closureChanges, productModulesLoaded: 0, productCalls: 0, nativeCalls: 0 }, null, 2));
