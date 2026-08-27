import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owner = 'tests/plugins/aliases-column-public-author';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidate = process.argv[2], output = resolve(process.argv[3]);
assert.match(candidate ?? '', /^[a-f0-9]{40}$/); assert.ok(process.argv[3]);
mkdirSync(output);
const work = mkdtempSync('/tmp/aliases-column-public-author-');
const source = join(work, 'source'); mkdirSync(source);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { candidate, classification: 'isolated-public-integration-author-not-independent-or-whole-gate', startedAt: new Date().toISOString(), work, commands: [], controls: [], status: 'in-progress' };
const environment = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(work, 'home'), TMPDIR: work, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
mkdirSync(environment.HOME);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function run(name, executable, args, cwd = source, expected = 0) {
  const child = spawnSync(executable, args, { cwd, env: environment, timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const receipt = { name, executable, args, cwd, status: child.status, signal: child.signal, error: child.error?.message ?? null, stdout: child.stdout?.toString() ?? '', stderr: child.stderr?.toString() ?? '' };
  report.commands.push(receipt); save(`${name}.json`, receipt);
  assert.equal(child.error, undefined, name); assert.equal(child.signal, null, name); assert.equal(child.status, expected, receipt.stderr + receipt.stdout);
  return receipt;
}
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), local = prefix ? prefix + '/' + name : name, stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, path);
    if (stat.isDirectory()) return inventory(path, local);
    assert.equal(stat.isFile(), true); const bytes = readFileSync(path);
    return [{ path: local, bytes: bytes.length, sha256: hash(bytes) }];
  });
}
function counts(receipt, expected) {
  const fields = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => {
    const matched = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(receipt.stdout); assert.ok(matched, name); return [name, Number(matched[1])];
  }));
  assert.equal(fields.fail + fields.cancelled + fields.skipped + fields.todo, 0); assert.equal(fields.tests, fields.pass); assert.ok(fields.tests > 0);
  if (expected !== undefined) assert.equal(fields.tests, expected);
  return fields;
}
try {
  const git = args => execFileSync('git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  report.runtime = { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
  const adjacent = ['tests/plugins/stream-five-fixture-migration/public-options.mts', 'tests/integration/stream-inspection-public-author/consumer.mts'];
  const paths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', owner, 'tests/plugins/agent-commands.test.ts', 'tests/plugins/stream-five-fixture-migration/registry.test.ts', 'tests/plugins/stream-five-fixture-migration/baseline60.json', 'tests/integration/stream-inspection-public-author/public.test.ts', ...adjacent];
  const archive = join(work, 'source.tar');
  git(['archive', '--format=tar', `--output=${archive}`, candidate, ...paths]);
  run('extract-source', '/usr/bin/tar', ['-xf', archive, '-C', source]);
  report.archiveSha256 = hash(readFileSync(archive)); report.sourceBefore = inventory(source);
  for (const entry of report.sourceBefore) assert.equal(hash(git(['show', `${candidate}:${entry.path}`])), entry.sha256, entry.path);
  report.gitInputs = report.sourceBefore.length;
  for (const family of ['grep-aliases', 'column', 'regex-execution', 'tree']) git(['diff', '--exit-code', '0123c83d3aae72a15621acbb29a165b97b2c6ab6', candidate, '--', `src/commands/${family}`]);
  const metadata = JSON.parse(readFileSync(join(source, 'package.json'))), lock = JSON.parse(readFileSync(join(source, 'package-lock.json')));
  assert.deepEqual(metadata.dependencies ?? {}, {}); assert.deepEqual(lock.packages[''].dependencies ?? {}, {});
  assert.deepEqual(metadata.devDependencies, lock.packages[''].devDependencies);
  report.manifestSha256 = hash(readFileSync(join(source, 'package.json')));
  symlinkSync(join(repository, 'node_modules'), join(source, 'node_modules'), 'dir');
  const compiler = join(repository, 'node_modules/typescript/bin/tsc');
  report.tools = [compiler, join(repository, 'node_modules/typescript/lib/_tsc.js'), join(repository, 'node_modules/typescript/package.json'), join(repository, 'node_modules/tsx/package.json'), join(repository, 'node_modules/@types/node/package.json')].map(path => ({ path, sha256: hash(readFileSync(path)) }));
  run('build', process.execPath, [compiler, '-p', 'tsconfig.build.json']);
  run('production-types', process.execPath, [compiler, '-p', 'tsconfig.build.json', '--noEmit']);
  const scoped = run('registry-tests', process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/plugins/agent-commands.test.ts', 'tests/plugins/stream-five-fixture-migration/registry.test.ts', 'tests/integration/stream-inspection-public-author/public.test.ts']);
  report.registry = counts(scoped);
  const packages = join(work, 'packages'); mkdirSync(packages);
  const npm = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  const packed = run('npm-pack', process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', packages]);
  const pack = JSON.parse(packed.stdout)[0];
  assert.ok(pack.files.every(file => ['package.json', 'README.md'].includes(file.path) || file.path.startsWith('dist/')));
  const tarball = join(packages, pack.filename); report.package = { filename: pack.filename, sha256: hash(readFileSync(tarball)), integrity: pack.integrity, files: pack.files };
  copyFileSync(tarball, join(output, pack.filename));
  const staged = join(work, 'staged'); mkdirSync(staged);
  const stagedPackage = join(staged, 'node_modules/virtual-bash'); mkdirSync(stagedPackage, { recursive: true });
  run('unpack', '/usr/bin/tar', ['-xf', tarball, '--strip-components=1', '-C', stagedPackage]);
  writeFileSync(join(staged, 'package.json'), JSON.stringify({ name: 'aliases-column-public-consumer', private: true, type: 'module' }));
  mkdirSync(join(work, 'relocated'));
  const consumer = join(work, 'relocated/consumer'); renameSync(staged, consumer);
  const installed = join(consumer, 'node_modules/virtual-bash'); report.packageBefore = inventory(installed);
  for (const entry of inventory(join(source, 'dist'))) assert.equal(hash(readFileSync(join(installed, 'dist', entry.path))), entry.sha256);
  for (const name of ['consumer', 'negative']) copyFileSync(join(source, owner, `${name}.ts.fixture`), join(consumer, `${name}.mts`));
  for (const [index, path] of adjacent.entries()) copyFileSync(join(source, path), join(consumer, `adjacent-${index}.mts`));
  mkdirSync(join(consumer, 'node_modules/@types'), { recursive: true });
  symlinkSync(join(repository, 'node_modules/@types/node'), join(consumer, 'node_modules/@types/node'), 'dir');
  symlinkSync(join(repository, 'node_modules/undici-types'), join(consumer, 'node_modules/undici-types'), 'dir');
  const config = { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, types: ['node'], outDir: 'run' }, files: ['consumer.mts'] };
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(config));
  const typed = run('positive-types', process.execPath, [compiler, '-p', 'tsconfig.json', '--traceResolution', '--noEmitOnError'], consumer);
  const publicResolutions = [];
  for (const match of typed.stdout.matchAll(/^======== Module name '(virtual-bash[^']*)' was successfully resolved to '([^']+)'/gm)) {
    const actual = realpathSync(match[2]), expectedExport = match[1] === 'virtual-bash' ? '.' : './' + match[1].slice('virtual-bash/'.length);
    assert.equal(actual, realpathSync(join(installed, metadata.exports[expectedExport].types)));
    publicResolutions.push({ specifier: match[1], path: actual, sha256: hash(readFileSync(actual)) });
  }
  assert.deepEqual([...new Set(publicResolutions.map(row => row.specifier))].sort(), ['virtual-bash', 'virtual-bash/commands/column', 'virtual-bash/commands/grep-aliases']);
  report.typeBindings = publicResolutions;
  writeFileSync(join(consumer, 'negative.json'), JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, noEmit: true }, files: ['negative.mts'] }));
  const negative = run('negative-types', process.execPath, [compiler, '-p', 'negative.json'], consumer, 2);
  const diagnosticCodes = [...negative.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]).sort();
  assert.deepEqual(diagnosticCodes, ['TS2322', 'TS2322', 'TS2322', 'TS2353', 'TS2353', 'TS2353']);
  report.negativeTypes = diagnosticCodes;
  writeFileSync(join(consumer, 'adjacent.json'), JSON.stringify({ ...config, files: adjacent.map((path, index) => `adjacent-${index}.mts`) }));
  run('adjacent-types', process.execPath, [compiler, '-p', 'adjacent.json', '--noEmitOnError'], consumer);
  unlinkSync(join(consumer, 'node_modules/@types/node')); unlinkSync(join(consumer, 'node_modules/undici-types'));
  const resolution = run('public-imports', process.execPath, ['--input-type=module', '-e', 'for(const name of ["virtual-bash","virtual-bash/commands/grep-aliases","virtual-bash/commands/column"]){await import(name);console.log(JSON.stringify({name,url:import.meta.resolve(name)}));}'], consumer);
  report.publicImports = resolution.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(report.publicImports.length, 3);
  for (const row of report.publicImports) assert.ok(fileURLToPath(row.url).startsWith(realpathSync(installed) + '/dist/'));
  report.publicTests = [];
  for (const repetition of [1, 2]) report.publicTests.push(counts(run(`public-runtime-${repetition}`, process.execPath, ['--unhandled-rejections=strict', '--test', '--test-reporter=tap', '--test-concurrency=1', 'run/consumer.mjs'], consumer), 17));
  report.adjacentConsumers = [];
  for (const [index, path] of adjacent.entries()) {
    const checked = run(`adjacent-runtime-${index}`, process.execPath, [`run/adjacent-${index}.mjs`], consumer);
    report.adjacentConsumers.push({ path, status: checked.status });
  }
  for (const family of ['grep-aliases', 'column']) {
    const module = join(installed, 'dist/commands', family, 'index.js'), withheld = module + '.withheld'; renameSync(module, withheld);
    try {
      for (const specifier of ['virtual-bash', `virtual-bash/commands/${family}`]) {
        const name = `missing-${family}-${specifier === 'virtual-bash' ? 'root' : 'subpath'}`;
        const denied = run(name, process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], consumer, 1);
        assert.match(denied.stderr, /ERR_MODULE_NOT_FOUND/); assert.ok(denied.stderr.includes(`/dist/commands/${family}/index.js`));
        report.controls.push({ name, status: 'expected-module-missing' });
      }
    } finally { renameSync(withheld, module); }
  }
  const privatePath = run('private-source-export-denied', process.execPath, ['--input-type=module', '-e', 'await import("virtual-bash/src/index.ts")'], consumer, 1);
  assert.match(privatePath.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  report.controls.push({ name: 'private-source-export-denied', status: 'expected-package-path-denial' });
  const denied = run('source-filesystem-denied', process.execPath, ['--experimental-permission', `--allow-fs-read=${consumer}`, '--input-type=module', '-e', `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(join(source, 'src/index.ts'))});`], consumer, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/); assert.ok(denied.stderr.includes(join(source, 'src/index.ts')));
  report.controls.push({ name: 'source-filesystem-denied', status: 'expected-permission-denial' });
  report.packageAfter = inventory(installed); assert.deepEqual(report.packageAfter, report.packageBefore);
  unlinkSync(join(source, 'node_modules'));
  const sourceAfter = inventory(source).filter(entry => !entry.path.startsWith('dist/'));
  assert.deepEqual(sourceAfter, report.sourceBefore); report.sourceUnchanged = true;
  for (const tool of report.tools) assert.equal(hash(readFileSync(tool.path)), tool.sha256);
  report.status = 'scoped-author-integration-pass-awaits-independent-review';
} catch (error) {
  report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  rmSync(work, { recursive: true, force: true }); report.ownedTemporaryRemoved = !existsSync(work);
  save('REPORT.json', report);
  console.log(JSON.stringify({ candidate, status: report.status, package: report.package?.sha256, registry: report.registry, publicTests: report.publicTests, controls: report.controls, error: report.error, output }));
}
