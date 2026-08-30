import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash } from './prepare.mjs';
import { internalLoaderArguments } from './internal-loader-arguments.mjs';
import { hashRegularFile } from './hash-regular-file.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
assert.equal(process.env.INDEPENDENT_PUBLIC80_ADMITTED, 'c83f352f057c64917f219eb938f54aa42cdab829');
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR.json')));
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const manifest = JSON.parse(await fs.readFile(path.join(own, 'SOURCE.json')));
assert.equal(sha(await fs.readFile(path.join(own, 'SOURCE.json'))), executor.source);
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version); assert.equal(hashRegularFile(process.execPath).sha256, seal.node.sha256);
const baseBytes = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
assert.equal(sha(baseBytes), seal.baseEvidence);
const base = JSON.parse(gunzipSync(Buffer.from(baseBytes.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
const started = Date.now(), output = await fs.mkdtemp(path.join(process.env.INDEPENDENT_PUBLIC80_SCRATCH, 'work-'));
const campaignStart = started;
console.log(JSON.stringify({ output, source: executor.source, candidate: manifest.computedTree }));
const receipt = { schema: 'git-public-independent-presealed-v3', output, source: manifest, executor, status: 'PREPARING', children: [], cohorts: [], types: [], controls: [], failures: [], tools: {}, nativeRuns: 0, privateRuns: 0 };
let captured = 0, written = 0, childCount = 0, workerCount = 0, loaderReservations = 0;
async function scratchBytes() {
  let total = 0;
  const scan = async root => { for (const name of await fs.readdir(root)) { const filename = path.join(root, name), stat = await fs.lstat(filename); assert.ok(!stat.isSymbolicLink()); if (stat.isDirectory()) await scan(filename); else { total += stat.size; assert.ok(total <= seal.bounds.scratchBytes); } } };
  await scan(output); return total;
}
const save = () => fs.writeFile(path.join(output, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n');
async function write(file, bytes, mode = 0o644) { written += Buffer.byteLength(bytes); assert.ok(written <= seal.bounds.scratchBytes); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes, { flag: 'wx', mode }); }
async function inventory(root) {
  const rows = [];
  const walk = async relative => { for (const name of (await fs.readdir(path.join(root, relative))).sort()) { assert.notEqual(name, 'AGENTS.md'); const filename = path.join(relative, name), target = path.join(root, filename), metadata = await fs.lstat(target); assert.ok(!metadata.isSymbolicLink()); if (metadata.isDirectory()) await walk(filename); else { assert.ok(metadata.isFile()); const bytes = await fs.readFile(target); rows.push({ path: filename, mode: metadata.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) }); } } };
  await walk(''); return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const environment = { PATH: path.dirname(process.execPath), HOME: path.join(output, 'home'), TMPDIR: path.join(output, 'tmp'), npm_config_cache: path.join(output, 'cache'), npm_config_userconfig: path.join(output, 'npmrc'), npm_config_globalconfig: path.join(output, 'global-npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', NO_COLOR: '1' };
async function child(label, executable, args, cwd, extra = {}, input) {
  assert.ok(++childCount + workerCount + loaderReservations <= seal.bounds.children);
  const guarded = args.includes('--loader');
  if (guarded) { loaderReservations++; assert.ok(childCount + workerCount + loaderReservations <= seal.bounds.children); }
  const resourceLog = path.join(output, label + '-resources.jsonl');
  if (guarded) {
    assert.ok(seal.internalLoader.labels.includes(label), 'unbound internal loader role');
    assert.ok(loaderReservations <= seal.internalLoader.maximumAdmissions);
    const loader = path.join(harness, 'loader.mjs'), bootstrap = path.join(harness, 'resources.mjs'), policy = path.join(harness, 'worker-policy.mjs');
    assert.equal(typeof extra.PUBLIC_BINDING, 'string');
    assert.ok(extra.PUBLIC_BINDING.startsWith(output + path.sep));
    const bindingMetadata = await fs.lstat(extra.PUBLIC_BINDING);
    assert.ok(bindingMetadata.isFile() && !bindingMetadata.isSymbolicLink() && bindingMetadata.size <= 8388608);
    assert.equal(await fs.realpath(extra.PUBLIC_BINDING), extra.PUBLIC_BINDING);
    const binding = JSON.parse(await fs.readFile(extra.PUBLIC_BINDING));
    const consumer = args.at(-1);
    for (const filename of [loader, bootstrap, policy, consumer]) {
      assert.equal(typeof filename, 'string'); assert.ok(filename.startsWith(output + path.sep));
      const metadata = await fs.lstat(filename); assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 8388608);
      assert.equal(await fs.realpath(filename), filename);
      const expected = filename === loader ? executor.files.find(row => row.path === path.relative(repo, path.join(own, 'loader.mjs'))) : binding.harness.find(row => row.path === filename);
      assert.ok(expected, 'unbound loader/bootstrap/consumer file');
      assert.equal(sha(await fs.readFile(filename)), expected.sha256);
    }
    args = internalLoaderArguments(args, { root: output, loader, bootstrap, consumer });
  }
  extra = { ...extra, ...(guarded ? { RESOURCE_LOG: resourceLog, RESOURCE_ALLOWANCE: String(label === 'maintained-four-bodies' ? Math.min(32 - workerCount, seal.bounds.children - childCount - workerCount - loaderReservations) : 0) } : {}) }; assert.ok(Date.now() - campaignStart < seal.bounds.totalSeconds * 1000);
  const row = { label, executable, executableSha256: hashRegularFile(executable).sha256, args, cwd, signals: [], closed: false };
  assert.equal(row.executableSha256, executable === seal.node.path ? seal.node.sha256 : seal.developmentGit.sha256); assert.ok(executable === seal.node.path || executable === seal.developmentGit.path);
  receipt.children.push(row);
  const rawPaths = [path.join(output, `${label}.stdout`), path.join(output, `${label}.stderr`)], ownedFds = []; let instance;
  try { for (const raw of rawPaths) ownedFds.push(fsSync.openSync(raw, 'wx')); instance = spawn(executable, args, { cwd, env: { ...environment, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] }); row.pid = instance.pid; } catch (error) { for (const fd of ownedFds) { try { fsSync.closeSync(fd); } catch {} } throw error; }
  const out = [], err = []; let size = 0, rescue, spawnError, alarm = false;
  const terminate = () => { if (alarm) return; alarm = true; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000); };
  const timer = setTimeout(terminate, Math.min(['production-build-once', 'offline-pack', 'offline-install', 'maintained-fixture-compile'].includes(label) ? 120000 : 30000, seal.bounds.totalSeconds * 1000 - (Date.now() - campaignStart)));
  for (const [stream, chunks] of [[instance.stdout, out], [instance.stderr, err]]) stream.on('data', bytes => { size += bytes.length; captured += bytes.length; if (size > seal.bounds.childCaptureBytes || captured > seal.bounds.captureBytes) terminate(); else { try { fsSync.writeSync(ownedFds[stream === instance.stdout ? 0 : 1], bytes); chunks.push(Buffer.from(bytes)); } catch (error) { row.captureError = String(error); terminate(); } } });
  instance.on('error', error => { spawnError = String(error); }); instance.stdin.on('error', () => {}); instance.stdin.end(input);
  const [code, signal] = await new Promise(resolve => instance.once('close', (...values) => resolve(values)));
  row.closed = true; clearTimeout(timer); clearTimeout(rescue);
  const closeErrors = []; for (const fd of ownedFds) { try { fsSync.closeSync(fd); } catch (error) { closeErrors.push(String(error)); } } assert.equal(closeErrors.length, 0, 'capture retirement failed');
  if (guarded) {
    const events = (await fs.readFile(resourceLog, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const births = events.filter(event => event.kind === 'worker-create'), exits = events.filter(event => event.kind === 'worker-exit');
    workerCount += births.length; assert.ok(workerCount <= 32); row.resources = { events, births: births.length, exits: exits.length, loaderReservation: 1 };
    assert.ok(childCount + workerCount + loaderReservations <= seal.bounds.children);
    if (!events.some(event => event.kind === 'bootstrap') || births.length !== exits.length || births.some(event => !exits.some(exit => exit.id === event.id))) { row.resourceClosureUnknown = true; }
  }
  const stdout = Buffer.concat(out), stderr = Buffer.concat(err); Object.assign(row, { code, signal, spawnError, alarm, outputBytes: size, stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
  assert.equal(sha(await fs.readFile(rawPaths[0])), sha(stdout)); assert.equal(sha(await fs.readFile(rawPaths[1])), sha(stderr)); await save();
  row.scratchBytesAfterClose = await scratchBytes();
  assert.ok(!row.captureError && !row.resourceClosureUnknown && !alarm && !spawnError && signal === null && code !== 78, `safety/setup/retirement stop: ${label}`);
  return { row, code, out: stdout, err: stderr };
}
const source = path.join(output, 'source'), harness = path.join(output, 'harness');
let compiler, npm, packageRows;
const consumers = new Map();
async function setupConsumer(product, layout) {
  const directory = layout === 'source' ? path.join(product, '__consumer') : path.dirname(path.dirname(product));
  await fs.mkdir(directory, { recursive: true });
  for (const name of ['public.mjs', 'apply-public.mjs', 'm1a.mjs', 'packs.mjs', 'fixture.json', 'packs.json', 'names.mjs', 'arrays.mjs', 'ARRAY-CASES.json', 'stream-consumer.mjs', 'novel.mjs']) await write(path.join(directory, name), await fs.readFile(path.join(harness, name)));
  await fs.mkdir(path.join(directory, 'coherence'));
  for (const name of ['probe.mjs', 'names.mjs', 'CASES.json', 'CASES-v2-overlay.json']) await write(path.join(directory, 'coherence', name), await fs.readFile(path.join(harness, 'coherence', name)));
  consumers.set(await fs.realpath(product), await fs.realpath(directory)); return directory;
}
async function run(label, product, script, extras = {}, bindingMutation) {
  const real = await fs.realpath(product), directory = consumers.get(real); assert.ok(directory);
  const rows = await inventory(path.join(real, 'dist')), harnessRows = [];
  for (const file of [path.join(directory, script), path.join(directory, 'names.mjs'), path.join(directory, 'coherence/names.mjs'), path.join(harness, 'resources.mjs'), path.join(harness, 'worker-policy.mjs')]) { const bytes = await fs.readFile(file); harnessRows.push({ path: await fs.realpath(file), sha256: sha(bytes) }); }
  const binding = { root: real, inputs: rows, harness: harnessRows, trace: path.join(output, label + '-loads.jsonl') }; if (bindingMutation) bindingMutation(binding);
  const bindingFile = path.join(output, label + '-binding.json'); await write(bindingFile, JSON.stringify(binding));
  return child(label, process.execPath, ['--test-reporter=tap', '--loader', path.join(harness, 'loader.mjs'), path.join(directory, script)], product, { PUBLIC_BINDING: bindingFile, GIT_AUTHOR_ROOT: real, GIT_AUTHOR_RESULT: path.join(output, label + '-git-cases.json'), PRODUCT_ROOT: real, PUBLIC_RESULT: path.join(output, label + '-cases.json'), LAYOUT: label, ...extras });
}
async function cohort(label, product, script, expected, extras = {}) {
  const result = await run(label, product, script, extras);
  const lines = result.out.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); const summary = lines.at(-1)?.summary; assert.ok(summary); assert.equal(summary.cases, expected); assert.equal(result.code, summary.pass === expected ? 0 : 1);
  const cases = lines.slice(0, -1); assert.equal(cases.length, expected);
  assert.ok(cases.every(row => !row.cleanupError && !row.cleanupFailure && (row.disposed === undefined || row.disposed === true || row.disposed === row.created)), 'cleanup failure stops dependent execution');
  receipt.cohorts.push({ label, ...summary, cases }); if (summary.pass !== expected) receipt.failures.push({ label, cases: cases.filter(row => !row.pass) });
}
async function moduleCohort(label, product, script, expected) {
  const result = await run(label, product, script);
  const summary = JSON.parse(await fs.readFile(path.join(output, label + '-git-cases.json')));
  assert.equal(summary.cases.length, expected); assert.equal(summary.pass + summary.fail, expected); assert.equal(result.code, summary.fail ? 1 : 0);
  receipt.cohorts.push({ label, ...summary }); if (summary.fail) receipt.failures.push({ label, cases: summary.cases.filter(row => row.status !== 'PASS') });
}
async function types(label, product) {
  const original = await fs.readFile(path.join(harness, 'consumer.ts.fixture'), 'utf8');
  for (const negative of [false, true]) {
    const filename = path.join(consumers.get(await fs.realpath(product)), `consumer-${label}-${negative}.mts`);
    const text = original.replaceAll(negative ? '// @ts-expect-error' : 'NEVER_REPLACE', negative ? '// removed directive' : '');
    await write(filename, text);
    const result = await child(`types-${label}-${negative}`, process.execPath, [compiler, '--strict', '--exactOptionalPropertyTypes', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--listFiles', '--typeRoots', path.join(source, 'node_modules/@types'), filename], output);
    const diagnostic = result.out.toString() + result.err.toString(), errors = diagnostic.split('\n').filter(line => /error TS\d+:/.test(line));
    const codes = errors.map(line => line.match(/error TS(\d+):/)?.[1]), lines = errors.map(line => Number(line.match(/\((\d+),\d+\): error TS/)?.[1]));
    const pass = negative ? result.code !== 0 && JSON.stringify(codes) === JSON.stringify(['2353','2353','2322','2353','2353','2353','2540','2540']) && JSON.stringify(lines) === JSON.stringify([9,11,13,15,17,19,21,23]) : result.code === 0 && errors.length === 0;
    const declarations = result.out.toString().split('\n').filter(line => line.endsWith('.d.ts') && line.includes('/dist/'));
    assert.ok(declarations.length > 0);
    const real = await fs.realpath(product), bound = [];
    for (const file of declarations) { const actual = await fs.realpath(file); assert.ok(actual.startsWith(real + '/dist/')); const row = packageRows.find(row => row.path === path.relative(real, actual)); assert.ok(row); assert.equal(sha(await fs.readFile(actual)), row.sha256); bound.push({ file: actual, sha256: row.sha256 }); }
    receipt.types.push({ label, negative, pass, errors, declarations: bound }); if (!pass) receipt.failures.push({ label: `types-${label}`, negative, errors });
  }
}
try {
  for (const name of ['home', 'tmp', 'cache', 'source', 'harness']) await fs.mkdir(path.join(output, name));
  for (const name of ['npmrc', 'global-npmrc']) await write(path.join(output, name), '');
  const blobs = await child('development-blobs', '/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', 'cat-file', '--batch'], repo, { GIT_OPTIONAL_LOCKS: '0', PATH: '/usr/bin' }, manifest.inputs.map(row => row.blob).join('\n') + '\n');
  assert.equal(blobs.code, 0); let offset = 0;
  for (const row of manifest.inputs) {
    assert.ok(!row.path.startsWith('/') && !row.path.split('/').some(part => part === '..' || part === 'AGENTS.md'));
    const newline = blobs.out.indexOf(10, offset); assert.equal(blobs.out.subarray(offset, newline).toString(), `${row.blob} blob ${row.bytes}`); offset = newline + 1;
    const bytes = blobs.out.subarray(offset, offset + row.bytes); offset += row.bytes + 1; assert.equal(sha(bytes), row.sha256); assert.equal(objectHash('blob', bytes), row.blob); assert.equal(blobs.out[offset - 1], 10);
    await write(path.join(source, row.path), bytes, Number.parseInt(row.mode, 8) & 0o777);
  }
  assert.equal(offset, blobs.out.length);
  for (const name of ['typescript', '@types/node', 'undici-types', 'npm']) {
    const tool = base.tools[name], destination = name === 'npm' ? path.join(output, 'tools/npm') : path.join(source, 'node_modules', name);
    assert.equal(sha(Buffer.from(JSON.stringify(tool.originalRows))), manifest.toolBindings[name].inventorySha256);
    for (const [relative, mode, length, digest] of tool.originalRows) {
      const filename = path.join(tool.origin, relative), stat = await fs.lstat(filename);
      if (mode === 'SYMLINK') { assert.ok(stat.isSymbolicLink()); assert.equal(await fs.readlink(filename), length); assert.ok(tool.omittedInternalBinLinks.some(([name, target]) => name === relative && target === length)); const target = await fs.realpath(filename), real = await fs.realpath(tool.origin); assert.ok(target.startsWith(real + path.sep)); const row = tool.originalRows.find(row => row[0] === path.relative(real, target)); assert.ok(row && row[1] !== 'SYMLINK'); assert.equal(sha(await fs.readFile(target)), row[3]); continue; }
      assert.ok(stat.isFile() && !stat.isSymbolicLink()); const bytes = await fs.readFile(filename); assert.equal(stat.mode & 0o777, mode); assert.equal(bytes.length, length); assert.equal(sha(bytes), digest); await write(path.join(destination, relative), bytes, mode);
    }
    receipt.tools[name] = { origin: tool.origin, rows: tool.originalRows, omittedInternalBinLinks: tool.omittedInternalBinLinks, copied: destination };
    assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'))).version, tool.version);
  }
  const harnessMap = [
    ['fixture.json', 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'], ['packs.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json'],
    ...['public.mjs', 'apply-public.mjs', 'packs.mjs', 'names.mjs'].map(name => [name, 'tests/integration/git-public-20260829/' + name]),
    ['m1a.mjs', 'tests/integration/git-public-20260829/m1a-public-v2.mjs'],
    ...['resources.mjs', 'worker-policy.mjs', 'loader.mjs', 'novel.mjs', 'consumer.ts.fixture'].map(name => [name, path.relative(repo, path.join(own, name))]),
    ['arrays.mjs', 'tests/integration/coherent78-arrays-author-20260828/arrays.mjs'], ['ARRAY-CASES.json', 'tests/integration/coherent78-arrays-author-20260828/ARRAY-CASES.json'],
    ...['probe.mjs', 'names.mjs', 'CASES.json', 'CASES-v2-overlay.json'].map(name => ['coherence/' + name, 'tests/integration/coherent78-shell-author-20260828/' + name]),
    ['stream-consumer.mjs', 'tests/plugins/stream-five-public/consumer.mjs'],
  ];
  for (const [destination, from] of harnessMap) { const row = executor.files.find(row => row.path === from), bytes = await fs.readFile(path.join(repo, from)); assert.equal(sha(bytes), row.sha256); await write(path.join(harness, destination), bytes); }
  const sourceBefore = await inventory(path.join(source, 'src'));
  compiler = path.join(source, 'node_modules/typescript/bin/tsc'); npm = path.join(output, 'tools/npm/bin/npm-cli.js');
  const build = await child('production-build-once', process.execPath, [compiler, '-p', path.join(source, 'tsconfig.build.json')], source); assert.equal(build.code, 0, build.out.toString());
  const packed = await child('offline-pack', process.execPath, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output], source); assert.equal(packed.code, 0, packed.err.toString());
  const filename = JSON.parse(packed.out.toString())[0].filename; assert.equal(path.basename(filename), filename); const tarball = path.join(output, filename), archive = await fs.readFile(tarball);
  receipt.package = { file: filename, bytes: archive.length, sha256: sha(archive), manifest: JSON.parse(packed.out.toString())[0] };
  const tar = gunzipSync(archive, { maxOutputLength: 67108864 }), tarRows = []; let cursor = 0;
  while (cursor + 512 <= tar.length && tar[cursor] !== 0) {
    const header = tar.subarray(cursor, cursor + 512), name = header.subarray(0, 100).toString().split('\0')[0], size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8), mode = Number.parseInt(header.subarray(100, 108).toString().replace(/\0/g, '').trim(), 8), type = header[156];
    assert.ok(name.startsWith('package/') && !name.split('/').some(part => part === '..' || part === 'AGENTS.md')); assert.ok(type === 0 || type === 48); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= tar.length - cursor - 512);
    let checksum = 0; for (let position = 0; position < 512; position++) checksum += position >= 148 && position < 156 ? 32 : header[position]; assert.equal(checksum, Number.parseInt(header.subarray(148, 156).toString().replace(/\0/g, '').trim(), 8));
    tarRows.push({ path: name.slice(8), mode, bytes: size, sha256: sha(tar.subarray(cursor + 512, cursor + 512 + size)) }); cursor += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(tar.subarray(cursor).every(byte => byte === 0)); assert.equal(new Set(tarRows.map(row => row.path)).size, tarRows.length); receipt.package.members = tarRows;
  packageRows = tarRows; assert.equal(tarRows.length, seal.expectedPackageMembers); assert.equal(receipt.package.sha256, '4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156'); assert.deepEqual(JSON.parse(await fs.readFile(path.join(source, 'package.json'))).dependencies ?? {}, {});
  const sourceDist = await inventory(path.join(source, 'dist'));
  for (const row of tarRows) { const bytes = await fs.readFile(path.join(source, row.path)); assert.equal(sha(bytes), row.sha256); }
  const coherenceIds = Array.from({ length: 17 }, (_, index) => 'C' + String(index + 2).padStart(2, '0')).concat('R15').join(',');
  async function layout(label, product) {
    await setupConsumer(product, label); await cohort(label + '-public', product, 'public.mjs', seal.cohorts.gitPublic); await cohort(label + '-apply', product, 'apply-public.mjs', 28); await moduleCohort(label + '-m1a', product, 'm1a.mjs', 140); await moduleCohort(label + '-packs', product, 'packs.mjs', 93); await cohort(label + '-arrays', product, 'arrays.mjs', 12); await cohort(label + '-coherence', product, 'coherence/probe.mjs', 18, { CASE_IDS: coherenceIds }); await types(label, product); await cohort(label + '-novel', product, 'novel.mjs', 12);
  }
  await layout('source', source);
  const installed = path.join(output, 'installed'); await write(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('offline-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], installed); assert.equal(install.code, 0, install.err.toString());
  const installedRoot = path.join(installed, 'node_modules/virtual-bash'); assert.deepEqual(await inventory(installedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  await layout('installed', installedRoot);
  const moved = path.join(output, 'moved package'); await fs.rename(installed, moved); const movedRoot = path.join(moved, 'node_modules/virtual-bash');
  consumers.set(await fs.realpath(movedRoot), await fs.realpath(moved));
  await cohort('moved-public', movedRoot, 'public.mjs', seal.cohorts.gitPublic); await cohort('moved-apply', movedRoot, 'apply-public.mjs', 28); await moduleCohort('moved-m1a', movedRoot, 'm1a.mjs', 140); await moduleCohort('moved-packs', movedRoot, 'packs.mjs', 93); await cohort('moved-arrays', movedRoot, 'arrays.mjs', 12); await cohort('moved-coherence', movedRoot, 'coherence/probe.mjs', 18, { CASE_IDS: coherenceIds }); await types('moved', movedRoot); await cohort('moved-novel', movedRoot, 'novel.mjs', 12);
  const fixtureSources = [...manifest.fixtures.filter(row => row.path.endsWith('.ts')).map(row => row.path), 'tests/commands/stream-format/helpers.ts', 'tests/commands/split/helpers.ts'];
  const fixtureRoot = path.join(source, '__canonical'), fixtureBuild = path.join(source, '__canonical-built'); const migrations = [];
  for (const name of fixtureSources) {
    const row = executor.files.find(row => row.path === name), original = await fs.readFile(path.join(repo, name), 'utf8'); assert.equal(sha(Buffer.from(original)), row.sha256);
    const imports = []; const text = original.replace(/(["'])(?:\.\.\/)+src\/[^"']+\.js\1/g, specifier => { imports.push(specifier); return '"virtual-bash"'; });
    assert.ok(imports.length); await write(path.join(fixtureRoot, name), text); migrations.push({ path: name, originalSha256: row.sha256, routedSha256: sha(Buffer.from(text)), imports, onlyImportRouting: true });
  }
  receipt.maintainedImportRouting = migrations;
  const compiled = await child('maintained-fixture-compile', process.execPath, [compiler, '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--rootDir', fixtureRoot, '--outDir', fixtureBuild, '--typeRoots', path.join(source, 'node_modules/@types'), ...fixtureSources.map(name => path.join(fixtureRoot, name))], source);
  assert.equal(compiled.code, 0, compiled.out.toString());
  const testFiles = manifest.fixtures.filter(row => row.path.endsWith('.ts')).map(row => path.join(fixtureBuild, row.path.replace(/\.ts$/, '.js')));
  const driver = path.join(source, '__canonical-driver.mjs');
  await write(driver, 'import cp from "node:child_process"; import { syncBuiltinESMExports } from "node:module"; let calls=0; for(const key of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])cp[key]=()=>{calls++;throw Error("Native fixture execution not admitted");};syncBuiltinESMExports();process.once("beforeExit",()=>{if(calls)process.exitCode=78;});\n' + testFiles.map(file => 'await import(' + JSON.stringify('file://' + file) + ');').join('\n'));
  const canonicalInputs = await inventory(fixtureBuild), canonicalReal = await fs.realpath(fixtureBuild); const canonicalBinding = { root: await fs.realpath(source), inputs: sourceDist, harness: [{ path: await fs.realpath(path.join(harness, 'worker-policy.mjs')), sha256: sha(await fs.readFile(path.join(harness, 'worker-policy.mjs'))) }, { path: await fs.realpath(path.join(harness, 'resources.mjs')), sha256: sha(await fs.readFile(path.join(harness, 'resources.mjs'))) }, { path: await fs.realpath(driver), sha256: sha(await fs.readFile(driver)) }, ...canonicalInputs.map(row => ({ path: path.join(canonicalReal, row.path), sha256: row.sha256 }))], trace: path.join(output, 'maintained-loads.jsonl') };
  await write(path.join(output, 'maintained-binding.json'), JSON.stringify(canonicalBinding));
  const maintained = await child('maintained-four-bodies', process.execPath, ['--test-reporter=tap', '--test-timeout=30000', '--loader', path.join(harness, 'loader.mjs'), driver], source, { PUBLIC_BINDING: path.join(output, 'maintained-binding.json') });
  const tapCount = name => Number(maintained.out.toString().match(new RegExp('^# ' + name + ' ([0-9]+)$', 'm'))?.[1]);
  const maintainedResult = { code: maintained.code, tests: tapCount('tests'), pass: tapCount('pass'), fail: tapCount('fail'), skipped: tapCount('skipped'), cancelled: tapCount('cancelled') }; receipt.maintained = maintainedResult;
  assert.ok(Number.isSafeInteger(maintainedResult.tests) && maintainedResult.tests > 0); if (maintained.code !== 0 || maintainedResult.fail || maintainedResult.skipped || maintainedResult.cancelled) receipt.failures.push({ label: 'maintained-four-bodies', ...maintainedResult });
  const stream = await run('maintained-stream-consumer', movedRoot, 'stream-consumer.mjs'); const streamOut = stream.out.toString(); const streamResult = { code: stream.code, tests: Number(streamOut.match(/^# tests ([0-9]+)$/m)?.[1]), pass: Number(streamOut.match(/^# pass ([0-9]+)$/m)?.[1]), fail: Number(streamOut.match(/^# fail ([0-9]+)$/m)?.[1]) }; receipt.streamConsumer = streamResult; assert.ok(Number.isSafeInteger(streamResult.tests) && streamResult.tests > 0); if (stream.code !== 0 || streamResult.fail) receipt.failures.push({ label: 'maintained-stream-consumer', ...streamResult });
  const mutant = path.join(output, 'registration-mutant'); await write(path.join(mutant, 'package.json'), '{"private":true,"type":"module"}\n'); const mutantRoot = path.join(mutant, 'node_modules/virtual-bash');
  for (const row of tarRows) await write(path.join(mutantRoot, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode); await setupConsumer(mutantRoot, 'mutant');
  const target = path.join(mutantRoot, 'dist/plugins/index.js'), original = await fs.readFile(target, 'utf8'), marker = '...createGitCommands({ ...options.git, replace: false })'; assert.equal(original.split(marker).length, 2); await fs.writeFile(target, original.replace(marker, '...[]'));
  const omission = await run('registration-mutant', mutantRoot, 'public.mjs', { PUBLIC_CASE: 'G02-exact80' }); const omittedCases = JSON.parse(await fs.readFile(path.join(output, 'registration-mutant-cases.json'))); const detected = omission.code === 1 && omittedCases.fail === 1 && omittedCases.cases[0].id === 'G02-exact80'; receipt.controls.push({ name: 'registration-omission', detected, candidateArtifactSha256: sha(Buffer.from(original)), mutantArtifactSha256: sha(await fs.readFile(target)) }); if (!detected) receipt.failures.push({ label: 'registration-omission', omittedCases });
  await fs.writeFile(target, original); const restored = await run('registration-restored', mutantRoot, 'public.mjs', { PUBLIC_CASE: 'G02-exact80' }); assert.equal(sha(await fs.readFile(target)), tarRows.find(row => row.path === 'dist/plugins/index.js').sha256); receipt.controls.push({ name: 'registration-restored', pass: restored.code === 0 }); if (restored.code !== 0) receipt.failures.push({ label: 'registration-restored' });
  for (const kind of ['missing', 'changed', 'outside']) {
    const result = await run('binding-' + kind, movedRoot, 'public.mjs', {}, binding => { if (kind === 'outside') binding.root += '/not-candidate'; else { const name = kind === 'missing' ? 'index.js' : 'commands/git/index.js'; if (kind === 'missing') binding.inputs = binding.inputs.filter(row => row.path !== name); else binding.inputs.find(row => row.path === name).sha256 = '0'.repeat(64); } }); assert.equal(result.code, 1); assert.match(result.err.toString(), /package (binding missing member|hash mismatch|outside authenticated compiled root)/); receipt.controls.push({ name: 'binding-' + kind, pass: true });
  }
  const packagePath = path.join(mutantRoot, 'package.json'), packageText = await fs.readFile(packagePath, 'utf8'), packageData = JSON.parse(packageText); delete packageData.exports['./commands/git']; await fs.writeFile(packagePath, JSON.stringify(packageData));
  const noExport = await run('missing-explicit-export', mutantRoot, 'public.mjs'); assert.equal(noExport.code, 1); assert.match(noExport.err.toString(), /ERR_PACKAGE_PATH_NOT_EXPORTED/); receipt.controls.push({ name: 'missing-explicit-export', pass: true }); await fs.writeFile(packagePath, packageText);
  const exportRestored = await run('explicit-export-restored', mutantRoot, 'public.mjs', { PUBLIC_CASE: 'G01-public-exports' }); assert.equal(exportRestored.code, 0); receipt.controls.push({ name: 'explicit-export-restored', pass: true });
  const rootIndex = path.join(mutantRoot, 'dist/index.js'), rootText = await fs.readFile(rootIndex, 'utf8'), rootLine = 'export * from "./commands/git/index.js";'; assert.equal(rootText.split(rootLine).length, 2);
  await fs.writeFile(rootIndex, rootText.replace(rootLine, ''));
  const rootMissing = await run('root-export-mutant', mutantRoot, 'public.mjs', { PUBLIC_CASE: 'G01-public-exports' }); assert.equal(rootMissing.code, 1); assert.ok(rootMissing.out.toString().includes('G01-public-exports')); receipt.controls.push({ name: 'root-export-mutant', pass: true });
  await fs.writeFile(rootIndex, rootText);
  const rootRestored = await run('root-export-restored', mutantRoot, 'public.mjs', { PUBLIC_CASE: 'G01-public-exports' }); assert.equal(rootRestored.code, 0); receipt.controls.push({ name: 'root-export-restored', pass: true });
  assert.deepEqual(await inventory(path.join(source, 'src')), sourceBefore); assert.deepEqual(await inventory(path.join(source, 'dist')), sourceDist); assert.deepEqual(await inventory(movedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const row of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(source, row.path))), row.sha256);
  receipt.status = receipt.failures.length ? 'INDEPENDENT_ASSERTION_FAILURES' : 'INDEPENDENT_SCOPED_PASS';
} catch (error) { receipt.status = 'FAILED_OR_INCOMPLETE'; receipt.error = String(error?.stack ?? error); }
receipt.elapsedMs = Date.now() - started;
receipt.qualification = 'Scoped public Git80 author composition only; no module reacceptance, native/private/network, whole gate, hard preemption or global resource census. Maintained fixture body imports routed to authenticated built package; historical fixed cohorts unchanged.'; receipt.captureBytes = captured; receipt.scratchWriteBytes = written;
receipt.actualScratchBytes = await scratchBytes();
receipt.cleanup = { directChildren: childCount, observedProductWorkers: workerCount, internalLoaderAdmissions: loaderReservations, internalWorkerExitEventsObserved: false, boundedOwnedTotal: childCount + workerCount + loaderReservations, allClosed: receipt.children.every(row => row.closed), signals: receipt.children.flatMap(row => row.signals), noGlobalDescendantClaim: true };
await save(); console.log(JSON.stringify({ output, status: receipt.status, failures: receipt.failures.length, package: receipt.package?.sha256 }));
process.exitCode = receipt.status === 'INDEPENDENT_SCOPED_PASS' ? 0 : 1;
