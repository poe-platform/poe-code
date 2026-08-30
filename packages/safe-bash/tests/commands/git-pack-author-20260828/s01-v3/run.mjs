import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR.json')));
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const manifest = JSON.parse(await fs.readFile(path.join(own, 'SOURCE.json')));
assert.equal(sha(await fs.readFile(path.join(own, 'SOURCE.json'))), executor.source);
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version); assert.equal(sha(await fs.readFile(process.execPath)), seal.node.sha256);
const baseBytes = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
assert.equal(sha(baseBytes), seal.baseEvidence);
const base = JSON.parse(gunzipSync(Buffer.from(baseBytes.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
const started = Date.now(), output = await fs.mkdtemp(path.join(os.tmpdir(), 'git-m1b-s01-author-'));
const campaignStart = started;
console.log(JSON.stringify({ output, source: executor.source, candidate: manifest.computedTree }));
const receipt = { schema: 'git-m1b-author-result-v1', output, source: manifest, executor, status: 'PREPARING', children: [], cohorts: [], types: [], controls: [], failures: [], tools: {}, nativeRuns: 0, privateRuns: 0 };
let captured = 0, written = 0, childCount = 0;
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
  assert.ok(++childCount <= seal.bounds.children); assert.ok(Date.now() - campaignStart < seal.bounds.totalSeconds * 1000);
  const row = { label, executable, executableSha256: sha(await fs.readFile(executable)), args, cwd, signals: [], closed: false };
  assert.equal(row.executableSha256, executable === seal.node.path ? seal.node.sha256 : seal.developmentGit.sha256); assert.ok(executable === seal.node.path || executable === seal.developmentGit.path);
  receipt.children.push(row);
  const instance = spawn(executable, args, { cwd, env: { ...environment, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] }); row.pid = instance.pid;
  const out = [], err = []; let size = 0, rescue, spawnError, alarm = false;
  const terminate = () => { if (alarm) return; alarm = true; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000); };
  const timer = setTimeout(terminate, Math.min(120000, seal.bounds.totalSeconds * 1000 - (Date.now() - campaignStart)));
  for (const [stream, chunks] of [[instance.stdout, out], [instance.stderr, err]]) stream.on('data', bytes => { size += bytes.length; captured += bytes.length; if (size > seal.bounds.childCaptureBytes || captured > seal.bounds.captureBytes) terminate(); else chunks.push(Buffer.from(bytes)); });
  instance.on('error', error => { spawnError = String(error); }); instance.stdin.on('error', () => {}); instance.stdin.end(input);
  const [code, signal] = await new Promise(resolve => instance.once('close', (...values) => resolve(values)));
  row.closed = true; clearTimeout(timer); clearTimeout(rescue);
  const stdout = Buffer.concat(out), stderr = Buffer.concat(err); Object.assign(row, { code, signal, spawnError, alarm, outputBytes: size, stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
  await write(path.join(output, `${label}.stdout`), stdout); await write(path.join(output, `${label}.stderr`), stderr); await save();
  row.scratchBytesAfterClose = await scratchBytes();
  assert.ok(!alarm && !spawnError && signal === null && code !== 78, `safety/setup/retirement stop: ${label}`);
  return { row, code, out: stdout, err: stderr };
}
const source = path.join(output, 'source'), harness = path.join(output, 'harness');
let compiler, npm, packageRows;
async function run(label, product, script, extras = {}, bindingMutation) {
  const real = await fs.realpath(product), rows = await inventory(path.join(real, 'dist'));
  const binding = { root: real, inputs: rows, harness: await fs.realpath(harness), trace: path.join(output, `${label}-loads.jsonl`) };
  if (bindingMutation) bindingMutation(binding);
  const bindingFile = path.join(output, `${label}-binding.json`); await write(bindingFile, JSON.stringify(binding));
  return child(label, process.execPath, ['--loader', path.join(harness, 'package-loader.mjs'), path.join(harness, script)], product, { GIT_AUTHOR_BINDING: bindingFile, GIT_AUTHOR_ROOT: real, GIT_AUTHOR_RESULT: path.join(output, `${label}-cases.json`), ...extras });
}
async function cohort(label, product, script) {
  const result = await run(label, product, script);
  const summary = JSON.parse(await fs.readFile(path.join(output, `${label}-cases.json`)));
  assert.equal(result.code, summary.fail ? 1 : 0); assert.equal(summary.cases.length, summary.pass + summary.fail); assert.equal(summary.cases.length, script === 'faults.mjs' ? 15 : script === 'packs.mjs' ? 93 : 140);
  receipt.cohorts.push({ label, ...summary }); for (const row of summary.cases.filter(row => row.status !== 'PASS')) receipt.failures.push({ label, ...row });
}
async function types(label, product) {
  const original = await fs.readFile(path.join(harness, 'consumer.ts.fixture'), 'utf8');
  for (const negative of [false, true]) {
    const filename = path.join(output, `consumer-${label}-${negative}.mts`);
    const text = original.replaceAll('PACKAGE_LEAF', path.join(product, 'dist/commands/git/index.js')).replaceAll(negative ? '// @ts-expect-error' : 'NEVER_REPLACE', negative ? '// removed directive' : '');
    await write(filename, text);
    const result = await child(`types-${label}-${negative}`, process.execPath, [compiler, '--strict', '--exactOptionalPropertyTypes', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--listFiles', '--typeRoots', path.join(source, 'node_modules/@types'), filename], output);
    const diagnostic = result.out.toString() + result.err.toString(), errors = diagnostic.split('\n').filter(line => /error TS\d+:/.test(line));
    const pass = negative ? result.code === 2 && errors.length === 4 : result.code === 0 && errors.length === 0;
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
  const blobs = await child('development-blobs', '/usr/bin/git', ['cat-file', '--batch'], repo, { GIT_OPTIONAL_LOCKS: '0', PATH: '/usr/bin' }, manifest.inputs.map(row => row.blob).join('\n') + '\n');
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
  for (const [destination, from] of [['fixture.json', 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'], ['packs.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json'], ['cases.mjs', 'tests/commands/git-author-20260828/cases.mjs'], ['package-loader.mjs', 'tests/commands/git-author-20260828/package-loader.mjs'], ['consumer.ts.fixture', 'tests/commands/git-author-20260828/consumer.ts.fixture'], ['packs.mjs', 'tests/commands/git-pack-author-20260828/packs.mjs'], ['faults.mjs', path.relative(repo, path.join(own, 'faults.mjs'))]]) {
    const row = executor.files.find(row => row.path === from), bytes = await fs.readFile(path.join(repo, from)); assert.equal(sha(bytes), row.sha256); await write(path.join(harness, destination), bytes);
  }
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
  packageRows = tarRows;
  const sourceDist = await inventory(path.join(source, 'dist'));
  for (const row of tarRows) { const bytes = await fs.readFile(path.join(source, row.path)); assert.equal(sha(bytes), row.sha256); }
  await cohort('source-m1a', source, 'cases.mjs'); await cohort('source-packs', source, 'packs.mjs'); await cohort('source-faults', source, 'faults.mjs'); await types('source', source);
  const installed = path.join(output, 'installed'); await write(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('offline-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], installed); assert.equal(install.code, 0, install.err.toString());
  const installedRoot = path.join(installed, 'node_modules/virtual-bash');
  assert.deepEqual(await inventory(installedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  await cohort('installed-m1a', installedRoot, 'cases.mjs'); await cohort('installed-packs', installedRoot, 'packs.mjs'); await cohort('installed-faults', installedRoot, 'faults.mjs'); await types('installed', installedRoot);
  const moved = path.join(output, 'moved package'); await fs.rename(installed, moved); const movedRoot = path.join(moved, 'node_modules/virtual-bash');
  await cohort('moved-m1a', movedRoot, 'cases.mjs'); await cohort('moved-packs', movedRoot, 'packs.mjs'); await cohort('moved-faults', movedRoot, 'faults.mjs'); await types('moved', movedRoot);
  const baselineArchive = Buffer.from((await fs.readFile(path.join(repo, 'tests/commands/git-pack-author-20260828/results-v2/PACKAGE.tgz.base64'), 'utf8')).trim(), 'base64');
  assert.equal(sha(baselineArchive), seal.previousPackageSha256);
  const baselineTar = gunzipSync(baselineArchive, { maxOutputLength: 67108864 }); let oldPack;
  for (let position = 0; position + 512 <= baselineTar.length && baselineTar[position] !== 0;) {
    const header = baselineTar.subarray(position, position + 512), name = header.subarray(0, 100).toString().split('\0')[0], size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= baselineTar.length - position - 512);
    if (name === 'package/dist/commands/git/pack.js') { assert.equal(oldPack, undefined); oldPack = baselineTar.subarray(position + 512, position + 512 + size); }
    position += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(oldPack); assert.equal(oldPack.length, 14274); assert.equal(sha(oldPack), '70215ca9b5ce757cfac1e86dd6fba9ac8c76b7ad4c681554ecb37c3222bc3232');
  const mutant = path.join(output, 'original-pack-reversion');
  for (const row of tarRows) await write(path.join(mutant, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode);
  const target = path.join(mutant, 'dist/commands/git/pack.js'), candidateBytes = await fs.readFile(target);
  await fs.writeFile(target, oldPack);
  const reverted = await run('original-pack-reversion', mutant, 'faults.mjs');
  const originalSummary = JSON.parse(await fs.readFile(path.join(output, 'original-pack-reversion-cases.json')));
  const expectedFaults = ['reserve-error', 'reserve-null', 'reserve-undefined', 'allocation-error', 'allocation-null', 'allocation-undefined', 'public-reserve', 'public-allocation'];
  const oldFailed = originalSummary.cases.filter(row => row.status === 'FAIL');
  const detected = reverted.code === 1 && originalSummary.pass === 7 && originalSummary.fail === 8 && JSON.stringify(oldFailed.map(row => row.id)) === JSON.stringify(expectedFaults) && oldFailed.every(row => row.evidence?.fired === 1 && row.evidence.slotAcquired && row.evidence.slotReleases === 0);
  receipt.controls.push({ name: 'loaded-original-pack-reversion', detected, summary: originalSummary, artifactSha256: sha(oldPack), qualification: 'Original compiled pack.js only; exact new package neighbors, not whole baseline replay or native allocation failure' });
  if (!detected) receipt.failures.push({ label: 'original-pack-reversion', expectedFaults, observed: originalSummary });
  await fs.writeFile(target, candidateBytes);
  const restored = await run('restored-candidate', mutant, 'faults.mjs'); const restoredSummary = JSON.parse(await fs.readFile(path.join(output, 'restored-candidate-cases.json')));
  assert.equal(sha(await fs.readFile(target)), tarRows.find(row => row.path === 'dist/commands/git/pack.js').sha256);
  const restorePass = restored.code === 0 && restoredSummary.pass === 15 && restoredSummary.fail === 0; receipt.controls.push({ name: 'restored-candidate', pass: restorePass, summary: restoredSummary });
  if (!restorePass) receipt.failures.push({ label: 'restored-candidate', summary: restoredSummary });
  const unreached = await run('unreached-injection', movedRoot, 'faults.mjs', { S01_CONTROL: 'unreached' });
  const unreachedSummary = JSON.parse(await fs.readFile(path.join(output, 'unreached-injection-cases.json'))), missed = unreachedSummary.cases.filter(row => row.status === 'FAIL');
  const calibrationPass = unreached.code === 1 && unreachedSummary.pass === 7 && unreachedSummary.fail === 8 && JSON.stringify(missed.map(row => row.id)) === JSON.stringify(expectedFaults) && missed.every(row => row.evidence?.fired === 0);
  receipt.controls.push({ name: 'unreached-injection', pass: calibrationPass, summary: unreachedSummary }); if (!calibrationPass) receipt.failures.push({ label: 'unreached-injection', summary: unreachedSummary });
  const denied = await run('wrong-binding', movedRoot, 'faults.mjs', {}, binding => { binding.inputs.find(row => row.path === 'commands/git/pack.js').sha256 = '0'.repeat(64); });
  assert.equal(denied.code, 1); assert.match(denied.err.toString(), /package hash mismatch/); receipt.controls.push({ name: 'wrong-binding', pass: true });
  assert.deepEqual(await inventory(path.join(source, 'src')), sourceBefore); assert.deepEqual(await inventory(path.join(source, 'dist')), sourceDist); assert.deepEqual(await inventory(movedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const row of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(source, row.path))), row.sha256);
  receipt.status = receipt.failures.length ? 'AUTHOR_ASSERTION_FAILURES' : 'AUTHOR_SCOPED_PASS';
} catch (error) { receipt.status = 'FAILED_OR_INCOMPLETE'; receipt.error = String(error?.stack ?? error); }
receipt.elapsedMs = Date.now() - started;
receipt.qualification = 'S01 synthetic source-path ownership evidence only; no native allocation failure/OOM/leak/H09/public-cap claim. Direct-child close records are not a native resource census.'; receipt.captureBytes = captured; receipt.scratchWriteBytes = written;
receipt.actualScratchBytes = await scratchBytes();
receipt.cleanup = { directChildren: childCount, allClosed: receipt.children.every(row => row.closed), signals: receipt.children.flatMap(row => row.signals), noGlobalDescendantClaim: true };
await save(); console.log(JSON.stringify({ output, status: receipt.status, failures: receipt.failures.length, package: receipt.package?.sha256 }));
process.exitCode = receipt.status === 'AUTHOR_SCOPED_PASS' ? 0 : 1;
