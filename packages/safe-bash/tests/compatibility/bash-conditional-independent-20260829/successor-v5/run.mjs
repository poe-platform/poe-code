import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fsSync from 'node:fs';
import { internalLoaderArguments } from './internal-loader-arguments.mjs';
import { hashRegularFile } from './hash-regular-file.mjs';
import { verifyToolClosure } from './tool-closure.mjs';
import { verifyComposition } from './derived-tree.mjs';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash, hashExecutable } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR.json')));
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const manifest = JSON.parse(await fs.readFile(path.join(own, 'SOURCE.json')));
const composition = verifyComposition(manifest);
assert.equal(sha(await fs.readFile(path.join(own, 'SOURCE.json'))), executor.source);
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version); assert.equal(await hashExecutable(process.execPath), seal.node.sha256);
const baseBytes = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
assert.equal(sha(baseBytes), seal.baseEvidence);
const base = JSON.parse(gunzipSync(Buffer.from(baseBytes.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
const started = Number(process.env.REVIEW_STARTED), output = process.env.REVIEW_SCRATCH;
assert.ok(Number.isSafeInteger(started) && typeof output === 'string' && output.startsWith(own + path.sep));
await fs.mkdir(output);
const campaignStart = started;
console.log(JSON.stringify({ output, source: executor.source, candidate: manifest.computedTree }));
const receipt = { schema: 'conditional-independent-result-v5', output, source: manifest, executor, status: 'PREPARING', children: [], cohorts: [], types: [], controls: [], failures: [], tools: {}, nativeRuns: 0, privateRuns: 0 };
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
  extra = { ...extra, ...(guarded ? { RESOURCE_LOG: resourceLog, RESOURCE_ALLOWANCE: String(label.endsWith('-retained') ? Math.min(12 - workerCount, seal.bounds.children - childCount - workerCount - loaderReservations) : 0) } : {}) }; assert.ok(Date.now() - campaignStart < seal.bounds.totalSeconds * 1000);
  if (!guarded && executable === seal.node.path) args = ['--import', path.join(own, 'tool-observer.mjs'), ...args];
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
    workerCount += births.length; assert.ok(workerCount <= 12); row.resources = { events, births: births.length, exits: exits.length, loaderReservation: 1 };
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
let compiler, npm, packageRows, activeMutation;
const consumers = new Map();
async function setupConsumer(product, layout) {
  const directory = layout === 'source' ? path.join(product, '__consumer') : path.dirname(path.dirname(product));
  await fs.mkdir(directory, { recursive: true });
  for (const row of seal.fixtureCopies) await write(path.join(directory, row.destination), await fs.readFile(path.join(harness, row.destination)));
  consumers.set(await fs.realpath(product), await fs.realpath(directory)); return directory;
}
async function run(label, product, script, extras = {}, bindingMutation) {
  const real = await fs.realpath(product), directory = consumers.get(real); assert.ok(directory);
  const rows = await inventory(path.join(real, 'dist')), harnessRows = [];
  for (const row of rows) { const expected = packageRows.find(member => member.path === 'dist/' + row.path); assert.ok(expected); assert.equal(row.sha256, activeMutation?.path === 'dist/' + row.path ? activeMutation.sha256 : expected.sha256); }
  assert.equal(rows.length, packageRows.filter(row => row.path.startsWith('dist/')).length);
  for (const copy of seal.fixtureCopies) { const file = path.join(directory, copy.destination), bytes = await fs.readFile(file); assert.equal(sha(bytes), copy.sha256); if (file.endsWith('.mjs')) harnessRows.push({ path: await fs.realpath(file), sha256: copy.sha256 }); }
  for (const name of ['resources.mjs', 'worker-policy.mjs']) { const file = path.join(harness, name), bytes = await fs.readFile(file), expected = executor.files.find(row => row.path === path.relative(repo, path.join(own, name))); assert.equal(sha(bytes), expected.sha256); harnessRows.push({ path: await fs.realpath(file), sha256: expected.sha256 }); }
  const binding = { root: real, inputs: rows, harness: harnessRows, trace: path.join(output, label + '-loads.jsonl') }; if (bindingMutation) bindingMutation(binding);
  const bindingFile = path.join(output, label + '-binding.json'); await write(bindingFile, JSON.stringify(binding));
  const result = await child(label, process.execPath, ['--test-reporter=tap', '--loader', path.join(harness, 'loader.mjs'), path.join(directory, script)], product, { PUBLIC_BINDING: bindingFile, GIT_AUTHOR_ROOT: real, GIT_AUTHOR_RESULT: path.join(output, label + '-git-cases.json'), PRODUCT_ROOT: real, PUBLIC_RESULT: path.join(output, label + '-cases.json'), LAYOUT: label, SOURCE_FALLBACK: path.join(source, 'dist/index.js'), ...extras });
  let traces = []; try { traces = (await fs.readFile(binding.trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const trace of traces) { assert.ok(trace.file.startsWith(real + '/dist/')); const row = binding.inputs.find(member => path.join(real, 'dist', member.path) === trace.file); assert.ok(row); assert.equal(trace.sha256, row.sha256); }
  if (!label.startsWith('binding-')) { assert.ok(traces.length); assert.ok(traces.some(row => row.file === path.join(real, 'dist/index.js'))); }
  result.row.loads = traces; return result;
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
  for (const role of ['author', 'independent']) for (const negative of [false, true]) {
    const filename = path.join(consumers.get(await fs.realpath(product)), role + '-' + label + '-' + negative + '.mts');
    const original = await fs.readFile(path.join(own, role === 'author' ? 'author-consumer.mts.fixture' : negative ? 'independent-negative.mts.fixture' : 'independent-positive.mts.fixture'), 'utf8');
    const text = role === 'author' && negative ? original.replaceAll('// @ts-expect-error', '// removed directive') : original;
    await write(filename, text);
    const result = await child('types-' + role + '-' + label + '-' + negative, process.execPath, [compiler, '--strict', '--exactOptionalPropertyTypes', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--listFiles', '--typeRoots', path.join(source, 'node_modules/@types'), filename], output);
    const errors = (result.out.toString() + result.err.toString()).split('\n').filter(line => /error TS\d+:/.test(line));
    const locations = errors.map(line => { const match = /\((\d+),\d+\): error TS(\d+):/u.exec(line); return match && [Number(match[1]), match[2]]; });
    const expected = role === 'author' ? seal.authorNegativeDiagnostics : [[3,'2353'],[4,'2322'],[5,'2345']];
    const pass = negative ? result.code === 2 && JSON.stringify(locations) === JSON.stringify(expected) : result.code === 0 && errors.length === 0;
    const declarations = result.out.toString().split('\n').filter(line => line.endsWith('.d.ts') && line.includes('/dist/')); assert.ok(declarations.length);
    const real = await fs.realpath(product), bound = [];
    for (const file of declarations) { const actual = await fs.realpath(file); assert.ok(actual.startsWith(real + '/dist/')); const row = packageRows.find(member => member.path === path.relative(real, actual)); assert.ok(row); assert.equal(sha(await fs.readFile(actual)), row.sha256); bound.push({ file:actual, sha256:row.sha256 }); }
    receipt.types.push({ label, role, negative, pass, errors, declarations:bound }); if (!pass) receipt.failures.push({ label:'types-' + role + '-' + label, negative, errors });
  }
}
async function retained(label, product) {
 const result = await run(label, product, 'retained.mjs', { CASE_IDS: Array.from({length:17},(_,index)=>'C'+String(index+2).padStart(2,'0')).concat('R15').join(',') });
 const lines = result.out.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); let current, total=0, failed=0;
 for(const line of lines) {
   if(line.retainedBegin) { assert.equal(current,undefined); current={name:line.retainedBegin,expected:line.expected,cases:[]}; }
   else if(line.retainedEnd) { assert.ok(current); assert.equal(line.retainedEnd,current.name); assert.equal(current.cases.length,current.expected); assert.equal(current.summary.cases,current.expected); assert.equal(line.exitCode,current.summary.pass===current.expected?0:1); assert.equal(current.summary.pass,current.cases.filter(row=>row.pass).length); assert.ok(current.cases.every(row=>!row.cleanupFailure&&!row.cleanupError&&(row.disposed===undefined||row.disposed===true||row.disposed===row.created)),'retained cleanup unknown'); total+=current.expected; failed+=current.expected-current.summary.pass; receipt.cohorts.push({label:label+'-'+current.name,...current.summary,cases:current.cases});if(current.summary.pass!==current.expected)receipt.failures.push({label:label+'-'+current.name,cases:current.cases.filter(row=>!row.pass)});current=undefined; }
   else if(line.summary){assert.ok(current);current.summary=line.summary;}
   else {assert.ok(current);current.cases.push(line);}
 }
 assert.equal(current,undefined);assert.equal(total,201);assert.equal(result.code,failed?1:0);
}

try {
  await verifyToolClosure(JSON.parse(await fs.readFile(path.join(own, 'TOOL-CENSUS.json'))));
  for (const name of ['home', 'tmp', 'cache', 'source', 'harness']) await fs.mkdir(path.join(output, name));
  for (const name of ['npmrc', 'global-npmrc']) await write(path.join(output, name), '');
  const blobs = await child('development-blobs', '/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'cat-file', '--batch'], repo, { GIT_OPTIONAL_LOCKS: '0', PATH: '/usr/bin' }, manifest.inputs.map(row => row.blob).join('\n') + '\n');
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
      assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, length); const bytes = await fs.readFile(filename); assert.equal(stat.mode & 0o777, mode); assert.equal(bytes.length, length); assert.equal(sha(bytes), digest); await write(path.join(destination, relative), bytes, mode);
    }
    receipt.tools[name] = { origin: tool.origin, rows: tool.originalRows, omittedInternalBinLinks: tool.omittedInternalBinLinks, copied: destination };
    assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'))).version, tool.version);
  }
  for (const copy of seal.fixtureCopies) { const bytes = await fs.readFile(path.join(own, copy.from)); assert.equal(sha(bytes), copy.sha256); await write(path.join(harness, copy.destination), bytes); }
  for (const name of ['resources.mjs','worker-policy.mjs','loader.mjs']) await write(path.join(harness,name),await fs.readFile(path.join(own,name)));
  const sourceBefore = await inventory(path.join(source, 'src'));
  compiler = path.join(source, 'node_modules/typescript/bin/tsc'); npm = path.join(output, 'tools/npm/bin/npm-cli.js');
  const build = await child('production-build-once', process.execPath, [compiler, '-p', path.join(source, 'tsconfig.build.json')], source); assert.equal(build.code, 0, build.out.toString());
  const packed = await child('offline-pack', process.execPath, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output], source); assert.equal(packed.code, 0, packed.err.toString());
  const filename = JSON.parse(packed.out.toString())[0].filename; assert.equal(path.basename(filename), filename); const tarball = path.join(output, filename), archive = await fs.readFile(tarball);
  receipt.package = { file: filename, bytes: archive.length, sha256: sha(archive), manifest: JSON.parse(packed.out.toString())[0] };
  assert.equal(receipt.package.sha256, seal.expectedPackageSha256);
  const tar = gunzipSync(archive, { maxOutputLength: 67108864 }), tarRows = []; let cursor = 0;
  while (cursor + 512 <= tar.length && tar[cursor] !== 0) {
    const header = tar.subarray(cursor, cursor + 512), name = header.subarray(0, 100).toString().split('\0')[0], size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8), mode = Number.parseInt(header.subarray(100, 108).toString().replace(/\0/g, '').trim(), 8), type = header[156];
    assert.ok(name.startsWith('package/') && !name.split('/').some(part => part === '..' || part === 'AGENTS.md')); assert.ok(type === 0 || type === 48); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= tar.length - cursor - 512);
    let checksum = 0; for (let position = 0; position < 512; position++) checksum += position >= 148 && position < 156 ? 32 : header[position]; assert.equal(checksum, Number.parseInt(header.subarray(148, 156).toString().replace(/\0/g, '').trim(), 8));
    tarRows.push({ path: name.slice(8), mode, bytes: size, sha256: sha(tar.subarray(cursor + 512, cursor + 512 + size)) }); cursor += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(tar.subarray(cursor).every(byte => byte === 0)); assert.equal(new Set(tarRows.map(row => row.path)).size, tarRows.length); receipt.package.members = tarRows;
  packageRows = tarRows; assert.equal(tarRows.length, seal.expectedPackageMembers); assert.deepEqual(JSON.parse(await fs.readFile(path.join(source, 'package.json'))).dependencies ?? {}, {});
  const sourceDist = await inventory(path.join(source, 'dist'));
  for (const row of tarRows) { const bytes = await fs.readFile(path.join(source, row.path)); assert.equal(sha(bytes), row.sha256); }
  async function layout(label, product, setup=true) {
    if(setup) await setupConsumer(product,label);
    await cohort(label+'-conditional',product,'conditional.mjs',67);
    await cohort(label+'-novel',product,'novel.mjs',12);
    await retained(label+'-retained',product);
    await types(label,product);
  }
  await layout('source',source);
  const installed=path.join(output,'installed');await write(path.join(installed,'package.json'),'{"private":true,"type":"module"}\n');
  const install=await child('offline-install',process.execPath,[npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--omit=dev',tarball],installed);assert.equal(install.code,0,install.err.toString());
  const installedRoot=path.join(installed,'node_modules/virtual-bash'); const sortedPackage=[...tarRows].sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0);assert.deepEqual(await inventory(installedRoot),sortedPackage);await layout('installed',installedRoot);
  const moved=path.join(output,'moved package');await fs.rename(installed,moved);await assert.rejects(fs.lstat(installed),error=>error.code==='ENOENT');const movedRoot=path.join(moved,'node_modules/virtual-bash');consumers.set(await fs.realpath(movedRoot),await fs.realpath(moved));await layout('moved',movedRoot,false);
  const mutant=path.join(output,'isolated-mutants');await write(path.join(mutant,'package.json'),'{"private":true,"type":"module"}\n');const mutantRoot=path.join(mutant,'node_modules/virtual-bash');for(const row of tarRows)await write(path.join(mutantRoot,row.path),await fs.readFile(path.join(movedRoot,row.path)),row.mode);await setupConsumer(mutantRoot,'mutant');
  for(const mutation of seal.mutants){
    const filename=path.join(mutantRoot,mutation.path),original=await fs.readFile(filename,'utf8'),pattern=new RegExp(mutation.pattern,'g');assert.equal([...original.matchAll(pattern)].length,1,'mutant activation marker '+mutation.id);
    const changed=original.replace(pattern,()=>mutation.replacement);await fs.writeFile(filename,changed);activeMutation={path:mutation.path,sha256:sha(Buffer.from(changed))};
    const result=await run(mutation.id,mutantRoot,mutation.script,mutation.environment);const lines=result.out.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),summary=lines.at(-1)?.summary;assert.ok(summary);assert.equal(summary.cases,1);assert.ok(lines.slice(0,-1).every(row=>!row.cleanupError&&!row.cleanupFailure));const loaded=result.row.loads.some(row=>row.file===filename&&row.sha256===activeMutation.sha256);assert.ok(loaded,'actual mutated module load');
    const detected=result.code===1&&summary.pass===0&&summary.fail===1;receipt.controls.push({name:mutation.id,loaded,activated:true,detected,originalSha256:sha(Buffer.from(original)),mutantSha256:activeMutation.sha256,cases:lines.slice(0,-1)});if(!detected)receipt.failures.push({label:mutation.id,kind:'mutant survived',summary,code:result.code});
    await fs.writeFile(filename,original);activeMutation=undefined;await cohort(mutation.id+'-restored',mutantRoot,mutation.script,1,mutation.environment);assert.deepEqual(await inventory(mutantRoot),sortedPackage);
  }
  for(const kind of ['missing','changed','wrong-root','fallback']){
    const result=await run('binding-'+kind,movedRoot,kind==='fallback'?'fallback.mjs':'novel.mjs',{NOVEL_CASE:'N01'},binding=>{if(kind==='missing')binding.inputs=binding.inputs.filter(row=>row.path!=='index.js');else if(kind==='changed')binding.inputs.find(row=>row.path==='shell/conditional.js').sha256='0'.repeat(64);else if(kind==='wrong-root')binding.root=source;});
    const detected=result.code===1&&/package (outside authenticated compiled root|binding missing member|hash mismatch)/.test(result.err.toString());receipt.controls.push({name:'binding-'+kind,pass:detected,code:result.code});if(!detected)receipt.failures.push({label:'binding-'+kind,code:result.code,error:result.err.toString()});
  }
  assert.deepEqual(await inventory(path.join(source,'src')),sourceBefore);assert.deepEqual(await inventory(path.join(source,'dist')),sourceDist);assert.deepEqual(await inventory(movedRoot),sortedPackage);
  for(const row of manifest.inputs)assert.equal(sha(await fs.readFile(path.join(source,row.path))),row.sha256);
  await verifyToolClosure(JSON.parse(await fs.readFile(path.join(own,'TOOL-CENSUS.json'))));
  receipt.status=receipt.failures.length?'INDEPENDENT_ASSERTION_HOLD':'INDEPENDENT_SCOPED_PASS';
}catch(error){receipt.status='FAILED_OR_INCOMPLETE';receipt.error=String(error?.stack??error);}
receipt.elapsedMs=Date.now()-started;receipt.qualification='Fixed successor only; author67 + independent12 + retained201 per layout; original H02 failures and native40 remain unchanged. No globalHEAD/native/RSS or universal cleanup claim. Internal-loader admissions are not measured Worker exits or OS process counts.';receipt.captureBytes=captured;receipt.scratchWriteBytes=written;receipt.actualScratchBytes=await scratchBytes();assert.ok(Date.now()-campaignStart<seal.bounds.totalSeconds*1000,'total deadline includes final capture');
receipt.cleanup={directChildren:childCount,observedProductWorkers:workerCount,implicitLoaderAdmissions:loaderReservations,allClosed:receipt.children.every(row=>row.closed),signals:receipt.children.flatMap(row=>row.signals),noGlobalDescendantClaim:true};await save();console.log(JSON.stringify({output,status:receipt.status,failures:receipt.failures.length,package:receipt.package?.sha256}));process.exitCode=receipt.status==='INDEPENDENT_SCOPED_PASS'?0:1;

