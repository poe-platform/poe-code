import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFixture } from './prepare-fixture-v2.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../../..');
const baseline = 'c5d44262ecca11009df6ce32a180005d3f3cb574';
const label = process.argv[2];
if (!/^baseline-[0-9]{2}$/.test(label ?? '')) throw new Error('fresh baseline-NN label required');
const report = join(own, 'runs', label);
mkdirSync(report, { recursive: true });
const lock = join(report, 'started.json');
writeFileSync(lock, JSON.stringify({ label, baseline, started: new Date().toISOString() }, null, 2), { flag: 'wx' });
const work = join(own, '.work', label);
mkdirSync(work, { recursive: true });
const commands = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(name, data) { writeFileSync(join(report, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); }
function command(argv, cwd = root, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: 120000,
    maxBuffer: 32 * 1024 * 1024, ...options });
  commands.push({ argv, cwd, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error(`preparation command failed: ${JSON.stringify(argv)}`);
  return result.stdout;
}
function inventory(directory) {
  const result = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = join(path, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) { const bytes = readFileSync(filename); result.push({ path: relative(directory, filename), bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit(directory);
  return result;
}
try {
  const freezeCommit = command(['git', 'log', '-1', '--format=%H', '--', relative(root, join(own, 'cases.mjs'))]).trim();
  const frozenPaths = ['FROZEN.md', 'cases.mjs', 'consumer.mjs', 'baseline-provenance.json'];
  const frozen = frozenPaths.map(path => {
    const bytes = readFileSync(join(own, path));
    const committed = spawnSync('git', ['show', `${freezeCommit}:${relative(root, join(own, path))}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (committed.status !== 0 || !bytes.equals(committed.stdout)) throw new Error(`uncommitted/modified freeze ${path}`);
    return { path, sha256: hash(bytes) };
  });
  const provenance = JSON.parse(readFileSync(join(own, 'baseline-provenance.json'), 'utf8'));
  const source = join(work, 'source');
  mkdirSync(source);
  for (const entry of provenance.files.filter(entry => entry.kind === 'build-input')) {
    const result = spawnSync('git', ['show', `${baseline}:${entry.path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || hash(result.stdout) !== entry.sha256) throw new Error(`baseline source authentication failed ${entry.path}`);
    const filename = join(source, entry.path);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, result.stdout, { flag: 'wx' });
  }
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const compiler = realpathSync(join(root, 'node_modules/typescript/bin/tsc'));
  const tools = { node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) },
    compiler: { path: compiler, sha256: hash(readFileSync(compiler)), version: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version },
    compilerPackage: inventory(join(root, 'node_modules/typescript')),
    nodeTypes: inventory(join(root, 'node_modules/@types/node')),
    undiciTypes: inventory(join(root, 'node_modules/undici-types')) };
  command([process.execPath, compiler, '-p', 'tsconfig.build.json'], source);
  const built = inventory(join(source, 'dist'));
  const packs = join(work, 'packs');
  mkdirSync(packs);
  const cache = join(work, 'npm-cache');
  command(['npm', 'pack', '--ignore-scripts', '--offline', '--cache', cache, '--pack-destination', packs, '--json'], source);
  const packNames = readdirSync(packs).filter(name => name.endsWith('.tgz'));
  if (packNames.length !== 1) throw new Error('expected exactly one owned package tarball');
  const tarball = join(packs, packNames[0]);
  const staged = join(work, 'staged-consumer');
  const packagePath = join(staged, 'node_modules/virtual-bash');
  mkdirSync(packagePath, { recursive: true });
  command(['tar', '-xzf', tarball, '--strip-components=1', '-C', packagePath]);
  writeFileSync(join(staged, 'consumer.mjs'), readFileSync(join(own, 'consumer.mjs')), { flag: 'wx' });
  const fixture = prepareFixture(readFileSync(join(own, 'cases.mjs'), 'utf8'));
  writeFileSync(join(staged, 'cases.mjs'), fixture.prepared, { flag: 'wx' });
  writeFileSync(join(report, 'prepared-cases.mjs.data'), fixture.prepared, { flag: 'wx' });
  writeFileSync(join(staged, 'package.json'), '{"type":"module","private":true}\n', { flag: 'wx' });
  const moved = join(work, 'moved-consumer');
  renameSync(staged, moved);
  const quarantine = join(work, 'quarantined-source');
  renameSync(source, quarantine);
  const packedInventory = inventory(join(moved, 'node_modules/virtual-bash'));
  const expectedBuilt = built.map(entry => ({ ...entry, path: `dist/${entry.path}` }));
  for (const expected of expectedBuilt) {
    const actual = packedInventory.find(entry => entry.path === expected.path);
    if (actual?.sha256 !== expected.sha256) throw new Error(`pack/build mismatch ${expected.path}`);
  }
  const packageBytes = readFileSync(tarball);
  writeFileSync(join(report, 'virtual-bash-baseline.tgz'), packageBytes, { flag: 'wx' });
  write('preparation.json', { baseline, freezeCommit, frozen, fixture: fixture.evidence, tools,
    sourceBefore: provenance.files.filter(entry => entry.kind === 'build-input'),
    sourceAfter: inventory(join(quarantine, 'src')),
    built, packedInventory, tarball: { path: tarball, bytes: packageBytes.length, sha256: hash(packageBytes) },
    move: { from: staged, to: moved, originalBuildRoot: source, quarantine },
    workerStaticAssets: packedInventory.filter(entry => entry.path.startsWith('dist/commands/regex-execution/')),
    packageName: JSON.parse(readFileSync(join(moved, 'node_modules/virtual-bash/package.json'))).name });
  const { caseNames } = await import('./cases.mjs');
  const results = [];
  for (const name of caseNames) {
    const argv = [process.execPath, '--unhandled-rejections=strict', join(moved, 'consumer.mjs'), name];
    const started = Date.now();
    const result = spawnSync(argv[0], argv.slice(1), { cwd: moved, encoding: 'utf8',
      timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(report, `${name}.stdout.data`), result.stdout ?? '', { flag: 'wx' });
    writeFileSync(join(report, `${name}.stderr.data`), result.stderr ?? '', { flag: 'wx' });
    let outcome;
    try { outcome = JSON.parse(result.stdout); } catch {}
    const run = { name, argv, cwd: moved, elapsedMs: Date.now() - started, pid: result.pid,
      status: result.status, signal: result.signal, error: result.error?.message,
      naturalExit: result.status !== null && !result.signal && !result.error,
      pass: result.status === 0 && outcome?.pass === true,
      failures: outcome?.checks.filter(check => !check.pass).map(check => check.identity) ?? ['no-json-outcome'],
      outcome };
    write(`${name}.json`, run);
    results.push({ name, pass: run.pass, status: run.status, signal: run.signal, naturalExit: run.naturalExit, failures: run.failures });
    console.log(`${run.pass ? 'PASS' : 'FAIL'} ${name}: ${run.failures.join(', ')}`);
  }
  const packedAfter = inventory(join(moved, 'node_modules/virtual-bash'));
  const sourceAfter = inventory(join(quarantine, 'src'));
  const sourceEqual = provenance.files.filter(entry => entry.kind === 'build-input' && entry.path.startsWith('src/')).every(entry =>
    sourceAfter.find(actual => `src/${actual.path}` === entry.path)?.sha256 === entry.sha256);
  write('summary.json', { baseline, freezeCommit, total: results.length, passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).length, results,
    packageUnchanged: JSON.stringify(packedAfter) === JSON.stringify(packedInventory), sourceUnchanged: sourceEqual,
    frozenUnchanged: frozen.every(entry => hash(readFileSync(join(own, entry.path))) === entry.sha256),
    allChildrenNaturalExit: results.every(result => result.naturalExit), finished: new Date().toISOString(),
    candidateRouted: false });
} catch (error) {
  write('preparation-error.json', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  write('commands.json', commands);
}
