import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const revision = 'd4ed8322ca01482e8eb591dcfa94f5ba28f76201';
const paths = ['tests/commands/split/integration.test.ts', 'tests/commands/stream-format-author-stress/contracts.test.ts'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const output = mkdtempSync(join(tmpdir(), 'registry-73-evidence-'));
const temporary = mkdtempSync(join(tmpdir(), 'registry-73-execution-'));
const report = { revision, output, node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, deltas: [], phases: [] };
try {
  const archive = join(temporary, 'source.tar'), source = join(temporary, 'source'); mkdirSync(source);
  git(['archive', '--format=tar', '--output='+archive, revision, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/split', 'tests/commands/stream-format', 'tests/commands/stream-format-author-stress']);
  execFileSync('/usr/bin/tar', ['-xf', archive, '-C', source]);
  cpSync(join(repository, 'node_modules'), join(source, 'node_modules'), { recursive: true, dereference: true });
  report.archiveSha256 = hash(readFileSync(archive));
  const productPaths = git(['ls-tree', '-r', '--name-only', revision, 'src']).toString().trim().split('\n');
  const product = () => Object.fromEntries(productPaths.map(path => [path, hash(readFileSync(join(source, path)))]));
  report.productBefore = product();
  const execute = label => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=2', ...paths], { cwd: source, env: { ...process.env, TSX_DISABLE_CACHE: '1' }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(join(output, label+'.tap'), result.stdout ?? ''); writeFileSync(join(output, label+'.stderr'), result.stderr ?? '');
    const counts = Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(name => [name, Number(result.stdout?.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1])]));
    report.phases.push({ label, status: result.status, signal: result.signal, error: result.error?.message, counts });
    return result;
  };
  assert.equal(execute('original').status, 1);
  for (const path of paths) {
    const before = readFileSync(join(source,path)); const after = readFileSync(join(repository,path));
    assert.equal(before.toString().split('70').length, 4, 'three exact historical count/title tokens');
    assert.equal(after.toString(), before.toString().replaceAll('70','73'), 'only three approved numeric/title changes per fixture');
    writeFileSync(join(output,path.split('/').at(-2)+'-original.data'), before);
    report.deltas.push({ path, before: hash(before), after: hash(after), changes: 3 });
    writeFileSync(join(source,path), after);
  }
  assert.equal(execute('revised').status, 0);
  for (const path of paths) {
    const correct = readFileSync(join(repository,path),'utf8');
    assert.equal(correct.split('length, 73)').length, 3, 'only two count assertions are mutated');
    writeFileSync(join(source,path), correct.replaceAll('length, 73)', 'length, 74)'));
  }
  assert.equal(execute('wrong-count-control').status, 1);
  assert.equal(report.phases.at(-1).counts.fail, 2);
  assert.deepEqual(product(), report.productBefore);
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = String(error.stack); process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = true; writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify({ output, status: report.status, phases: report.phases, error: report.error })); }
