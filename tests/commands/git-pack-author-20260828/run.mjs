import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR-v2.json')));
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const manifest = JSON.parse(await fs.readFile(path.join(own, 'SOURCE-v2.json')));
assert.equal(sha(await fs.readFile(path.join(own, 'SOURCE-v2.json'))), executor.source);
assert.equal(process.execPath, seal.tools.node); assert.equal(process.version, seal.tools.nodeVersion); assert.equal(sha(await fs.readFile(process.execPath)), seal.tools.nodeSha256);
const baseBytes = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
assert.equal(sha(baseBytes), seal.baseEvidence);
const base = JSON.parse(gunzipSync(Buffer.from(baseBytes.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
const started = Date.now(), output = await fs.mkdtemp(path.join(os.tmpdir(), 'git-m1b-author-'));
const prior = JSON.parse(await fs.readFile(path.join(own, 'results-v1/SUMMARY.json')));
assert.equal(prior.status, 'AUTHOR_ASSERTION_FAILURES'); assert.equal(prior.cleanup.allClosed, true); assert.equal(prior.cleanup.signals.length, 0);
const campaignStart = (await fs.stat(path.join(prior.root, 'RESULT.json'))).mtimeMs - prior.elapsedMs;
assert.ok(started - campaignStart < seal.bounds.totalSeconds * 1000);
console.log(JSON.stringify({ output, source: executor.source, candidate: manifest.computedTree }));
const receipt = { schema: 'git-m1b-author-result-v1', output, source: manifest, executor, status: 'PREPARING', children: [], cohorts: [], types: [], controls: [], failures: [], tools: {}, nativeRuns: 0, privateRuns: 0 };
receipt.priorQualification = { root: prior.root, status: prior.status, rawSha256: prior.rawSha256, children: prior.cleanup.directChildren, campaignStart, countsUnchanged: true };
let captured = 0, written = 0, childCount = 0;
const save = () => fs.writeFile(path.join(output, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n');
async function write(file, bytes, mode = 0o644) { written += Buffer.byteLength(bytes); assert.ok(written + prior.scratchWriteBytes <= seal.bounds.scratchBytes); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes, { flag: 'wx', mode }); }
async function inventory(root) {
  const rows = [];
  const walk = async relative => { for (const name of (await fs.readdir(path.join(root, relative))).sort()) { assert.notEqual(name, 'AGENTS.md'); const filename = path.join(relative, name), target = path.join(root, filename), metadata = await fs.lstat(target); assert.ok(!metadata.isSymbolicLink()); if (metadata.isDirectory()) await walk(filename); else { assert.ok(metadata.isFile()); const bytes = await fs.readFile(target); rows.push({ path: filename, mode: metadata.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) }); } } };
  await walk(''); return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const environment = { PATH: path.dirname(process.execPath), HOME: path.join(output, 'home'), TMPDIR: path.join(output, 'tmp'), npm_config_cache: path.join(output, 'cache'), npm_config_userconfig: path.join(output, 'npmrc'), npm_config_globalconfig: path.join(output, 'global-npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', NO_COLOR: '1' };
async function child(label, executable, args, cwd, extra = {}, input) {
  assert.ok(++childCount + prior.cleanup.directChildren <= seal.bounds.ownedChildren); assert.ok(Date.now() - campaignStart < seal.bounds.totalSeconds * 1000);
  const row = { label, executable, executableSha256: sha(await fs.readFile(executable)), args, cwd, signals: [], closed: false };
  receipt.children.push(row);
  const instance = spawn(executable, args, { cwd, env: { ...environment, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] }); row.pid = instance.pid;
  const out = [], err = []; let size = 0, rescue, spawnError, alarm = false;
  const terminate = () => { if (alarm) return; alarm = true; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000); };
  const timer = setTimeout(terminate, Math.min(120000, seal.bounds.totalSeconds * 1000 - (Date.now() - campaignStart)));
  for (const [stream, chunks] of [[instance.stdout, out], [instance.stderr, err]]) stream.on('data', bytes => { size += bytes.length; captured += bytes.length; if (size > seal.bounds.childCaptureBytes || captured + prior.captureBytes > seal.bounds.captureBytes) terminate(); else chunks.push(Buffer.from(bytes)); });
  instance.on('error', error => { spawnError = String(error); }); instance.stdin.on('error', () => {}); instance.stdin.end(input);
  const [code, signal] = await new Promise(resolve => instance.once('close', (...values) => resolve(values)));
  row.closed = true; clearTimeout(timer); clearTimeout(rescue);
  const stdout = Buffer.concat(out), stderr = Buffer.concat(err); Object.assign(row, { code, signal, spawnError, alarm, outputBytes: size, stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
  await write(path.join(output, `${label}.stdout`), stdout); await write(path.join(output, `${label}.stderr`), stderr); await save();
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
  assert.equal(result.code, summary.fail ? 1 : 0); assert.equal(summary.cases.length, summary.pass + summary.fail);
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
  for (const [destination, from] of [['fixture.json', 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'], ['packs.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json'], ['cases.mjs', 'tests/commands/git-author-20260828/cases.mjs'], ['package-loader.mjs', 'tests/commands/git-author-20260828/package-loader.mjs'], ['consumer.ts.fixture', 'tests/commands/git-author-20260828/consumer.ts.fixture'], ['packs.mjs', path.relative(repo, path.join(own, 'packs.mjs'))]]) {
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
  await cohort('source-m1a', source, 'cases.mjs'); await cohort('source-packs', source, 'packs.mjs'); await types('source', source);
  const installed = path.join(output, 'installed'); await write(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('offline-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], installed); assert.equal(install.code, 0, install.err.toString());
  const installedRoot = path.join(installed, 'node_modules/virtual-bash');
  assert.deepEqual(await inventory(installedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  await cohort('installed-m1a', installedRoot, 'cases.mjs'); await cohort('installed-packs', installedRoot, 'packs.mjs'); await types('installed', installedRoot);
  const moved = path.join(output, 'moved package'); await fs.rename(installed, moved); const movedRoot = path.join(moved, 'node_modules/virtual-bash');
  await cohort('moved-m1a', movedRoot, 'cases.mjs'); await cohort('moved-packs', movedRoot, 'packs.mjs'); await types('moved', movedRoot);
  for (const [name, relative, before, after, caseId] of [
    ['hash', 'pack.js', 'await session.hash(inflated, type) === row.oid', 'true', 'object-hash'],
    ['crc', 'pack.js', 'await crc32(session, pack.subarray(row.offset, row.end)) === row.crc', 'true', 'N04'],
    ['depth', 'pack.js', 'row.depth <= GIT_LIMITS.maxDeltaDepth', 'true', 'P13'],
  ]) {
    const mutant = path.join(output, `mutant-${name}`);
    for (const row of tarRows) await write(path.join(mutant, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode);
    const target = path.join(mutant, 'dist/commands/git', relative), original = await fs.readFile(target, 'utf8'); assert.equal(original.split(before).length, 2); await fs.writeFile(target, original.replace(before, after));
    const result = await run(`mutant-${name}`, mutant, 'packs.mjs', { PACK_CASE: caseId });
    const summary = JSON.parse(await fs.readFile(path.join(output, `mutant-${name}-cases.json`)));
    const detected = result.code === 1 && summary.cases.length === 1 && summary.cases[0].status === 'FAIL'; receipt.controls.push({ name, detected, summary, sha256: sha(await fs.readFile(target)) });
    await fs.writeFile(target, original); assert.equal(sha(await fs.readFile(target)), tarRows.find(row => row.path === 'dist/commands/git/' + relative).sha256);
    const restored = await run(`restored-${name}`, mutant, 'packs.mjs', { PACK_CASE: caseId }); receipt.controls.push({ name: `restored-${name}`, pass: restored.code === 0 });
    if (!detected || restored.code !== 0) receipt.failures.push({ label: `mutant-${name}`, detected, restored: restored.code });
  }
  for (const kind of ['missing', 'changed', 'outside']) {
    const result = await run(`binding-${kind}`, movedRoot, 'packs.mjs', { PACK_CASE: 'P01' }, binding => { if (kind === 'outside') binding.root += '/not-this-package'; else { const row = binding.inputs.find(row => row.path === 'commands/git/index.js'); if (kind === 'missing') binding.inputs = binding.inputs.filter(entry => entry !== row); else row.sha256 = '0'.repeat(64); } });
    assert.equal(result.code, 1); assert.match(result.err.toString(), /package (binding missing member|hash mismatch|outside authenticated root)/); receipt.controls.push({ name: `binding-${kind}`, pass: true });
  }
  assert.deepEqual(await inventory(path.join(source, 'src')), sourceBefore); assert.deepEqual(await inventory(path.join(source, 'dist')), sourceDist); assert.deepEqual(await inventory(movedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const row of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(source, row.path))), row.sha256);
  receipt.status = receipt.failures.length ? 'AUTHOR_ASSERTION_FAILURES' : 'AUTHOR_SCOPED_PASS';
} catch (error) { receipt.status = 'FAILED_OR_INCOMPLETE'; receipt.error = String(error?.stack ?? error); }
receipt.elapsedMs = Date.now() - started; receipt.captureBytes = captured; receipt.scratchWriteBytes = written;
receipt.cleanup = { directChildren: childCount, allClosed: receipt.children.every(row => row.closed), signals: receipt.children.flatMap(row => row.signals), noGlobalDescendantClaim: true };
await save(); console.log(JSON.stringify({ output, status: receipt.status, failures: receipt.failures.length, package: receipt.package?.sha256 }));
process.exitCode = receipt.status === 'AUTHOR_SCOPED_PASS' ? 0 : 1;
