import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authenticateCandidate, authorize, control, directory, frozenCases, inherited, inventory, json, repo, save, sha256 } from './common.mjs';
import { child } from './series.mjs';

export async function admit(binding, route, execute) {
  const authorized = authorize(binding, route);
  return execute(binding, authorized);
}

export async function actual(binding, route) {
  route = authorize(binding, route);
  authenticateCandidate(binding);
  const oldLayers = inherited();
  const data = await frozenCases();
  const { assertSource, compose, copyRegular, materializeSource, tools } = await import('./workspace.mjs');
  assert(!existsSync(route.outputDirectory), 'fresh authorized output directory required');
  const files = compose(binding);
  mkdirSync(route.outputDirectory);
  const at = name => resolve(route.outputDirectory, name);
  const toolset = tools(route, at('tools'));
  const source = at('source');
  const initialSource = materializeSource(files, source);
  save(at('source-inputs.json'), initialSource);
  save(at('binding.json'), binding);
  save(at('route.json'), route);
  for (const name of ['records', 'home', 'tmp', 'cache']) mkdirSync(at(name));
  writeFileSync(at('empty.npmrc'), '');
  const environment = { PATH: dirname(toolset.paths.nodeEntry), HOME: at('home'), TMPDIR: at('tmp'), LANG: 'C.UTF-8', TZ: 'UTC', npm_config_cache: at('cache'), npm_config_userconfig: at('empty.npmrc'), npm_config_globalconfig: at('empty.npmrc'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', NODE_OPTIONS: '' };
  const captures = [];
  let sequence = 0;
  const command = async (label, args, cwd, extraEnv = {}, allowedStatuses = [0]) => {
    const result = await child(toolset.paths.nodeEntry, args, { cwd, env: { ...environment, ...extraEnv } });
    save(at(`records/${String(++sequence).padStart(3, '0')}-${label}.json`), { classification: 'future-candidate-child', args, cwd, ...result });
    captures.push({ label, ...result });
    assert(result.naturalSettlement && result.cleanupClean, `${label}: no continuation after forced/unclean settlement`);
    assert(allowedStatuses.includes(result.status), `${label}: exit ${result.status}`);
    return result;
  };
  const addTypes = target => {
    copyRegular(toolset.paths.nodeTypes, resolve(target, 'node_modules/@types/node'));
    copyRegular(toolset.paths.undiciTypes, resolve(target, 'node_modules/undici-types'));
  };
  const createConsumer = target => {
    mkdirSync(target);
    writeFileSync(resolve(target, 'package.json'), JSON.stringify({ name: 'cd-independent-review-consumer', private: true, type: 'module' }));
    for (const name of ['entry.mjs', 'types.mjs', 'mapping.mjs', 'fixtures.mjs', 'series.mjs']) copyRegular(resolve(directory, name), resolve(target, name));
    copyRegular(resolve(repo, control, 'cases-v1.mjs'), resolve(target, 'cases-v1.mjs'));
    for (const kind of ['positive', 'negative']) copyRegular(resolve(repo, control, `types-${kind}-v1.mts.fixture`), resolve(target, `types-${kind}-v1.mts`));
  };
  const allowedFiles = (...roots) => Object.fromEntries(roots.flatMap(root => Object.entries(inventory(root)).filter(([, entry]) => entry.kind === 'file').map(([path, entry]) => [resolve(root, path), entry.sha256])));
  const runChild = async (mode, consumer, packageRoot, label, overrides = {}, allowed) => {
    const resultPath = at(`records/${mode}-${label}-result.json`);
    const config = { authorization: route.authorization, binding, route, mode, consumer, packageRoot, compiler: toolset.paths.typescriptEntry, allowed: allowed ?? allowedFiles(consumer, packageRoot, at('tools')), resultPath, ...overrides };
    const configPath = at(`records/${mode}-${label}-config.json`);
    save(configPath, config);
    await command(`${mode}-${label}`, [resolve(consumer, label === 'types' ? 'types.mjs' : 'entry.mjs'), configPath], consumer, { CD_REVIEW_CONFIG_SHA256: sha256(readFileSync(configPath)) }, label === 'cases' ? [0, 1] : [0]);
    assert(existsSync(resultPath), 'natural child did not publish result');
    assert(readFileSync(resultPath).length <= 8388608, 'harness result bound, not cd budget');
    return json(resultPath);
  };
  const modes = [];
  const mode = async (name, consumer, packageRoot) => {
    const before = inventory(consumer);
    const packageBefore = inventory(packageRoot);
    const admittedFiles = allowedFiles(consumer, packageRoot, at('tools'));
    const result = await runChild(name, consumer, packageRoot, 'cases', {}, admittedFiles);
    assert.equal(result.mode, name);
    assert.deepEqual(result.results.map(row => row.id), [...data.cases, ...data.diagnosticCases].map(row => row.id), 'all unchanged86 rows or explicit stopped result');
    assert(!result.stopped && result.results.every(row => row.cleanup === 'clean'), 'cleanup/adaptation stop: no further work');
    const typesResult = await runChild(name, consumer, packageRoot, 'types', {}, admittedFiles);
    const publicEntry = resolve(packageRoot, name === 'source' ? 'src/index.ts' : 'dist/index.js');
    const targets = [
      { kind: 'outside', path: at('source-not-admitted/fallback.ts'), expected: 'LOAD_OUTSIDE' },
      { kind: 'missing', path: publicEntry, expected: 'LOAD_MISSING' },
      { kind: 'runtime', path: resolve(packageRoot, name === 'source' ? 'src/shell/runtime.ts' : 'dist/shell/runtime.js'), expected: 'LOAD_HASH' },
      { kind: 'provider', path: resolve(packageRoot, name === 'source' ? 'src/fs/webdav/webdav.ts' : 'dist/fs/webdav/webdav.js'), expected: 'LOAD_HASH' },
    ];
    const negatives = [];
    for (const negative of targets) {
      const original = negative.kind === 'outside' ? undefined : readFileSync(negative.path);
      const stash = at(`records/${name}-${negative.kind}-held-bytes`);
      try {
        if (negative.kind === 'missing') renameSync(negative.path, stash);
        else if (original) writeFileSync(negative.path, Buffer.concat([original, Buffer.from('\nLOAD_ADMISSION_NEGATIVE_ONLY\n')]));
        negatives.push(await runChild(name, consumer, packageRoot, `negative-${negative.kind}`, { negative }, admittedFiles));
      } finally {
        if (negative.kind === 'missing' && existsSync(stash)) renameSync(stash, negative.path);
        else if (original) writeFileSync(negative.path, original);
      }
    }
    assert.deepEqual(inventory(consumer), before, 'consumer bytes/membership after mode including negative restoration');
    assert.deepEqual(inventory(packageRoot), packageBefore, 'package bytes/membership after mode');
    assert.deepEqual(inventory(at('tools')), toolset.inventory, 'tools unchanged');
    save(at(`records/${name}-identity.json`), { consumer: before, package: packageBefore, afterConsumer: inventory(consumer), afterPackage: inventory(packageRoot), loaded: result.loaded });
    modes.push({ mode: name, executed: result.results.length, failures: result.results.filter(row => row.status === 'assertion-failure').map(row => row.id), designPending: result.results.filter(row => row.pendingDesign?.length).map(row => row.id), types: typesResult, negatives: negatives.length });
  };
  addTypes(source);
  await command('build', [resolve(dirname(toolset.paths.typescriptEntry), 'tsc.js'), '-p', 'tsconfig.build.json'], source);
  assertSource(files, source);
  const builtSource = inventory(source);
  createConsumer(at('source-consumer'));
  addTypes(at('source-consumer'));
  await mode('source', at('source-consumer'), source);
  await command('pack', [toolset.paths.npmEntry, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', route.outputDirectory], source);
  const packages = readdirSync(route.outputDirectory).filter(name => name.endsWith('.tgz'));
  assert.equal(packages.length, 1);
  const tarball = at(packages[0]);
  const tarballHash = sha256(readFileSync(tarball));
  createConsumer(at('installed-consumer'));
  await command('install', [toolset.paths.npmEntry, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], at('installed-consumer'));
  addTypes(at('installed-consumer'));
  const installedPackage = resolve(at('installed-consumer'), 'node_modules/virtual-bash');
  const installedInventory = inventory(installedPackage);
  for (const [path, entry] of Object.entries(installedInventory)) {
    if (entry.kind !== 'file' || path.startsWith('dist/')) continue;
    assert(files[path], `packed entry outside exact source/build membership: ${path}`);
    assert.equal(entry.sha256, files[path].sha256, `packed source/doc identity: ${path}`);
  }
  assert.deepEqual(inventory(resolve(installedPackage, 'dist')), inventory(resolve(source, 'dist')), 'complete emitted dist equals installed dist');
  assert.deepEqual(readFileSync(resolve(installedPackage, 'package.json')), readFileSync(resolve(source, 'package.json')));
  assert.equal(Object.keys(json(resolve(installedPackage, 'package.json')).dependencies ?? {}).length, 0);
  assert.deepEqual(inventory(source), builtSource, 'build source unchanged by pack/source execution');
  renameSync(source, at('source-retained-not-loadable'));
  assert(!existsSync(source));
  await mode('installed', at('installed-consumer'), installedPackage);
  const beforeMove = inventory(at('installed-consumer'));
  renameSync(at('installed-consumer'), at('physically-moved-consumer'));
  assert(!existsSync(at('installed-consumer')));
  assert.deepEqual(inventory(at('physically-moved-consumer')), beforeMove);
  await mode('moved', at('physically-moved-consumer'), resolve(at('physically-moved-consumer'), 'node_modules/virtual-bash'));
  assert.deepEqual(inventory(at('source-retained-not-loadable')), builtSource);
  assert.equal(sha256(readFileSync(tarball)), tarballHash);
  assert.deepEqual(inventory(resolve(at('physically-moved-consumer'), 'node_modules/virtual-bash')), installedInventory);
  assert.deepEqual(inherited(), oldLayers);
  for (const entry of Object.values(toolset.sourceManifest.roots)) assert.deepEqual(inventory(entry.source), entry.inventory);
  save(at('SUMMARY.json'), { classification: 'future-public-evidence-not-full-acceptance', binding, modes, tarballHash, invariants: 'candidate source review still required', F07: 'ROOT regression route required; not executed by this executor', sourceBefore: initialSource, sourceBuilt: builtSource, tools: toolset.inventory, captures: captures.map(({ stdout, stderr, ...entry }) => entry) });
  save(at('MANIFEST.json'), { exclusion: 'MANIFEST.json only; Git seal required', entries: inventory(route.outputDirectory) });
  return modes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const binding = process.argv[2] ? json(resolve(process.argv[2])) : undefined;
  const route = process.argv[3] ? json(resolve(process.argv[3])) : undefined;
  try {
    const modes = await admit(binding, route, actual);
    process.exitCode = modes.some(mode => mode.failures.length) ? 1 : 2;
  }
  catch (error) { console.error(JSON.stringify({ classification: 'admission-or-executor-failure-not-product-pass', code: error.code, message: error.message })); process.exitCode = 1; }
}
