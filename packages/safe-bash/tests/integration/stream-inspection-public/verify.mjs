import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = '/Users/kjopek/Workspace/safe-bash';
const owned = dirname(fileURLToPath(import.meta.url));
const commit = process.argv[2];
const output = resolve(process.argv[3] ?? '');
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
assert.ok(output.startsWith('/tmp/safe-bash-stream-public-independent.') || output.startsWith('/private/tmp/safe-bash-stream-public-independent.'));
assert.equal(existsSync(output), false, 'Every attempt needs a fresh output directory');
mkdirSync(output, { recursive: true });
const report = { started: new Date().toISOString(), commit, output, steps: [], failures: [], baseline: '488cc2398a55326dd6efee809b71d7b9bf4edf4b' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory(root, allowToolLinks = false) {
  const entries = [];
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink() && allowToolLinks) {
        const target = realpathSync(filename);
        assert.ok(target.startsWith(realpathSync(root) + sep), `External tooling symlink: ${filename}`);
        assert.ok(lstatSync(target).isFile(), `Non-file tooling symlink: ${filename}`);
        entries.push({ path: relative(root, filename), link: readlinkSync(filename), target: relative(realpathSync(root), target), sha256: digest(readFileSync(target)) });
        continue;
      }
      assert.equal(stat.isSymbolicLink(), false, `Symlink forbidden: ${filename}`);
      if (stat.isDirectory()) walk(filename);
      else entries.push({ path: relative(root, filename), size: stat.size, sha256: digest(readFileSync(filename)) });
    }
  }
  walk(root);
  return { sha256: digest(JSON.stringify(entries)), entries };
}
function save(name, value) { writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n'); }
const home = join(output, 'home');
mkdirSync(home);
const cache = join(output, 'empty-npm-cache');
const node = realpathSync(process.execPath);
const npm = realpathSync(join(dirname(process.execPath), 'npm'));
const environment = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home, TMPDIR: output, LANG: 'C', LC_ALL: 'C', npm_config_cache: cache, npm_config_userconfig: join(home, 'user.npmrc'), npm_config_globalconfig: join(home, 'global.npmrc'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
writeFileSync(environment.npm_config_userconfig, '');
writeFileSync(environment.npm_config_globalconfig, '');
const profile = join(output, 'network-denied.sb');
writeFileSync(profile, '(version 1) (allow default) (deny network*)\n');
function run(label, executable, args, cwd = output, expected = 0, env = environment, sandbox = true) {
  const ordinal = String(report.steps.length + 1).padStart(2, '0');
  const command = sandbox ? '/usr/bin/sandbox-exec' : executable;
  const parameters = sandbox ? ['-f', profile, executable, ...args] : args;
  const result = spawnSync(command, parameters, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(output, `${ordinal}.stdout.log`), result.stdout ?? '');
  writeFileSync(join(output, `${ordinal}.stderr.log`), result.stderr ?? '');
  report.steps.push({ label, executable, args, cwd, status: result.status, signal: result.signal, expected, error: result.error?.message, stdout: `${ordinal}.stdout.log`, stderr: `${ordinal}.stderr.log` });
  save('report.json', report);
  assert.equal(result.status, expected, `${label}: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
let originals;
let snapshot;
let consumer;
let tooling;
let before;
try {
  const gate = readFileSync('/tmp/safe-bash-stream-public-review.ready', 'utf8');
  assert.ok(gate.includes(commit), 'Gate must name exact commit');
  assert.match(gate, /closed/iu, 'Gate must confirm author CLOSED');
  report.gate = { contents: gate, sha256: digest(gate) };
  assert.equal(run('resolve immutable source commit', '/usr/bin/git', ['rev-parse', `${commit}^{commit}`], repository, 0, environment, false), commit);
  report.sourceTree = run('immutable source tree', '/usr/bin/git', ['rev-parse', `${commit}:src`], repository, 0, environment, false);
  report.initialGitStatus = run('read-only initial shared status', '/usr/bin/git', ['status', '--porcelain=v1'], repository, 0, environment, false);
  const freeze = JSON.parse(readFileSync(join(owned, 'freeze.json')));
  for (const entry of freeze.files) assert.equal(digest(readFileSync(join(owned, entry.path))), entry.sha256, `Frozen harness changed: ${entry.path}`);
  report.freeze = freeze;
  const files = run('list immutable snapshot inputs', '/usr/bin/git', ['ls-tree', '-r', '--name-only', commit], repository, 0, environment, false).split('\n').filter(name => name.startsWith('src/') || /^(package(?:-lock)?\.json|tsconfig(?:\.build)?\.json|README(?:\..*)?|LICENSE(?:\..*)?|\.npmignore|\.npmrc)$/u.test(name));
  assert.ok(files.includes('package.json') && files.includes('src/index.ts'));
  snapshot = join(output, 'snapshot'); consumer = join(output, 'consumer'); tooling = join(output, 'tooling');
  for (const directory of [snapshot, consumer, tooling]) mkdirSync(directory);
  const archive = join(output, 'source.tar');
  run('archive exact tracked source and packaging inputs', '/usr/bin/git', ['archive', '--format=tar', `--output=${archive}`, commit, ...files], repository, 0, environment, false);
  run('extract immutable source snapshot', '/usr/bin/tar', ['-xf', archive, '-C', snapshot]);
  originals = inventory(snapshot);
  save('source-manifest.json', originals);
  report.sourceArchiveSha256 = digest(readFileSync(archive));
  report.sourceManifestSha256 = originals.sha256;
  report.tools = {};
  for (const [name, filename] of [['node', node], ['npm', npm], ['sandbox-exec', '/usr/bin/sandbox-exec'], ['tar', '/usr/bin/tar'], ['git', '/usr/bin/git']]) report.tools[name] = { realpath: realpathSync(filename), sha256: digest(readFileSync(filename)) };
  report.tools.node.version = run('actual Node version', node, ['--version']);
  report.tools.npm.version = run('actual npm version', node, [npm, '--version']);
  report.tools.npm.tree = inventory(resolve(dirname(npm), '..'), true).sha256;
  report.devDependencies = {};
  for (const name of ['typescript', '@types/node', 'undici-types']) {
    const source = realpathSync(join(repository, 'node_modules', name));
    const destination = join(tooling, 'node_modules', name);
    cpSync(source, destination, { recursive: true, dereference: true });
    report.devDependencies[name] = { sourceRealpath: source, version: JSON.parse(readFileSync(join(source, 'package.json'))).version, original: inventory(source).sha256, copied: inventory(destination).sha256 };
    assert.equal(report.devDependencies[name].original, report.devDependencies[name].copied);
  }
  for (const name of ['@types/node', 'undici-types']) cpSync(join(tooling, 'node_modules', name), join(snapshot, 'node_modules', name), { recursive: true });
  const compiler = join(tooling, 'node_modules/typescript/bin/tsc');
  report.tools.typescript = { realpath: realpathSync(compiler), sha256: digest(readFileSync(compiler)), version: run('actual TypeScript version', node, [compiler, '--version']) };
  before = inventory(tooling);
  run('OS denies loopback network', node, ['-e', 'const net=require("node:net"); const server=net.createServer(); server.on("error",error=>{console.log(error.code);process.exit(error.code==="EPERM"?0:2)});server.listen(0,"127.0.0.1",()=>{server.close();process.exit(3)});']);
  const missing = run('empty-cache offline negative control', node, [npm, 'view', 'stream-public-offline-never-installed-8675309', 'version', '--offline', '--ignore-scripts'], output, 1);
  void missing;
  assert.match(readFileSync(join(output, report.steps.at(-1).stderr), 'utf8'), /ENOTCACHED/u);
  const manifest = JSON.parse(readFileSync(join(snapshot, 'package.json')));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.deepEqual(manifest[key] ?? {}, {}, key);
  for (const name of ['prepack', 'prepare', 'postpack', 'preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[name], undefined, `Lifecycle hook disallowed after measured npm prepare bypass: ${name}`);
  report.lifecycleSafety = { manifestHooksAbsent: ['prepack', 'prepare', 'postpack', 'preinstall', 'install', 'postinstall'], ignoreScriptsAloneTrusted: false };
  assert.equal(manifest.scripts.build, 'tsc -p tsconfig.build.json');
  run('isolated exact build command via copied compiler', node, [compiler, '-p', 'tsconfig.build.json'], snapshot);
  const packed = JSON.parse(run('offline pack no lifecycle scripts', node, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output], snapshot));
  assert.equal(packed.length, 1);
  const artifact = packed[0];
  const tarball = join(output, artifact.filename);
  report.package = { sha256: digest(readFileSync(tarball)), name: artifact.name, integrity: artifact.integrity, files: artifact.files, exports: manifest.exports, runtimeDependencies: manifest.dependencies ?? {} };
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/commands/stream-inspection/index.js', 'dist/commands/stream-inspection/index.d.ts', 'dist/commands/stream-inspection/shared.d.ts']) assert.ok(artifact.files.some(entry => entry.path === required), required);
  assert.ok(artifact.files.every(entry => !/^(src|tests|node_modules)\//u.test(entry.path)));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'frozen-stream-public-consumer', private: true, type: 'module' }));
  run('offline install exact tarball no lifecycle scripts', node, [npm, 'install', '--offline', '--ignore-scripts', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', tarball], consumer);
  const installed = join(consumer, 'node_modules/virtual-bash');
  assert.deepEqual(JSON.parse(readFileSync(join(installed, 'package.json'))), manifest);
  assert.deepEqual(readdirSync(join(consumer, 'node_modules')).filter(name => !name.startsWith('.')), ['virtual-bash']);
  const namespace = inventory(installed);
  save('packed-namespace.json', namespace);
  report.package.namespaceSha256 = namespace.sha256;
  assert.deepEqual(namespace.entries.map(entry => entry.path).sort(), artifact.files.map(entry => entry.path).sort());
  for (const entry of namespace.entries) assert.equal(entry.sha256, digest(readFileSync(join(snapshot, entry.path))));
  for (const name of ['cases.json', 'boundary.mjs', 'runtime.mjs']) cpSync(join(owned, name), join(consumer, name));
  const runtimeBefore = inventory(consumer);
  save('consumer-before.json', runtimeBefore);
  writeFileSync(profile, `(version 1) (allow default) (deny network*) (deny file-read* (subpath "${repository}"))\n`);
  try {
    run('plain Node packed runtime no source loader network denied', node, ['--import', './boundary.mjs', './runtime.mjs'], consumer, 0, { ...environment, PUBLIC_DENIED_SOURCE: new URL(`file://${snapshot}/src/index.ts`).href });
  } catch (error) { report.failures.push({ stage: 'runtime', message: error.message }); }
  writeFileSync(profile, '(version 1) (allow default) (deny network*)\n');
  if (existsSync(join(consumer, 'runtime-results.json'))) {
    report.runtime = JSON.parse(readFileSync(join(consumer, 'runtime-results.json')));
    cpSync(join(consumer, 'runtime-results.json'), join(output, 'runtime-results.json'));
  }
  if (existsSync(join(consumer, 'imports.ndjson'))) cpSync(join(consumer, 'imports.ndjson'), join(output, 'imports.ndjson'));
  assert.equal(inventory(installed).sha256, namespace.sha256);
  for (const entry of runtimeBefore.entries) assert.equal(digest(readFileSync(join(consumer, entry.path))), entry.sha256);
  for (const name of ['@types/node', 'undici-types']) cpSync(join(tooling, 'node_modules', name), join(consumer, 'node_modules', name), { recursive: true });
  for (const name of ['consumer', 'invalid']) cpSync(join(owned, `${name}.ts.fixture`), join(consumer, `${name}.ts`));
  const compilerOptions = { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, noEmit: true, types: ['node'] };
  for (const name of ['consumer', 'invalid']) writeFileSync(join(consumer, `tsconfig.${name}.json`), JSON.stringify({ compilerOptions, files: [`${name}.ts`] }));
  const typedBefore = inventory(consumer);
  try {
    const listed = run('strict NodeNext packed public declarations', node, [compiler, '-p', 'tsconfig.consumer.json', '--listFiles', '--pretty', 'false'], consumer).split('\n');
    const canonicalConsumer = realpathSync(consumer);
    const library = realpathSync(join(tooling, 'node_modules/typescript/lib'));
    for (const name of listed) {
      const filename = realpathSync(name);
      assert.ok(filename.startsWith(canonicalConsumer + sep) || (filename.startsWith(library + sep) && /^lib\..*\.d\.ts$/u.test(relative(library, filename))), `Type fallback: ${filename}`);
      if (filename.includes('/node_modules/virtual-bash/')) assert.ok(filename.includes('/dist/') && filename.endsWith('.d.ts'));
    }
    for (const name of ['dist/index.d.ts', 'dist/commands/stream-inspection/index.d.ts', 'dist/commands/stream-inspection/shared.d.ts']) assert.ok(listed.some(filename => realpathSync(filename) === realpathSync(join(installed, name))), name);
    report.typecheck = { compilerOptions, files: listed, status: 'pass' };
    const diagnostic = run('four wrong-type negative controls', node, [compiler, '-p', 'tsconfig.invalid.json', '--pretty', 'false'], consumer, 2);
    const codes = [...diagnostic.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1]));
    assert.deepEqual(codes, [2322, 2322, 2322, 2322]);
    report.typecheck.negativeCodes = codes;
  } catch (error) { report.failures.push({ stage: 'typecheck', message: error.message }); }
  assert.equal(inventory(consumer).sha256, typedBefore.sha256);
  assert.equal(inventory(tooling).sha256, before.sha256);
  for (const entry of originals.entries) assert.equal(digest(readFileSync(join(snapshot, entry.path))), entry.sha256, `Snapshot modified: ${entry.path}`);
  for (const entry of freeze.files) assert.equal(digest(readFileSync(join(owned, entry.path))), entry.sha256, `Consumer freeze changed: ${entry.path}`);
  for (const [name, entry] of Object.entries(report.devDependencies)) assert.equal(inventory(entry.sourceRealpath).sha256, entry.original, `Original tool dependency changed: ${name}`);
  assert.equal(inventory(resolve(dirname(npm), '..'), true).sha256, report.tools.npm.tree);
  report.unchanged = { originalSource: true, originalToolDependencies: true, copiedTooling: true, packedNamespace: true, consumerBeforeAfterRuntime: true, consumerBeforeAfterTypecheck: true, frozenHarness: true };
  save('consumer-after.json', inventory(consumer));
  report.status = report.failures.length ? 'fail' : 'pass';
} catch (error) {
  report.status = 'fail'; report.failures.push({ stage: 'harness-or-packaging', name: error.name, message: error.message, stack: error.stack });
} finally {
  report.finished = new Date().toISOString();
  report.cleanup = 'Evidence, isolated source/build/tools/consumer/tarball intentionally retained in uniquely owned tmp directory; no background server/worker created, no unowned artifacts removed.';
  save('report.json', report);
  console.log(JSON.stringify({ status: report.status, commit, output, runtime: report.runtime && { pass: report.runtime.passed, fail: report.runtime.failed }, failures: report.failures.map(failure => ({ stage: failure.stage, message: failure.message.slice(0, 1200) })) }, null, 2));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
