import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
const started = process.hrtime.bigint();
const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
const artifact = name => {
  const bytes = readFileSync(join(root, name));
  assert.equal(hash(bytes), seal.files.find(row => row.path === name).sha256, name);
  return JSON.parse(bytes);
};
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
console.log(JSON.stringify({ kind: 'birth', role: 'compiler', pid: process.pid, ppid: process.ppid, version: process.version }));
const compilerPath = join(seal.typescript.root, 'lib/typescript.js');
assert.equal(hash(readFileSync(compilerPath)), seal.typescript.rows.find(row => row.path === 'lib/typescript.js').sha256);
const compiler = createRequire(import.meta.url)(compilerPath);
assert.equal(compiler.version, '5.9.3');
const options = { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ES2022, sourceMap: false, declaration: false };
const originals = artifact('PACKAGE-DATA.json').modules;
const transforms = artifact('TRANSFORMS.json').moduleTransforms;
const app = join(root, 'RUN-01/app');
mkdirSync(app);
const files = [];
const receipts = [];
for (const item of originals) {
  assert.ok(elapsed() < 120000, 'setup deadline');
  let bytes = Buffer.from(item.base64, 'base64');
  assert.equal(hash(bytes), item.sha256);
  const transform = transforms.find(row => row.emitPath === item.path);
  if (transform) {
    const source = Buffer.from(transform.transformedBase64, 'base64');
    assert.equal(hash(source), transform.transformedSha256);
    const result = compiler.transpileModule(source.toString(), { fileName: transform.path, compilerOptions: options, reportDiagnostics: true });
    const errors = (result.diagnostics ?? []).filter(row => row.category === compiler.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, JSON.stringify(errors.map(row => ({ code: row.code, message: row.messageText }))));
    bytes = Buffer.from(result.outputText);
    receipts.push({ path: transform.path, transformedSourceSha256: transform.transformedSha256, originalSourceSha256: transform.originalSha256,
      originalEmitSha256: item.sha256, emittedSha256: hash(bytes), bytes: bytes.length, compilerOptions: seal.compilerOptions, compilerSha256: hash(readFileSync(compilerPath)) });
  }
  const target = join(app, item.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  files.push({ path: target, sha256: hash(bytes), bytes: bytes.length, role: transform ? 'instrumented-emitted-module' : 'authenticated-original-emit' });
}
assert.equal(receipts.length, 5);
for (const name of ['worker.mjs', 'adapter.mjs', 'cases.mjs', 'fixtures.mjs']) {
  const bytes = readFileSync(join(root, name));
  assert.equal(hash(bytes), seal.files.find(row => row.path === name).sha256);
  files.push({ path: join(root, name), sha256: hash(bytes), bytes: bytes.length, role: 'sealed-harness' });
}
const result = { kind: 'compiled', pid: process.pid, ppid: process.ppid, elapsedMs: elapsed(), compilerPath,
  compilerSha256: hash(readFileSync(compilerPath)), compilerVersion: compiler.version, transforms: receipts,
  originalEmitsReused: 219, changedEmits: 5, totalModules: files.length, files };
writeFileSync(join(root, 'RUN-01/MODULES.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, files: undefined }));
