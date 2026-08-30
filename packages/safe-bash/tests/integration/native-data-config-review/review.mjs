import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, globSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const candidate = '78e80717b9791a4bc5f49005b962b1da9232335d';
const parent = 'f6406cdc1d946bbe829535d888d6e8a09a7c8d9e';
const native = 'tests/commands/regex-execution/continuation/artifacts/native';
const producer = 'tests/commands/regex-execution/continuation/dialect.mjs';
const producerEvidence = 'tests/commands/regex-execution/continuation/dialect-evidence.json';
const rawHash = '74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8';
const rawSix = ['dialect-bFUsLx/alpha.ts', 'dialect-bFUsLx/beta.ts', 'dialect-uhGVu3/ab.ts', 'dialect-uhGVu3/🙂.ts', 'dialect-xj7h8F/a.ts', 'dialect-xj7h8F/d.ts'];
const fixture = JSON.parse(readFileSync(join(owned, 'fixtures.json'), 'utf8'));
const evidence = { started: new Date().toISOString(), candidate, parent, node: process.version, platform: process.platform, arch: process.arch, typescript: ts.version, controls: [] };
const scratch = join(owned, '.scratch/attempt-03');
const isolatedOnly = process.argv.includes('--isolated-only');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(owned, name), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const check = (name, callback) => {
  callback();
  evidence.controls.push({ name, status: 'PASS' });
  save('results.json', evidence);
};
const walk = base => readdirSync(base, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => relative(base, join(entry.parentPath, entry.name))).sort();
const manifest = (base, paths) => paths.map(path => {
  const bytes = readFileSync(join(base, path));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
const put = (base, path, text) => {
  const target = join(base, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
};
const run = (label, executable, args, cwd, extraEnv = {}) => {
  const started = new Date().toISOString();
  const env = { ...process.env, TSX_DISABLE_CACHE: '1', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  const record = { label, executable, args, cwd: relative(root, cwd) || '.', started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
  save(`${label}.json`, record);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return record;
};
const parseConfig = (base, config = 'tsconfig.json') => {
  const loaded = ts.readConfigFile(join(base, config), ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, base, { noEmit: true, incremental: false }, join(base, config));
  assert.equal(parsed.options.composite, undefined);
  return parsed;
};
const diagnostics = (base, config = 'tsconfig.json') => {
  const parsed = parseConfig(base, config);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const entries = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(item => {
    const location = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : undefined;
    return { path: item.file ? relative(base, item.file.fileName) : null, code: item.code, line: location ? location.line + 1 : null, column: location ? location.character + 1 : null, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') };
  });
  const files = program.getSourceFiles().map(file => relative(base, file.fileName)).sort();
  const production = files.filter(path => path.startsWith('src/'));
  const testTree = files.filter(path => path.startsWith('tests/'));
  return { entries, files, roots: parsed.fileNames.map(path => relative(base, path)).sort(), counts: { total: files.length, production: production.length, testTree: testTree.length, other: files.length - production.length - testTree.length } };
};
const liveSnapshot = () => {
  const source = manifest(root, git('ls-files', '-z', '--', 'src').split('\0').filter(Boolean));
  const configs = manifest(root, ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
  const nativeFiles = manifest(join(root, native), walk(join(root, native)));
  const producerFiles = manifest(root, [producer, producerEvidence, 'tests/commands/regex-execution/continuation/.gitignore']);
  const authorFiles = manifest(root, git('ls-files', '-z', '--', 'tests/plugins/qualified-current-release-native-data').split('\0').filter(Boolean));
  const rootDist = existsSync(join(root, 'dist')) ? manifest(join(root, 'dist'), walk(join(root, 'dist'))) : [];
  return { head: git('rev-parse', 'HEAD').trim(), sourceTree: git('rev-parse', 'HEAD:src').trim(), status: git('status', '--porcelain=v1'), index: hash(readFileSync(join(root, git('rev-parse', '--git-path', 'index').trim()))), source, sourceManifestSha256: hash(JSON.stringify(source)), configs, nativeFiles, producerFiles, authorFiles, rootDist };
};

try {
  assert.equal(root, '/Users/kjopek/Workspace/safe-bash');
  assert.equal(git('rev-parse', `${candidate}^{tree}`).trim(), '50e1de0655fb89515ef6ff82fe4060d4d1d2f7f4');
  assert.ok(!existsSync(scratch), 'Each replay needs a new owned scratch directory; do not overwrite retained evidence');
  mkdirSync(scratch, { recursive: true });
  evidence.inputFreeze = manifest(owned, ['CRITERIA.md', 'fixtures.json', 'review.mjs']);
  save('input-freeze.json', evidence.inputFreeze);
  const before = liveSnapshot();
  save('live-before.json', before);
  const oldConfig = JSON.parse(git('show', `${parent}:tsconfig.json`));
  const newConfig = JSON.parse(git('show', `${candidate}:tsconfig.json`));
  const oldPackage = JSON.parse(git('show', `${parent}:package.json`));
  const newPackage = JSON.parse(git('show', `${candidate}:package.json`));
  writeFileSync(join(owned, 'candidate.diff'), git('diff', parent, candidate, '--', 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'README.md', 'docs/PROJECT_LEDGER.md'));
  evidence.changedPaths = git('diff', '--name-only', parent, candidate).trim().split('\n');
  check('exact-config-and-package-only-behavioral-delta', () => {
    assert.deepEqual(newConfig, { ...oldConfig, exclude: [...oldConfig.exclude, native] });
    assert.deepEqual(newPackage, { ...oldPackage, scripts: { ...oldPackage.scripts, test: newPackage.scripts.test } });
    assert.notEqual(oldPackage.scripts.test, newPackage.scripts.test);
    assert.equal(git('show', `${parent}:tsconfig.build.json`), git('show', `${candidate}:tsconfig.build.json`));
    assert.ok(evidence.changedPaths.every(path => ['tsconfig.json', 'package.json', 'README.md', 'docs/PROJECT_LEDGER.md'].includes(path) || path.startsWith('tests/plugins/qualified-current-release-native-data/')));
    assert.equal(newPackage.scripts.pretest, undefined);
    assert.equal(newPackage.scripts.posttest, undefined);
    assert.equal(newPackage.scripts.pretypecheck, undefined);
    assert.equal(newPackage.scripts.posttypecheck, undefined);
  });

  const producerText = readFileSync(join(root, producer), 'utf8');
  assert.equal(producerText, git('show', `${candidate}:${producer}`));
  const generatedCases = [...producerText.matchAll(/name: "([^"]+)"[^\n]*files: (\[[^\n]+\])/g)].map(match => ({ name: match[1], files: JSON.parse(match[2]).sort() }));
  const producerRecorded = JSON.parse(readFileSync(join(root, producerEvidence), 'utf8'));
  assert.deepEqual(generatedCases, producerRecorded.cases.map(item => ({ name: item.name, files: [...item.files].sort() })));
  const groups = new Map();
  const classified = before.nativeFiles.map(item => {
    const full = join(root, native, item.path);
    assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink());
    if (item.path.startsWith('dialect-')) {
      const [group, ...tail] = item.path.split('/');
      const members = groups.get(group) ?? [];
      members.push(tail.join('/'));
      groups.set(group, members);
      assert.equal(item.sha256, rawHash);
      assert.equal(item.bytes, 4);
      return { ...item, role: 'producer-native-glob-payload', group };
    }
    const cache = JSON.parse(readFileSync(full, 'utf8'));
    assert.ok(item.path.startsWith('tsx-'));
    assert.equal(typeof cache.code, 'string');
    assert.ok(Array.isArray(cache.warnings));
    assert.equal(cache.map.version, 3);
    assert.ok(cache.map.sources.length > 0);
    assert.equal(cache.map.sources.length, cache.map.sourcesContent.length);
    const sources = cache.map.sources.map(source => {
      assert.ok(isAbsolute(source));
      assert.ok(!source.startsWith(join(root, native) + '/'));
      return { path: relative(root, source), exists: existsSync(source), currentSha256: existsSync(source) ? hash(readFileSync(source)) : null };
    });
    return { ...item, role: 'generated-tsx-transform-cache', sources, cachedSourceHashes: cache.map.sourcesContent.map(source => source === null ? null : hash(source)) };
  });
  const groupMatches = [...groups].map(([group, files]) => {
    const matching = generatedCases.filter(item => JSON.stringify(item.files) === JSON.stringify(files.sort()));
    assert.equal(matching.length, 1);
    return { group, files: files.sort(), producerCase: matching[0].name };
  });
  save('classification.json', { producerFiles: before.producerFiles, producerRecordedProfile: producerRecorded.profile, generatedCases, groupMatches, files: classified });
  check('all-72-files-classified-with-producer-provenance', () => {
    assert.equal(classified.length, 72);
    assert.equal(classified.filter(item => item.role === 'producer-native-glob-payload').length, 22);
    assert.equal(classified.filter(item => item.role === 'generated-tsx-transform-cache').length, 50);
    assert.equal(groups.size, 10);
    assert.equal(new Set(groupMatches.map(item => item.producerCase)).size, 10);
    for (const path of rawSix) assert.equal(classified.find(item => item.path === path)?.sha256, rawHash);
    assert.equal(git('ls-tree', '-r', '--name-only', candidate, '--', native), '');
    evidence.rawIgnoreRules = git('check-ignore', ...rawSix.map(path => `${native}/${path}`));
  });

  let liveInputs;
  let liveConfig;
  let liveCensus;
  if (!isolatedOnly) {
  liveConfig = parseConfig(root);
  assert.equal(liveConfig.options.incremental, false);
  liveInputs = manifest(root, liveConfig.fileNames.map(path => relative(root, path)).sort());
  save('live-inputs-before.json', liveInputs);
  const liveRun = run('live-global-noemit', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false', '--pretty', 'false'], root);
  evidence.liveGlobalStatus = liveRun.status === 0 ? 'PASS' : 'FAILED';
  liveCensus = diagnostics(root);
  const discovered = globSync('tests/**/*.test.ts', { cwd: root, exclude: path => path === native }).sort();
  const tracked = git('ls-files', '-z', '--', 'tests').split('\0').filter(path => path.endsWith('.test.ts')).sort();
  const liveIncluded = new Set(liveCensus.files);
  evidence.liveCensus = { ...liveCensus.counts, discovered: discovered.length, discoveredIncluded: discovered.filter(path => liveIncluded.has(path)).length, tracked: tracked.length, trackedIncluded: tracked.filter(path => liveIncluded.has(path)).length };
  save('live-census.json', { ...liveCensus, discovered, tracked, counts: evidence.liveCensus });
  check('live-canonical-discovery-and-input-stability', () => {
    assert.ok(discovered.every(path => liveIncluded.has(path)));
    assert.ok(tracked.every(path => liveIncluded.has(path)));
    assert.deepEqual(manifest(root, liveConfig.fileNames.map(path => relative(root, path)).sort()), liveInputs);
    assert.ok(!liveCensus.entries.some(item => item.path?.startsWith(native + '/')));
  });
  } else {
    evidence.liveGlobalStatus = 'FAILED';
    evidence.liveGlobalEvidence = ['attempt-01/live-global-noemit.json', 'attempt-02/live-global-noemit.json'];
    evidence.liveStatusQualification = 'Not rerun: prior live captures retained separately; second raced foreign input correction.';
  }

  const isolated = join(scratch, 'candidate');
  mkdirSync(isolated);
  const archive = join(scratch, 'candidate.tar');
  git('archive', '--format=tar', `--output=${archive}`, candidate, 'src', 'tests', 'benchmarks', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json');
  assert.equal(run('extract-candidate', 'tar', ['-xf', archive, '-C', isolated], root).status, 0);
  symlinkSync(join(root, 'node_modules'), join(isolated, 'node_modules'), 'dir');
  for (const item of before.nativeFiles) {
    const target = join(isolated, native, item.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, native, item.path), target);
    chmodSync(target, 0o444);
  }
  assert.deepEqual(manifest(join(isolated, native), walk(join(isolated, native))), before.nativeFiles);
  const candidateSourceBefore = manifest(isolated, walk(join(isolated, 'src')).map(path => `src/${path}`));
  save('candidate-source.json', candidateSourceBefore);
  const candidateFixed = diagnostics(isolated);
  save('candidate-fixed.json', candidateFixed);
  const candidateInputs = manifest(isolated, candidateFixed.files);
  save('candidate-compiler-inputs.json', candidateInputs);
  const tsc = join(root, 'node_modules/typescript/bin/tsc');
  const fixedCli = run('candidate-fixed-cli', process.execPath, [tsc, '--noEmit', '--incremental', 'false', '--pretty', 'false'], isolated);
  put(isolated, 'tsconfig.json', git('show', `${parent}:tsconfig.json`));
  const candidateOld = diagnostics(isolated);
  save('candidate-parent-config.json', candidateOld);
  const parentCli = run('candidate-parent-cli', process.execPath, [tsc, '--noEmit', '--incremental', 'false', '--pretty', 'false'], isolated);
  put(isolated, 'tsconfig.json', git('show', `${candidate}:tsconfig.json`));
  const exactHit = path => ({ path: `${native}/${path}`, code: 2304, line: 1, column: 1, message: "Cannot find name 'hit'." });
  check('authenticated-six-exact-errors-removed-only-by-exclusion', () => {
    assert.deepEqual(candidateOld.entries.filter(item => item.path?.startsWith(native + '/')), rawSix.map(exactHit));
    assert.deepEqual(candidateFixed.entries.filter(item => item.path?.startsWith(native + '/')), []);
    assert.deepEqual(candidateOld.entries.filter(item => !item.path?.startsWith(native + '/')), candidateFixed.entries);
    assert.deepEqual(candidateOld.files.filter(path => !path.startsWith(native + '/')), candidateFixed.files);
    assert.deepEqual(candidateOld.files.filter(path => path.startsWith(native + '/')), rawSix.map(path => `${native}/${path}`));
    assert.equal(fixedCli.status, 0);
    assert.equal(parentCli.status, 2);
    assert.equal(candidateFixed.entries.length, 0);
  });
  const candidateTracked = git('ls-tree', '-r', '--name-only', candidate, '--', 'tests').split('\n').filter(path => path.endsWith('.test.ts')).sort();
  const candidateDiscovered = globSync('tests/**/*.test.ts', { cwd: isolated, exclude: path => path === native }).sort();
  evidence.candidateCensus = { ...candidateFixed.counts, tracked: candidateTracked.length, trackedIncluded: candidateTracked.filter(path => candidateFixed.files.includes(path)).length, discovered: candidateDiscovered.length, discoveredIncluded: candidateDiscovered.filter(path => candidateFixed.files.includes(path)).length };
  save('candidate-canonical.json', { counts: evidence.candidateCensus, tracked: candidateTracked, discovered: candidateDiscovered });
  check('all-candidate-previously-eligible-code-tests-helpers-retained', () => {
    assert.ok(candidateTracked.every(path => candidateFixed.files.includes(path)));
    assert.ok(candidateDiscovered.every(path => candidateFixed.files.includes(path)));
    for (const path of ['src/index.ts', 'tests/commands/regex-execution/continuation/glob.test.ts', 'tests/plugins/qualified-current-release-native-data/helpers.ts']) assert.ok(candidateFixed.files.includes(path));
  });
  const build = run('candidate-source-build-noemit', process.execPath, [tsc, '-p', 'tsconfig.build.json', '--noEmit', '--incremental', 'false', '--pretty', 'false'], isolated);
  check('actual-candidate-source-build-config-noemit', () => assert.equal(build.status, 0));
  for (const path of fixture.compilerOutside) put(isolated, path, `${fixture.compilerSymbol};\n`);
  const negatives = diagnostics(isolated);
  save('candidate-outside-negative.json', negatives);
  const negativeCli = run('candidate-outside-negative-cli', process.execPath, [tsc, '--noEmit', '--incremental', 'false', '--pretty', 'false'], isolated);
  check('six-genuine-outside-symbol-errors-remain-exact', () => {
    assert.equal(negativeCli.status, 2);
    for (const path of fixture.compilerOutside) assert.deepEqual(negatives.entries.filter(item => item.path === path), [{ path, code: 2304, line: 1, column: 1, message: `Cannot find name '${fixture.compilerSymbol}'.` }]);
    assert.deepEqual(negatives.entries.filter(item => !fixture.compilerOutside.includes(item.path)), candidateFixed.entries);
  });
  const importTarget = `${native}/${rawSix[0]}`;
  let importSpecifier = relative(dirname(join(isolated, fixture.explicitImport)), join(isolated, importTarget)).replace(/\.ts$/, '.js');
  if (!importSpecifier.startsWith('.')) importSpecifier = './' + importSpecifier;
  put(isolated, fixture.explicitImport, `import ${JSON.stringify(importSpecifier)};\n`);
  const imported = diagnostics(isolated);
  save('candidate-explicit-import.json', imported);
  check('explicit-import-is-not-silenced-by-discovery-exclude', () => assert.deepEqual(imported.entries.filter(item => item.path === importTarget), [exactHit(rawSix[0])]));

  const runner = join(scratch, 'runner');
  mkdirSync(runner);
  symlinkSync(join(root, 'node_modules'), join(runner, 'node_modules'), 'dir');
  put(runner, 'package.json', git('show', `${candidate}:package.json`));
  put(runner, fixture.runnerHelper, `export const helper = 'HELPER_IMPORTED_AND_EXECUTED';\n`);
  for (const path of fixture.runnerPositive) {
    const helper = path === fixture.runnerPositive[0] ? `import { helper } from './helper.js';\n` : '';
    const body = path === fixture.runnerPositive[0] ? `assert.equal(helper, 'HELPER_IMPORTED_AND_EXECUTED');` : 'assert.ok(true);';
    put(runner, path, `import assert from 'node:assert/strict';\nimport test from 'node:test';\n${helper}test(${JSON.stringify('KEPT:' + path)}, () => { ${body} });\n`);
  }
  const marker = join(runner, 'native-executed.txt');
  for (const path of fixture.runnerExcluded) put(runner, path, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(path + '\n')});\nthrow new Error(${JSON.stringify(fixture.canaryMessage)});\n`);
  const runnerInputs = manifest(runner, ['package.json', ...fixture.runnerPositive, ...fixture.runnerExcluded, fixture.runnerHelper].sort());
  save('runner-input-freeze.json', runnerInputs);
  const positiveRun = run('runner-candidate', 'npm', ['test'], runner);
  check('actual-default-script-retains-six-boundaries-and-helper', () => {
    assert.equal(positiveRun.status, 0);
    assert.ok(!existsSync(marker));
    for (const path of fixture.runnerPositive) assert.ok(positiveRun.stdout.includes('KEPT:' + path));
    assert.match(positiveRun.stdout, /# pass 6\b/);
    assert.match(positiveRun.stdout, /# fail 0\b/);
  });
  put(runner, 'package.json', git('show', `${parent}:package.json`));
  const parentRun = run('runner-parent-mutation', 'npm', ['test'], runner);
  check('original-actual-script-executes-both-forbidden-canaries', () => {
    assert.equal(parentRun.status, 1);
    assert.ok(parentRun.stdout.includes(fixture.canaryMessage));
    assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n').sort(), [...fixture.runnerExcluded].sort());
    assert.match(parentRun.stdout, /# pass 6\b/);
    assert.match(parentRun.stdout, /# fail 2\b/);
  });
  put(runner, 'package.json', git('show', `${candidate}:package.json`));
  assert.deepEqual(manifest(runner, runnerInputs.map(item => item.path)), runnerInputs);
  const emptyRunner = join(scratch, 'empty-runner');
  mkdirSync(emptyRunner);
  symlinkSync(join(root, 'node_modules'), join(emptyRunner, 'node_modules'), 'dir');
  put(emptyRunner, 'package.json', git('show', `${candidate}:package.json`));
  for (const path of fixture.runnerExcluded) put(emptyRunner, path, `throw new Error(${JSON.stringify(fixture.canaryMessage)});\n`);
  put(emptyRunner, 'fallback.test.js', `throw new Error('BARE_RUNNER_FALLBACK_EXECUTED');\n`);
  const emptyRun = run('runner-empty-selection', 'npm', ['test'], emptyRunner);
  check('empty-filtered-selection-fails-without-bare-runner-fallback', () => {
    assert.equal(emptyRun.status, 1);
    assert.match(emptyRun.stderr, /No test files found/);
    assert.ok(!emptyRun.stdout.includes(fixture.canaryMessage));
    assert.ok(!emptyRun.stdout.includes('BARE_RUNNER_FALLBACK_EXECUTED'));
    assert.ok(!emptyRun.stdout.includes('TAP version'));
  });
  const after = liveSnapshot();
  save('live-after.json', after);
  evidence.liveHeadStable = before.head === after.head;
  evidence.liveStatusStable = before.status === after.status;
  evidence.liveIndexStable = before.index === after.index;
  evidence.liveSourceStable = JSON.stringify(before.source) === JSON.stringify(after.source);
  evidence.liveSourceDrift = after.source.filter(item => JSON.stringify(item) !== JSON.stringify(before.source.find(previous => previous.path === item.path)));
  check('original-and-copied-data-and-protected-inputs-unchanged', () => {
    assert.deepEqual(after.nativeFiles, before.nativeFiles);
    assert.deepEqual(manifest(join(isolated, native), walk(join(isolated, native))), before.nativeFiles);
    assert.deepEqual(after.configs, before.configs);
    assert.deepEqual(after.producerFiles, before.producerFiles);
    assert.deepEqual(after.authorFiles, before.authorFiles);
    assert.deepEqual(after.rootDist, before.rootDist);
    assert.deepEqual(manifest(isolated, candidateSourceBefore.map(item => item.path)), candidateSourceBefore);
    assert.deepEqual(manifest(owned, evidence.inputFreeze.map(item => item.path)), evidence.inputFreeze);
    if (liveInputs) assert.deepEqual(manifest(root, liveInputs.map(item => item.path)), liveInputs);
    if (liveConfig) assert.deepEqual(parseConfig(root).fileNames, liveConfig.fileNames);
    assert.deepEqual(manifest(isolated, candidateInputs.map(item => item.path)), candidateInputs);
    assert.ok(!existsSync(join(isolated, 'dist')));
  });
  evidence.finished = new Date().toISOString();
  evidence.scopedStatus = 'PASS';
  evidence.candidateGlobalStatus = candidateFixed.entries.length ? 'FAILED' : 'PASS';
  evidence.candidateGlobalDiagnosticCount = candidateFixed.entries.length;
  evidence.liveGlobalDiagnosticCount = liveCensus?.entries.length ?? null;
  save('results.json', evidence);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.finished = new Date().toISOString();
  evidence.scopedStatus = 'FAILED';
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  save('results.json', evidence);
  console.error(error);
  process.exitCode = 1;
}
