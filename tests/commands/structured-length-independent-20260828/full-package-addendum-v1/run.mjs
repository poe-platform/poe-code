import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scope = dirname(fileURLToPath(import.meta.url));
const owned = dirname(scope), repository = resolve(owned, '../../..');
const recipe = JSON.parse(readFileSync(join(scope, 'RECIPE.json')));
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const result = join(scope, 'result');
const snapshot = root => {
  const entries = {};
  const visit = folder => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name), stat = lstatSync(path), key = relative(root, path);
      if (stat.isSymbolicLink()) entries[key] = { link: readlinkSync(path) };
      else if (stat.isDirectory()) visit(path);
      else { assert.ok(stat.isFile(), key); entries[key] = { sha256: hash(readFileSync(path)), bytes: stat.size, mode: stat.mode & 0o777 }; }
    }
  };
  visit(root); return entries;
};
function parsePack(compressed) {
  assert.ok(compressed.length < 8 * 1024 * 1024);
  const tar = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
  const members = new Map();
  let offset = 0;
  const text = bytes => bytes.toString('utf8').split('\0')[0];
  const octal = bytes => { const value = text(bytes).trim(); assert.match(value, /^[0-7]+$/u); return parseInt(value, 8); };
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512);
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, octal(header.subarray(148, 156)));
    assert.equal(text(header.subarray(345, 500)), '');
    assert.equal(text(header.subarray(157, 257)), '');
    assert.ok(header[156] === 48 || header[156] === 0, 'regular members only');
    const path = text(header.subarray(0, 100));
    assert.ok(path.startsWith('package/'));
    assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.equal(path.includes('\\'), false);
    const name = path.slice(8), bytes = octal(header.subarray(124, 136)), mode = octal(header.subarray(100, 108));
    assert.ok(mode <= 0o777); assert.equal(members.has(name), false);
    assert.ok(offset + 512 + bytes <= tar.length);
    const content = Buffer.from(tar.subarray(offset + 512, offset + 512 + bytes));
    members.set(name, { content, sha256: hash(content), bytes, mode });
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  assert.ok(tar.length - offset >= 1024);
  assert.ok(tar.subarray(offset).every(byte => byte === 0));
  return members;
}
const inventory = members => Object.fromEntries([...members].sort(([left], [right]) => left.localeCompare(right)).map(([path, { sha256, bytes, mode }]) => [path, { sha256, bytes, mode }]));
function authenticateInputs() {
  const historical = {};
  const oldPaths = git(['ls-tree', '-r', '--name-only', recipe.independentEvidence, '--', relative(repository, owned)]).toString().trim().split('\n');
  for (const path of oldPaths) {
    const committed = git(['show', `${recipe.independentEvidence}:${path}`]);
    assert.deepEqual(readFileSync(join(repository, path)), committed, path);
    historical[path] = hash(committed);
  }
  const reportBytes = readFileSync(join(owned, 'actual-review-v1/attempt-01/REPORT.json'));
  assert.equal(hash(reportBytes), recipe.priorReportSha256);
  const prior = JSON.parse(reportBytes);
  assert.equal(prior.candidate, recipe.candidate); assert.equal(prior.completed, true);
  const author = join(repository, 'tests/commands/structured-length-author-20260828');
  assert.equal(hash(readFileSync(join(author, 'reconstruct.mjs'))), recipe.authorReconstructSha256);
  const projectionBytes = readFileSync(join(author, 'evidence-candidate-v1/package/candidate/virtual-bash-0.0.0.tgz'));
  assert.equal(hash(projectionBytes), recipe.projectionSha256);
  const projection = parsePack(projectionBytes);
  assert.equal(projection.size, 845);
  assert.deepEqual(Object.fromEntries([...projection].map(([path, entry]) => [path, entry.sha256])), prior.packages[0].files);
  const compressed = Buffer.from(readFileSync(join(repository, 'tests/integration/combined77-stage2-independent-20260828/actual-01.json.gz.base64'), 'utf8'), 'base64');
  assert.equal(hash(compressed), recipe.baselineCaptureCompressedSha256);
  const capture = JSON.parse(gunzipSync(compressed));
  const baselineBytes = Buffer.from(capture.package.base64, 'base64');
  assert.equal(hash(baselineBytes), recipe.baselineFullPackSha256);
  const baseline = parsePack(baselineBytes), readme = baseline.get('README.md');
  assert.equal(baseline.size, 846);
  assert.deepEqual(inventory(baseline), capture.packageInventory);
  assert.equal(readme.sha256, recipe.addition.sha256); assert.equal(readme.bytes, recipe.addition.bytes); assert.equal(readme.mode, recipe.addition.mode);
  assert.deepEqual(readme.content, git(['show', `${recipe.baseline}:README.md`]));
  const expected = new Map(projection); assert.equal(expected.has('README.md'), false); expected.set('README.md', readme);
  assert.deepEqual([...expected.keys()].sort(), [...baseline.keys()].sort());
  for (const [path, entry] of projection) assert.equal(entry.mode, baseline.get(path).mode, path);
  const changes = [...projection].filter(([path, entry]) => entry.sha256 !== baseline.get(path).sha256).map(([path]) => path).sort();
  assert.deepEqual(changes, ['dist/commands/structured/interpreter.d.ts.map', 'dist/commands/structured/interpreter.js', 'dist/commands/structured/interpreter.js.map']);
  return { historical, projection, expected, changes, priorSource: prior.archive };
}
function checkPackage(bytes, inputs) {
  const members = parsePack(bytes), files = inventory(members);
  assert.equal(members.size, recipe.expectedMembers);
  assert.deepEqual(files, inventory(inputs.expected));
  for (const [path, entry] of inputs.expected) assert.deepEqual(members.get(path).content, entry.content, path);
  const metadata = JSON.parse(members.get('package.json').content);
  assert.deepEqual(members.get('package.json').content, inputs.projection.get('package.json').content);
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(Object.keys(metadata[key] ?? {}).length, 0);
  assert.equal((metadata.bundledDependencies ?? metadata.bundleDependencies ?? []).length, 0);
  const exportTargets = [];
  const walk = value => {
    if (typeof value === 'string') {
      assert.ok(value.startsWith('./dist/')); const target = value.slice(2);
      const matches = target.includes('*') ? [...members.keys()].filter(path => path.startsWith(target.split('*')[0]) && path.endsWith(target.split('*')[1])) : [target].filter(path => members.has(path));
      assert.ok(matches.length > 0, target); exportTargets.push({ target, members: matches.sort() });
    } else for (const child of Object.values(value)) walk(child);
  };
  walk(metadata.exports);
  assert.ok(members.has(metadata.main.slice(2))); assert.ok(members.has(metadata.types.slice(2)));
  return { files, metadata, exportTargets };
}
const inputs = authenticateInputs();
if (process.argv[2] === '--verify') {
  const report = JSON.parse(readFileSync(join(result, 'REPORT.json')));
  assert.equal(report.completed, true); assert.equal(report.scratchRemoved, true);
  for (const [name, digest] of Object.entries(report.preseal.files)) {
    assert.equal(hash(readFileSync(join(scope, name))), digest);
    assert.equal(hash(git(['show', `${report.preseal.commit}:${relative(repository, join(scope, name))}`])), digest);
  }
  const bytes = readFileSync(join(result, 'virtual-bash-0.0.0.tgz'));
  assert.equal(hash(bytes), report.package.sha256);
  assert.deepEqual(checkPackage(bytes, inputs), report.package.validation);
  assert.deepEqual(report.historyBefore, inputs.historical); assert.deepEqual(report.historyAfter, inputs.historical);
  assert.equal(report.pack.status, 0); assert.equal(report.pack.signal, null); assert.equal(report.pack.error, null);
  assert.equal(report.behaviorTestsRun, 0); assert.equal(report.buildsRun, 0);
  process.stdout.write(JSON.stringify({ verdict: 'full846 additive packing proof verified; no execution replay', sha256: hash(bytes), members: 846, unchangedCommon: 845 }) + '\n');
} else {
  const revision = process.argv[2]; assert.match(revision ?? '', /^[0-9a-f]{40}$/u);
  assert.equal(existsSync(result), false, 'never overwrite an earlier packing attempt');
  const preseal = { commit: revision, files: {} };
  for (const name of ['RECIPE.json', 'PRESEAL.md', 'run.mjs']) {
    const bytes = readFileSync(join(scope, name));
    assert.deepEqual(bytes, git(['show', `${revision}:${relative(repository, join(scope, name))}`])); preseal.files[name] = hash(bytes);
  }
  assert.equal(realpathSync(process.execPath), realpathSync(recipe.nodePath));
  assert.equal(hash(readFileSync(process.execPath)), recipe.nodeSha256); assert.equal(hash(readFileSync(recipe.npmPath)), recipe.npmSha256);
  const toolsBefore = snapshot(resolve(dirname(recipe.npmPath), '..'));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'length-full846-')));
  mkdirSync(result);
  const report = { started: new Date().toISOString(), recipe, preseal, historyBefore: inputs.historical, priorSource: inputs.priorSource,
    baselineContentChanges: inputs.changes, runtime: { path: process.execPath, version: process.version, sha256: recipe.nodeSha256 },
    npm: { path: recipe.npmPath, sha256: recipe.npmSha256, files: Object.keys(toolsBefore).length, inventorySha256: hash(JSON.stringify(toolsBefore)) },
    behaviorTestsRun: 0, buildsRun: 0, productEdits: false, completed: false, scratchRemoved: false };
  try {
    const stage = join(scratch, 'stage'), destination = join(scratch, 'pack'), home = join(scratch, 'home');
    for (const path of [stage, destination, home]) mkdirSync(path);
    for (const [path, entry] of inputs.expected) { const target = join(stage, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, entry.content, { flag: 'wx' }); chmodSync(target, entry.mode); }
    const stageBefore = snapshot(stage); assert.deepEqual(stageBefore, inventory(inputs.expected));
    const env = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
      npm_config_cache: join(scratch, 'cache'), npm_config_userconfig: join(scratch, 'user.npmrc'), npm_config_globalconfig: join(scratch, 'global.npmrc'),
      npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
    writeFileSync(env.npm_config_userconfig, ''); writeFileSync(env.npm_config_globalconfig, '');
    const args = [recipe.npmPath, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', destination];
    const run = spawnSync(process.execPath, args, { cwd: stage, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    report.pack = { executable: process.execPath, args, cwd: stage, env, status: run.status, signal: run.signal, error: run.error?.message ?? null, stdout: run.stdout, stderr: run.stderr };
    assert.equal(run.status, 0); assert.equal(run.signal, null); assert.equal(run.error, undefined);
    const [metadata, ...extra] = JSON.parse(run.stdout); assert.equal(extra.length, 0);
    assert.equal(metadata.filename, 'virtual-bash-0.0.0.tgz'); assert.deepEqual(readdirSync(destination), [metadata.filename]);
    const bytes = readFileSync(join(destination, metadata.filename)); const validation = checkPackage(bytes, inputs);
    assert.equal(metadata.entryCount, 846); assert.deepEqual(metadata.bundled, []);
    assert.equal(metadata.name, validation.metadata.name); assert.equal(metadata.version, validation.metadata.version);
    assert.equal(metadata.size, bytes.length); assert.equal(metadata.shasum, hash(bytes, 'sha1')); assert.equal(metadata.integrity, 'sha512-' + hash(bytes, 'sha512', 'base64'));
    assert.deepEqual(Object.fromEntries(metadata.files.map(entry => [entry.path, { bytes: entry.size, mode: entry.mode }])), Object.fromEntries(Object.entries(validation.files).map(([path, entry]) => [path, { bytes: entry.bytes, mode: entry.mode }])));
    report.package = { sha256: hash(bytes), bytes: bytes.length, npmMetadata: metadata, validation };
    report.controls = [];
    for (const [name, mutate] of [
      ['missing README', values => { delete values['README.md']; }],
      ['changed common module', values => { values['dist/commands/structured/interpreter.js'].sha256 = '0'.repeat(64); }],
      ['changed common mode', values => { values['package.json'].mode = 0o600; }]
    ]) { const altered = structuredClone(validation.files); mutate(altered); assert.throws(() => assert.deepEqual(altered, inventory(inputs.expected))); report.controls.push({ name, rejected: true, kind: 'in-memory manifest comparator control; not product execution' }); }
    assert.deepEqual(snapshot(stage), stageBefore); assert.deepEqual(snapshot(resolve(dirname(recipe.npmPath), '..')), toolsBefore);
    assert.equal(hash(readFileSync(process.execPath)), recipe.nodeSha256);
    report.historyAfter = authenticateInputs().historical; assert.deepEqual(report.historyAfter, report.historyBefore);
    report.stageBeforeAfterIdentical = true; report.toolInventoryBeforeAfterIdentical = true;
    writeFileSync(join(result, metadata.filename), bytes, { flag: 'wx' });
    report.completed = true;
  } catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    rmSync(scratch, { recursive: true, force: true }); report.scratchRemoved = !existsSync(scratch); report.finished = new Date().toISOString();
    writeFileSync(join(result, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ completed: report.completed, sha256: report.package?.sha256, scratchRemoved: report.scratchRemoved, failure: report.failure?.message }) + '\n');
}
