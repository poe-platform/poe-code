import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const [outputArgument, patchArgument, patchHash, workerHash, receiptArgument] = process.argv.slice(2);
assert.ok(outputArgument && patchArgument && patchHash && workerHash && receiptArgument, 'required: owned output, patch, patch SHA256, worker SHA256, receipt');
const output = path.resolve(outputArgument);
assert.ok(output.startsWith(`${directory}/isolated-`));
mkdirSync(output);
const source = path.join(output, 'source');
mkdirSync(source);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = (command, argv, options = {}) => {
  const result = spawnSync(command, argv, { cwd: root, timeout: 30_000, maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
};
const base = JSON.parse(readFileSync(path.join(directory, 'CASES.json'))).base;
const patch = readFileSync(path.resolve(patchArgument));
assert.equal(hash(patch), patchHash);
const receipt = readFileSync(path.resolve(receiptArgument));
assert.ok(receipt.includes(Buffer.from(patchHash)) && receipt.includes(Buffer.from(workerHash)), 'receipt must authenticate both exact supplied hashes');
const touched = [...patch.toString().matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(match => [match[1], match[2]]);
assert.deepEqual(touched, [['src/commands/expr/bre-worker.ts', 'src/commands/expr/bre-worker.ts']]);
const tests = ['regex-protocol.test.ts', 'regex-lifecycle.test.ts', 'regex-limits.test.ts', 'abort-reason-regression.test.ts', 'helpers.ts'].map(name => `tests/commands/expr/${name}`);
const archive = execute('/usr/bin/git', ['archive', '--format=tar', base, 'src', 'package.json', ...tests]);
execute('/usr/bin/tar', ['-xf', '-', '-C', source], { input: archive });
const inventory = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
  const filename = path.join(folder, entry.name);
  return entry.isDirectory() ? inventory(filename) : [{ path: path.relative(source, filename), sha256: hash(readFileSync(filename)) }];
}).sort((left, right) => left.path.localeCompare(right.path));
const before = inventory(source);
const expectedBaseWorker = execute('/usr/bin/git', ['show', `${base}:src/commands/expr/bre-worker.ts`]);
assert.equal(hash(readFileSync(path.join(source, 'src/commands/expr/bre-worker.ts'))), hash(expectedBaseWorker));
writeFileSync(path.join(output, 'candidate.patch'), patch, { flag: 'wx' });
const patchLog = execute('/usr/bin/patch', ['-p1', '-F', '0', '-t', '-i', path.join(output, 'candidate.patch')], { cwd: source }).toString();
const after = inventory(source);
assert.deepEqual(after.map(entry => entry.path), before.map(entry => entry.path));
const changed = after.filter((entry, index) => entry.sha256 !== before[index].sha256);
assert.deepEqual(changed, [{ path: 'src/commands/expr/bre-worker.ts', sha256: workerHash }]);
const emitted = [];
for (const entry of after.filter(entry => entry.path.endsWith('.ts') && !entry.path.endsWith('.d.ts'))) {
  const input = readFileSync(path.join(source, entry.path), 'utf8');
  const result = ts.transpileModule(input, { fileName: entry.path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true } });
  assert.equal((result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, entry.path);
  const relative = entry.path.replace(/\.ts$/, '.js');
  const filename = path.join(output, 'compiled', relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, result.outputText, { flag: 'wx' });
  emitted.push({ path: relative, sha256: hash(result.outputText) });
}
writeFileSync(path.join(output, 'compiled/package.json'), '{"type":"module"}\n', { flag: 'wx' });
const shared = ['protocol', 'client', 'worker', 'matching'].map(name => {
  const filename = `src/commands/regex-execution/${name}.ts`;
  return { path: filename, sha256: after.find(entry => entry.path === filename).sha256, baseSha256: hash(execute('/usr/bin/git', ['show', `${base}:${filename}`])) };
});
for (const entry of shared) assert.equal(entry.sha256, entry.baseSha256);
const manifest = { created: new Date().toISOString(), base, archiveSha256: hash(archive), overlayOrder: ['immutable git archive accepted base', 'single authenticated bre-worker.ts patch', 'TypeScript transpile-only to isolated compiled tree'], patchSha256: patchHash, workerSha256: workerHash, receiptSha256: hash(receipt), baseWorkerSha256: hash(expectedBaseWorker), patchLog, shared, before, after, emitted, transpiler: { version: ts.version, sha256: hash(readFileSync(path.join(root, 'node_modules/typescript/lib/typescript.js'))) }, caveat: 'Transpilation is not semantic typechecking. Every source entry is authenticated; before/after inventories detect added entries inside this isolated source tree. No live product source overlay.' };
writeFileSync(path.join(output, 'provenance.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
writeFileSync(path.join(output, 'receipt.txt'), receipt, { flag: 'wx' });
console.log(JSON.stringify({ output, workerSha256: workerHash, sources: after.length, shared }));
