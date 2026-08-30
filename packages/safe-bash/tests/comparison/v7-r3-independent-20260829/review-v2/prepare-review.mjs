import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const inputs = JSON.parse(fs.readFileSync(path.join(home, 'INPUTS.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of inputs.files) {
  const stat = fs.lstatSync(entry.absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, entry.bytes);
  assert.equal(stat.mode & 0o7777, entry.mode);
  const digest = createHash('sha256');
  for await (const bytes of fs.createReadStream(entry.absolute)) digest.update(bytes);
  assert.equal(digest.digest('hex'), entry.sha256, entry.absolute);
}
const root = inputs.root;
const work = path.join(home, 'work');
fs.mkdirSync(work);
const replace = (source, before, after) => {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, after);
};
const read = relative => {
  const filename = path.join(root, relative);
  assert.ok(inputs.files.some(entry => entry.absolute === filename));
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
  return fs.readFileSync(filename, 'utf8');
};
const put = (name, bytes) => fs.writeFileSync(path.join(work, name), bytes, { flag: 'wx', mode: 0o644 });
const sourceNames = ['prepare-controls.mjs', 'test.mjs'];
const adapters = [];
for (const name of sourceNames) {
  let source = read(`runs/control-preparation-v2/${name}`);
  source = source.replaceAll("from '../../", `from '${pathToFileURL(root + path.sep).href}`);
  source = replace(source, "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');", `const root = ${JSON.stringify(root)};`);
  source = replace(source, name === 'test.mjs' ? "path.join(root, 'runs/ordering-stubs-v2-01')" : "path.join(root, 'runs', 'ordering-stubs-v2-01')", JSON.stringify(path.join(work, 'eight')));
  assert.ok(source.includes('createEvidenceBudget(') && source.includes('67108864'));
  put(name, source);
  adapters.push({ name, bytes: Buffer.byteLength(source), sha256: hash(source) });
}
let fixture = read('fixture.mjs');
fixture = fixture.replaceAll("from './", `from '${pathToFileURL(root + path.sep).href}`);
fixture = replace(fixture, 'const root = path.dirname(fileURLToPath(import.meta.url));', `const root = ${JSON.stringify(root)};`);
fixture = replace(fixture, "fs.readFileSync(path.join(root, 'stub-index.data'), 'utf8')", `fs.readFileSync(${JSON.stringify(path.join(home, 'novel-index.data'))}, 'utf8')`);
put('fixture-adapter.mjs', fixture);
adapters.push({ name: 'fixture-adapter.mjs', bytes: Buffer.byteLength(fixture), sha256: hash(fixture) });
put('ADAPTERS.json', JSON.stringify(adapters, null, 2) + '\n');
await import(pathToFileURL(path.join(work, 'prepare-controls.mjs')));
const prepared = JSON.parse(fs.readFileSync(path.join(work, 'eight/PREPARATION.json')));
const { readDocument } = await import(pathToFileURL(path.join(root, 'records.mjs')));
const eight = readDocument(path.join(work, 'eight'), prepared.reference.path, prepared.reference.sha256);
assert.equal(eight.cases.length, 8);
const { buildFixture, helperClosure } = await import(pathToFileURL(path.join(work, 'fixture-adapter.mjs')));
const extras = [];
for (const specimen of [
  { id: 'X01', variant: 'caught-after-slots', exit: 1 },
  { id: 'X02', variant: 'late-alias', exit: 1 },
  { id: 'X03', variant: 'guard-evaluation', exit: 1 },
]) {
  const closure = helperClosure();
  if (specimen.id === 'X03') {
    const worker = path.join(root, 'worker.mjs');
    let source = closure.get(worker).toString('utf8');
    const install = "  offline = installOffline(config.view, value => writer.emit(value));\n  writer.emit({ kind: 'worker-offline-installed', operationId: operation.id, entryURL: consumerURL });\n";
    source = replace(source, install, '');
    source = replace(source, '  const library = imported.library;', install + '  const library = imported.library;');
    closure.set(worker, Buffer.from(source));
  }
  extras.push(buildFixture(path.join(work, specimen.id), specimen, closure));
}
put('EXTRAS.json', JSON.stringify(extras, null, 2) + '\n');
const files = [];
const visit = directory => {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) visit(filename);
    else {
      assert.ok(stat.isFile() && stat.size <= 1048576);
      const bytes = fs.readFileSync(filename);
      files.push({ path: path.relative(work, filename), bytes: bytes.length, mode: stat.mode & 0o7777, sha256: hash(bytes) });
    }
  }
};
visit(work);
const seal = { schema: 'INDEPENDENT_R3_STUBS_PRELOAD_V2', adapters, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), originalFamilies: 8, novelWholeWorkers: 3, fixtureAuthorityNotProduction: true };
assert.ok(seal.totalBytes < 32 * 1024 * 1024);
fs.writeFileSync(path.join(home, 'PRELOAD-SEAL.json'), JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ prepared: true, files: files.length, bytes: seal.totalBytes, sealSha256: hash(JSON.stringify(seal, null, 2) + '\n') }) + '\n');
