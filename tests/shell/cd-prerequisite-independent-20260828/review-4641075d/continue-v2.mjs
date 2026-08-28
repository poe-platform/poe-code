import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { directory, controls, inventory, save, sha } from './bind.mjs';
import { compose, assertSource, copyRegular } from './workspace.mjs';
import { child } from './series.mjs';

const binding = JSON.parse(readFileSync(`${directory}/BINDING.json`));
const route = JSON.parse(readFileSync(`${directory}/ROOT-ROUTE-v2.json`));
assert.equal(route.authorization, 'ROOT_EXECUTION_AUTHORIZED'); assert.equal(route.bindingSha256, sha(JSON.stringify(binding)));
controls();
const attempt = `${directory}/attempt-02`;
const source = `${attempt}/source`;
const root = `${directory}/continuation-02`; mkdirSync(root);
const records = `${root}/records`; mkdirSync(records);
const files = compose(binding); assertSource(files, source);
const tools = `${attempt}/tools`;
const toolsBefore = inventory(tools);
const node = `${tools}/node/node`;
const compiler = `${tools}/typescript/lib/typescript.js`;
const npm = `${tools}/npm/bin/npm-cli.js`;
const sourceResult = JSON.parse(readFileSync(`${attempt}/records/source-cases-result.json`));
assert.equal(sourceResult.results.length, 86); assert(!sourceResult.stopped);
assert(sourceResult.results.every(row => row.cleanup === 'clean' && row.status.startsWith('public-pass')));
save('ATTEMPT-02-AUDIT-v2.json', { classification: 'original artifact-bound driver nonpass retained; public source checks86 passed before artifact limit', driver: JSON.parse(readFileSync(`${directory}/DRIVER-03.json`)), sourceRows: 86, sourceResultBytes: readFileSync(`${attempt}/records/source-cases-result.json`).length, sourceResultSha256: sha(readFileSync(`${attempt}/records/source-cases-result.json`)), artifactRepair: 'lossless per-case error interning, not relaxed output assertions or product budgets; source86 not rerun/rescored', inventory: inventory(attempt), controls: 'unchanged' });
const env = { PATH: dirname(node), HOME: `${attempt}/home`, TMPDIR: `${attempt}/tmp`, LANG: 'C.UTF-8', TZ: 'UTC', npm_config_cache: `${attempt}/cache`, npm_config_userconfig: `${attempt}/empty.npmrc`, npm_config_globalconfig: `${attempt}/empty.npmrc`, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', NODE_OPTIONS: '' };
let sequence = 0;
const record = (name, value) => writeFileSync(`${records}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const command = async (label, args, cwd, extra = {}, statuses = [0]) => {
  const result = await child(node, args, { cwd, env: { ...env, ...extra } }); record(`${++sequence}-${label}-child`, { args, cwd, ...result });
  assert(result.naturalSettlement && result.cleanupClean && !result.groupStillPresent, `${label}: unclean child STOP`); assert(statuses.includes(result.status), `${label}: status${result.status}`); return result;
};
const consumer = target => {
  mkdirSync(target); writeFileSync(`${target}/package.json`, JSON.stringify({ name: 'cd-independent-consumer', private: true, type: 'module' }));
  for (const [name, from] of Object.entries({ 'entry.mjs': 'entry-v2.mjs', 'fixtures.mjs': 'fixtures-v3.mjs', 'types.mjs': 'types.mjs', 'mapping.mjs': 'mapping.mjs', 'series.mjs': 'series.mjs', 'adapter-checks.mjs': 'adapter-checks-v2.mjs' })) copyRegular(`${directory}/${from}`, `${target}/${name}`);
  copyRegular(`${directory}/../cases-v1.mjs`, `${target}/cases-v1.mjs`);
  for (const kind of ['positive', 'negative']) copyRegular(`${directory}/../types-${kind}-v1.mts.fixture`, `${target}/types-${kind}-v1.mts`);
};
const types = target => { copyRegular(`${tools}/nodeTypes`, `${target}/node_modules/@types/node`); copyRegular(`${tools}/undiciTypes`, `${target}/node_modules/undici-types`); };
const allowed = (...roots) => Object.fromEntries(roots.flatMap(root => Object.entries(inventory(root)).filter(([, entry]) => entry.kind === 'file').map(([path, entry]) => [resolve(root, path), entry.sha256])));
const run = async (mode, client, packageRoot, label, override = {}, admission) => {
  const config = { authorization: route.authorization, binding, route: { ...route, authorizedWriteRoot: root }, mode, consumer: client, packageRoot, compiler, allowed: admission ?? allowed(client, packageRoot, tools), resultPath: `${records}/${mode}-${label}-result.json`, ...override };
  const path = `${records}/${mode}-${label}-config.json`; writeFileSync(path, JSON.stringify(config), { flag: 'wx' });
  await command(`${mode}-${label}`, [`${client}/${label === 'types' ? 'types.mjs' : 'entry.mjs'}`, path], client, { CD_REVIEW_CONFIG_SHA256: sha(readFileSync(path)) }, label === 'cases' ? [0, 1] : [0]);
  const bytes = readFileSync(config.resultPath); assert(bytes.length <= 8388608, 'compact fixture result bound'); return JSON.parse(bytes);
};
const modes = [];
const mode = async (name, client, packageRoot, existing) => {
  const before = inventory(client); const packageBefore = inventory(packageRoot); const admission = allowed(client, packageRoot, tools);
  record(`${name}-before`, { consumer: before, package: packageBefore, tools: toolsBefore });
  const result = existing ?? await run(name, client, packageRoot, 'cases', {}, admission);
  assert.equal(result.results.length, 86); assert(!result.stopped && result.results.every(row => row.cleanup === 'clean'));
  const typeResult = name === 'source' ? JSON.parse(readFileSync(`${directory}/continuation-01/records/source-types-result.json`)) : await run(name, client, packageRoot, 'types', {}, admission);
  assert.equal(typeResult.positive, 10); assert.equal(typeResult.negative, 10); assert.equal(typeResult.inversions.length, 10);
  const adapters = await run(name, client, packageRoot, 'adapters', { adapters: true, realRoot: `${root}/real-${name}` }, admission);
  const relative = name === 'source' ? ['src/index.ts', 'src/shell/runtime.ts', 'src/fs/webdav/webdav.ts'] : ['dist/index.js', 'dist/shell/runtime.js', 'dist/fs/webdav/webdav.js'];
  const negatives = [{ kind: 'outside', path: `${directory}/unadmitted-source-fallback.ts`, expected: 'LOAD_OUTSIDE' }, ...relative.map((path, index) => ({ kind: ['missing', 'runtime', 'provider'][index], path: `${packageRoot}/${path}`, expected: index === 0 ? 'LOAD_MISSING' : 'LOAD_HASH' }))];
  for (const negative of negatives) {
    const original = negative.kind === 'outside' ? undefined : readFileSync(negative.path); const stash = `${records}/${name}-missing-held`;
    try { if (negative.kind === 'missing') renameSync(negative.path, stash); else if (original) writeFileSync(negative.path, Buffer.concat([original, Buffer.from('\nADMISSION_NEGATIVE_ONLY\n')])); await run(name, client, packageRoot, `negative-${negative.kind}`, { negative }, admission); }
    finally { if (negative.kind === 'missing' && existsSync(stash)) renameSync(stash, negative.path); else if (original) writeFileSync(negative.path, original); }
    assert.deepEqual(inventory(packageRoot), packageBefore);
  }
  assert.deepEqual(inventory(client), before); assert.deepEqual(inventory(packageRoot), packageBefore); assert.deepEqual(inventory(tools), toolsBefore); controls();
  record(`${name}-after`, { consumer: inventory(client), package: inventory(packageRoot), tools: inventory(tools) });
  modes.push({ mode: name, publicResultOrigin: existing ? `${attempt}/records/source-cases-result.json` : `${records}/${name}-cases-result.json`, pass: result.results.filter(row => row.status.startsWith('public-pass')).length, fail: result.results.filter(row => row.status === 'assertion-failure').length, blocked: 0, types: { positive: typeResult.positive, negative: typeResult.negative, inversions: typeResult.inversions.length }, adapters: adapters.results, loadNegatives: 4, productModules: new Set(result.loaded.filter(entry => entry.path.includes(name === 'source' ? '/source/src/' : '/node_modules/virtual-bash/dist/')).map(entry => entry.path)).size });
};
consumer(`${root}/source-proof-consumer`); types(`${root}/source-proof-consumer`);
await mode('source', `${root}/source-proof-consumer`, source, sourceResult);
await command('pack', [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root], source);
const packages = readdirSync(root).filter(name => name.endsWith('.tgz')); assert.equal(packages.length, 1); const tarball = `${root}/${packages[0]}`;
consumer(`${root}/installed-consumer`);
await command('install', [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], `${root}/installed-consumer`);
types(`${root}/installed-consumer`);
const installed = `${root}/installed-consumer/node_modules/virtual-bash`;
assert.deepEqual(inventory(`${installed}/dist`), inventory(`${source}/dist`));
for (const [path, entry] of Object.entries(inventory(installed))) if (entry.kind === 'file' && !path.startsWith('dist/')) { assert(files[path]); assert.equal(entry.sha256, files[path].sha256); }
record('package', { sha256: sha(readFileSync(tarball)), bytes: readFileSync(tarball).length, entries: inventory(installed) });
const sourceBeforeMove = inventory(source); renameSync(source, `${attempt}/source-retained`); assert(!existsSync(source)); assert.deepEqual(inventory(`${attempt}/source-retained`), sourceBeforeMove);
await mode('installed', `${root}/installed-consumer`, installed);
const beforeMove = inventory(`${root}/installed-consumer`); renameSync(`${root}/installed-consumer`, `${root}/physically-moved-consumer`); assert(!existsSync(`${root}/installed-consumer`)); assert.deepEqual(inventory(`${root}/physically-moved-consumer`), beforeMove);
await mode('moved', `${root}/physically-moved-consumer`, `${root}/physically-moved-consumer/node_modules/virtual-bash`);
record('SUMMARY', { modes, originalSourceCaseAttempt: 'attempt-02;86 public assertions passed, driver artifact limit failed separately', originalSourceNotRerun: true, L24: 'scripted FileSystem qualification; original Memory label invalid', packageSha256: sha(readFileSync(tarball)), actualService: false });
console.log(JSON.stringify(modes.map(({adapters,...mode})=>mode))); process.exitCode = modes.some(mode => mode.fail) ? 1 : 0;
