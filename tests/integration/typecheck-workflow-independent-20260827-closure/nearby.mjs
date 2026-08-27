import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = 'a01310c5571dfda2aae4c6c8cc185e2530a01e89';
const output = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'new evidence directory required');
assert.equal(existsSync(output), false);
mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-type-workflow-independent-')));
const snapshot = join(temporary, 'candidate');
mkdirSync(snapshot);
const environment = { ...process.env, TSX_DISABLE_CACHE: '1' };
for (const name of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[name];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { candidate, harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), node: process.version, nodeExecutableSha256: sha256(readFileSync(process.execPath)), platform: process.platform, arch: process.arch, checks: [], commands: [], captures: [], findings: [], runtimeAcceptance: false };
const capture = (name, bytes) => {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const path = `${name}.gz.base64`;
  writeFileSync(join(output, path), gzipSync(data).toString('base64') + '\n');
  const entry = { path, bytes: data.length, sha256: sha256(data) };
  report.captures.push(entry);
  return entry;
};
const command = (label, executable, args, cwd = snapshot) => {
  const result = spawnSync(executable, args, { cwd, env: environment, encoding: 'utf8', timeout: 360000, maxBuffer: 96 * 1024 * 1024 });
  const entry = { label, executable, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: capture(`${label}.stdout`, result.stdout ?? ''), stderr: capture(`${label}.stderr`, result.stderr ?? '') };
  report.commands.push(entry);
  assert.equal(result.error, undefined, label);
  assert.equal(result.signal, null, label);
  return { ...result, entry };
};
const check = (name, action) => {
  try { const details = action(); report.checks.push({ name, status: 'pass', details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'fail', error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
};
const mutate = (path, bytes, action) => {
  const filename = join(snapshot, path);
  const original = existsSync(filename) ? readFileSync(filename) : undefined;
  try {
    if (bytes === null) rmSync(filename);
    else { mkdirSync(dirname(filename), { recursive: true }); writeFileSync(filename, bytes); }
    return action();
  } finally {
    if (original === undefined) rmSync(filename, { force: true });
    else writeFileSync(filename, original);
  }
};
const copyRegular = (source, destination, allowed = realpathSync(source)) => {
  const actual = realpathSync(source);
  assert.ok(actual === allowed || actual.startsWith(`${allowed}/`));
  const metadata = lstatSync(actual);
  if (metadata.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(actual).sort()) copyRegular(join(actual, name), join(destination, name), allowed);
  } else {
    assert.ok(metadata.isFile());
    writeFileSync(destination, readFileSync(actual), { flag: 'wx', mode: metadata.mode & 0o777 });
    assert.ok(lstatSync(destination).isFile());
  }
};
const census = (root, paths) => paths.map(path => {
  const filename = join(root, path), metadata = lstatSync(filename);
  const bytes = metadata.isSymbolicLink() ? Buffer.from(readlinkSync(filename)) : readFileSync(filename);
  return { path, kind: metadata.isSymbolicLink() ? 'symlink-text' : 'regular', bytes: bytes.length, sha256: sha256(bytes) };
});
const walk = (root, prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => {
  const path = join(prefix, name);
  return lstatSync(join(root, path)).isDirectory() ? walk(root, path) : [path];
});
const probe = (label, args = [], npm = false) => {
  const location = join(temporary, label);
  const result = npm
    ? command(label, 'npm', ['run', ...args, '--', '--report', location])
    : command(label, process.execPath, ['scripts/typecheck.mjs', ...args, '--report', location]);
  const details = JSON.parse(readFileSync(join(location, 'report.json')));
  capture(`${label}.report`, JSON.stringify(details, null, 2) + '\n');
  return { ...result, details };
};
const rejectPreflight = (label, pattern) => {
  const result = probe(label);
  assert.equal(result.status, 2);
  assert.equal(result.details.phases.length, 0);
  assert.match(result.details.error, pattern);
};
const compile = (label, args) => command(label, process.execPath, ['node_modules/typescript/bin/tsc', ...args]);
const directGroup = (label, groupName, source = false) => {
  const workspace = join(temporary, label);
  mkdirSync(workspace);
  const script = `
    import assert from 'node:assert/strict';
    import { spawnSync } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { consumerGroups, currentSourceConsumerGroups, negativeGroups } from './tests/plugins/qualified-current-release/consumers.mjs';
    import { checkCurrentConsumerTypes, checkSourceConsumerTypes } from './scripts/typecheck-consumers.mjs';
    const source = ${source};
    const groups = source ? currentSourceConsumerGroups : consumerGroups;
    const selected = groups.find(group => group.name === ${JSON.stringify(groupName)});
    assert.ok(selected); groups.splice(0, groups.length, selected); negativeGroups.splice(0);
    const phases = [];
    const compile = (label, args) => {
      const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
      phases.push({ label, status: result.status, stdout: result.stdout, stderr: result.stderr }); return result;
    };
    const result = (source ? checkSourceConsumerTypes : checkCurrentConsumerTypes)(process.cwd(), ${JSON.stringify(workspace)}, compile);
    writeFileSync(${JSON.stringify(join(workspace, 'result.json'))}, JSON.stringify({ result, phases }, null, 2));
    process.exitCode = result.passed ? 0 : 2;
  `;
  const result = command(label, process.execPath, ['--input-type=module', '-e', script]);
  const details = JSON.parse(readFileSync(join(workspace, 'result.json')));
  capture(`${label}.report`, JSON.stringify(details, null, 2) + '\n');
  return { ...result, details, workspace };
};

try {
  assert.equal(command('resolve-candidate', 'git', ['--no-replace-objects', 'rev-parse', candidate], repository).stdout.trim(), candidate);
  report.tree = command('resolve-tree', 'git', ['--no-replace-objects', 'rev-parse', `${candidate}^{tree}`], repository).stdout.trim();
  const archive = join(temporary, 'source.tar'), descriptor = openSync(archive, 'wx');
  try {
    const archived = spawnSync('git', ['--no-replace-objects', 'archive', '--format=tar', candidate], { cwd: repository, env: environment, stdio: ['ignore', descriptor, 'pipe'], timeout: 120000 });
    assert.equal(archived.status, 0); assert.equal(archived.signal, null);
  } finally { closeSync(descriptor); }
  report.archiveSha256 = sha256(readFileSync(archive));
  assert.equal(command('extract', 'tar', ['-xf', archive, '-C', snapshot]).status, 0);
  assert.equal(existsSync(join(snapshot, 'dist')), false);
  assert.equal(existsSync(join(snapshot, 'node_modules')), false);
  assert.equal(command('isolated-git-init', 'git', ['init', '-q']).status, 0);
  writeFileSync(join(snapshot, '.git/objects/info/alternates'), realpathSync(join(repository, '.git/objects')) + '\n');
  assert.equal(command('isolated-index', 'git', ['read-tree', candidate]).status, 0);
  const tracked = command('tracked-inputs', 'git', ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const original = census(snapshot, tracked);
  report.sourceBefore = capture('source-before', JSON.stringify(original, null, 2) + '\n');
  copyRegular(join(repository, 'node_modules'), join(snapshot, 'node_modules'));
  const originalTools = census(snapshot, walk(join(snapshot, 'node_modules')).map(path => join('node_modules', path)));
  report.tools = capture('tools', JSON.stringify(originalTools, null, 2) + '\n');
  report.typescript = JSON.parse(readFileSync(join(snapshot, 'node_modules/typescript/package.json'))).version;
  report.nodeTypes = JSON.parse(readFileSync(join(snapshot, 'node_modules/@types/node/package.json'))).version;
  const classification = JSON.parse(readFileSync(join(snapshot, 'tests/plugins/qualified-current-release/captured-types.json')));

  check('fresh-complete-qualified-typing', () => {
    const result = probe('combined', ['typecheck:all'], true);
    assert.equal(result.status, 0); assert.equal(result.details.builds, 1);
    assert.equal(result.details.sourceConsumers.groups.length, 3); assert.equal(result.details.sourceConsumers.passed, true);
    assert.equal(result.details.consumers.groups.length, 19); assert.equal(result.details.consumers.passed, true);
    assert.deepEqual(result.details.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]);
    assert.equal(result.details.candidateBinding.declarations.length, 177);
    assert.equal(result.details.runtimeExecutions, 0);
    report.baseline = result.details.candidateBinding;
  });
  assert.ok(report.baseline, 'fresh baseline required before controls');
  const emitted = census(join(snapshot, 'dist'), walk(join(snapshot, 'dist')));
  report.emitted = capture('emitted', JSON.stringify(emitted, null, 2) + '\n');
  check('changed-source-fallback-message-still-denies-real-src-resolution', () => {
    const config = JSON.parse(readFileSync(join(snapshot, 'tsconfig.json'))); config.compilerOptions.paths = { 'virtual-bash': [join(snapshot, 'src/index.ts')] };
    mutate('tsconfig.json', JSON.stringify(config), () => {
      const result = directGroup('source-fallback', 'env-split-public-source', true);
      assert.equal(result.status, 2); assert.equal(result.details.phases[0].status, 0);
      assert.match(result.details.result.groups[0].error, /foreign candidate declaration\/source fallback: virtual-bash/u);
    });
  });
  check('same-candidate-authentication-neighbors', () => {
    const path = fileURLToPath(new URL('./binding-cases.mjs', import.meta.url));
    report.neighborDriverSha256 = sha256(readFileSync(path));
    const destination = join(temporary, 'nearby-report.json');
    const result = command('nearby-bindings', process.execPath, [path, join(temporary, 'nearby'), destination]);
    const details = JSON.parse(readFileSync(destination));
    capture('nearby-bindings.report', JSON.stringify(details, null, 2) + '\n');
    report.neighbors = details.cases.map(({ name, status, guardError, error, compiler }) => ({ name, status, guardError, error, compiler }));
    assert.equal(result.status, 0); assert.equal(details.cases.length, 11); assert.ok(details.cases.every(current => current.status === 'pass'));
  });
  check('missing-new-import-without-alias-remains-TS2305', () => {
    const path = 'tests/shell-stress/env-split-validity/public-types.mts';
    mutate(path, Buffer.concat([readFileSync(join(snapshot, path)), Buffer.from('\nimport { independentMissingExport } from "virtual-bash/contracts"; void independentMissingExport;\n')]), () => {
      const result = directGroup('missing-export', 'env-split-public-types'); assert.equal(result.status, 2); assert.match(result.details.phases[0].stdout, /TS2305/u);
    });
  });
  check('unchanged-mixed-package-mutation-full-warm-command-now-exits2', () => {
    const decoy = join(temporary, 'decoy-dist'); copyRegular(join(snapshot, 'dist'), decoy);
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ type: 'module', private: true }));
    const declaration = join(decoy, 'contracts/index.d.ts');
    writeFileSync(declaration, Buffer.concat([readFileSync(declaration), Buffer.from('\nexport declare const independentMissingExport: number;\n')]));
    const configPath = 'tests/plugins/qualified-current-release/tsconfig.consumer.json';
    const config = JSON.parse(readFileSync(join(snapshot, configPath)));
    config.compilerOptions.paths = { 'virtual-bash/contracts': [declaration] };
    const path = 'tests/shell-stress/env-split-validity/public-types.mts';
    mutate(configPath, JSON.stringify(config), () => mutate(path, Buffer.concat([readFileSync(join(snapshot, path)), Buffer.from('\nimport { independentMissingExport } from "virtual-bash/contracts"; void independentMissingExport;\n')]), () => {
      const full = probe('mixed-full-warm', ['typecheck'], true);
      assert.equal(full.status, 2); assert.equal(full.details.builds, 0); assert.equal(full.details.phases.length, 26);
      assert.equal(full.details.sourceConsumers.passed, true);
      const rejected = full.details.consumers.groups.filter(group => group.status === 'fail');
      assert.equal(rejected.length, 1); assert.equal(rejected[0].name, 'env-split-public-types');
      assert.match(rejected[0].error, /foreign candidate declaration\/source fallback: virtual-bash\/contracts/u);
      assert.equal(full.details.phases.find(phase => phase.label === 'consumer-env-split-public-types').status, 0);
      assert.equal(full.details.consumers.negativeTypes.find(group => group.name === 'env-split-invalid-binding').status, 'fail');
      report.mixedWarm = { status: full.status, builds: full.details.builds, rejected, phases: full.details.phases.map(phase => ({ label: phase.label, status: phase.status })) };
      const sourcePath = 'scripts/typecheck-consumers.mjs';
      const source = readFileSync(join(snapshot, sourcePath), 'utf8');
      const original = '  assertCandidateResolutions(stdout, join(consumer, "node_modules/virtual-bash"), binding);';
      assert.equal(source.split(original).length, 2);
      mutate(sourcePath, source.replace(original, '  assert.ok(stdout.includes(`${consumer}/`) && stdout.includes("node_modules/virtual-bash/dist/"));'), () => {
        const mutant = directGroup('mixed-binding-mutant', 'env-split-public-types');
        assert.equal(mutant.status, 0, 'old substring guard must escape the same negative assertion');
        report.guardMutant = { observedForbiddenAcceptance: true, killedByOriginalStatus2Assertion: true };
      });
    }));
  });
  check('unchanged-source-tools-build-after-neighbors', () => {
    const after = census(snapshot, tracked); report.sourceAfter = capture('source-after', JSON.stringify(after, null, 2) + '\n');
    assert.deepEqual(after, original); assert.deepEqual(census(snapshot, originalTools.map(entry => entry.path)), originalTools);
    assert.deepEqual(census(join(snapshot, 'dist'), walk(join(snapshot, 'dist'))), emitted);
  });
} catch (error) { report.setupFailure = error.stack; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary);
  report.finishedAt = new Date().toISOString();
  report.counts = { pass: report.checks.filter(check => check.status === 'pass').length, fail: report.checks.filter(check => check.status === 'fail').length, skip: 0 };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ candidate, counts: report.counts, setupFailure: report.setupFailure, cleaned: report.cleaned, output }));
  process.exitCode = report.setupFailure || report.counts.fail ? 1 : 0;
}
