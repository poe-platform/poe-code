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
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL-tail.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR-tail.json')));
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
const appBaselines = new Map();
const generatedTypeFiles = new Map();
async function validateApp(product) {
  const real = await fs.realpath(product), directory = consumers.get(real);
  const baseline = appBaselines.get(real); assert.ok(baseline);
  const generated = generatedTypeFiles.get(real) ?? [];
  const expected = [...baseline, ...generated].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const actual = await inventory(directory); assert.deepEqual(actual, expected, 'complete application closure drift');
  (receipt.appCensuses ??= []).push({ root: real, entries: actual.length, sha256: sha(Buffer.from(JSON.stringify(actual))), exact: true });
}
async function setupConsumer(product, layout) {
  const directory = layout === 'source' ? path.join(product, '__consumer') : path.dirname(path.dirname(product));
  await fs.mkdir(directory, { recursive: true });
  for (const row of seal.fixtureCopies) await write(path.join(directory, row.destination), await fs.readFile(path.join(harness, row.destination)));
  const real = await fs.realpath(product); consumers.set(real, await fs.realpath(directory));
  appBaselines.set(real, await inventory(directory)); generatedTypeFiles.set(real, []); return directory;
}
async function run(label, product, script, extras = {}, bindingMutation) {
  const real = await fs.realpath(product), directory = consumers.get(real); assert.ok(directory);
  if (!activeMutation) await validateApp(product);
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
  result.row.loads = traces; if (!activeMutation) await validateApp(product); return result;
}
async function cohort(label, product, script, expected, extras = {}) {
  const result = await run(label, product, script, extras);
  const lines = result.out.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); const summary = lines.at(-1)?.summary; assert.ok(summary); assert.equal(summary.cases, expected); assert.equal(result.code, summary.pass === expected ? 0 : 1);
  const cases = lines.slice(0, -1); assert.equal(cases.length, expected);
  const expectedIds = extras.CONDITIONAL_CASE ? [extras.CONDITIONAL_CASE] : extras.NOVEL_CASE ? [extras.NOVEL_CASE] : script === 'conditional.mjs' ? seal.identities.conditional : seal.identities.novel;
  assert.deepEqual(cases.map(row => row.id), expectedIds, 'exact frozen cohort identity/order');
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
    const original = await fs.readFile(path.join(own, role === 'author' ? 'author-consumer.mts.fixture' : negative ? 'independent-negative.mts.fixture' : 'independent-positive-v2.mts.fixture'), 'utf8');
    const text = role === 'author' && negative ? original.replaceAll('// @ts-expect-error', '// removed directive') : original;
    await write(filename, text);
    const realProduct = await fs.realpath(product);
    generatedTypeFiles.get(realProduct).push({ path: path.relative(consumers.get(realProduct), filename), mode: 420, bytes: Buffer.byteLength(text), sha256: sha(Buffer.from(text)) });
    const result = await child('types-' + role + '-' + label + '-' + negative, process.execPath, [compiler, '--strict', '--exactOptionalPropertyTypes', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--listFiles', '--typeRoots', path.join(source, 'node_modules/@types'), filename], output);
    const errors = (result.out.toString() + result.err.toString()).split('\n').filter(line => /error TS\d+:/.test(line));
    const locations = errors.map(line => { const match = /\((\d+),\d+\): error TS(\d+):/u.exec(line); return match && [Number(match[1]), match[2]]; });
    const expected = role === 'author' ? seal.authorNegativeDiagnostics : [[3,'2353'],[4,'2322'],[5,'2345']];
    const pass = negative ? result.code === 2 && JSON.stringify(locations) === JSON.stringify(expected) : result.code === 0 && errors.length === 0;
    const declarations = result.out.toString().split('\n').filter(line => line.endsWith('.d.ts') && line.includes('/dist/')); assert.ok(declarations.length);
    const real = await fs.realpath(product), bound = [];
    for (const file of declarations) { const actual = await fs.realpath(file); assert.ok(actual.startsWith(real + '/dist/')); const row = packageRows.find(member => member.path === path.relative(real, actual)); assert.ok(row); assert.equal(sha(await fs.readFile(actual)), row.sha256); bound.push({ file:actual, sha256:row.sha256 }); }
    receipt.types.push({ label, role, negative, pass, errors, declarations:bound }); if (!pass) receipt.failures.push({ label:'types-' + role + '-' + label, negative, errors });
    await validateApp(product);
  }
}
async function retained(label, product) {
 const result = await run(label, product, 'retained.mjs', { CASE_IDS: Array.from({length:17},(_,index)=>'C'+String(index+2).padStart(2,'0')).concat('R15').join(',') });
 const lines = result.out.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); let current, total=0, failed=0;
 for(const line of lines) {
   if(line.retainedBegin) { assert.equal(current,undefined); current={name:line.retainedBegin,expected:line.expected,cases:[]}; }
   else if(line.retainedEnd) { assert.ok(current); assert.equal(line.retainedEnd,current.name); assert.equal(current.cases.length,current.expected); assert.deepEqual(current.cases.map(row=>row.id),seal.identities.retained[current.name],'retained identity/order'); assert.equal(current.summary.cases,current.expected); assert.equal(line.exitCode,current.summary.pass===current.expected?0:1); assert.equal(current.summary.pass,current.cases.filter(row=>row.pass).length); assert.ok(current.cases.every(row=>!row.cleanupFailure&&!row.cleanupError&&(row.disposed===undefined||row.disposed===true||row.disposed===row.created)),'retained cleanup unknown'); total+=current.expected; failed+=current.expected-current.summary.pass; receipt.cohorts.push({label:label+'-'+current.name,...current.summary,cases:current.cases});if(current.summary.pass!==current.expected)receipt.failures.push({label:label+'-'+current.name,cases:current.cases.filter(row=>!row.pass)});current=undefined; }
   else if(line.summary){assert.ok(current);current.summary=line.summary;}
   else {assert.ok(current);current.cases.push(line);}
 }
 assert.equal(current,undefined);assert.equal(total,201);assert.equal(result.code,failed?1:0);
}

try {
  await verifyToolClosure(JSON.parse(await fs.readFile(path.join(own, 'TOOL-CENSUS.json'))));
  const planBytes=await fs.readFile(path.join(own,'TAIL-PLAN.json')),plan=JSON.parse(planBytes);
  const prior=plan.prior.attempt2.root, priorRecordBytes=await fs.readFile(path.join(prior,'scratch/RESULT.json'));
  assert.equal(sha(priorRecordBytes),plan.prior.attempt2.result); const priorRecord=JSON.parse(priorRecordBytes);
  assert.equal(priorRecord.status,'INDEPENDENT_ASSERTION_HOLD'); assert.ok(priorRecord.cleanup.allClosed); assert.equal(priorRecord.cleanup.signals.length,0);
  const priorScratch=path.join(prior,'scratch'), priorSource=path.join(priorScratch,'source'), priorMoved=path.join(priorScratch,'moved package/node_modules/virtual-bash'), priorRestored=path.join(priorScratch,'isolated-mutants/node_modules/virtual-bash');
  const tarball=path.join(output,priorRecord.package.file), archive=await fs.readFile(path.join(priorScratch,priorRecord.package.file));
  assert.equal(sha(archive),seal.expectedPackageSha256); assert.equal(archive.length,priorRecord.package.bytes); await write(tarball,archive);
  packageRows=priorRecord.package.members;assert.equal(packageRows.length,954);assert.equal(new Set(packageRows.map(row=>row.path)).size,954);
  const sortedPackage=[...packageRows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(const root of [priorMoved,priorRestored])assert.deepEqual(await inventory(root),sortedPackage);
  for(const name of ['home','tmp','cache','source','harness'])await fs.mkdir(path.join(output,name));
  for(const name of ['npmrc','global-npmrc'])await write(path.join(output,name),'');
  const merged=new Map();for(const row of manifest.inputs)merged.set(row.path,{...row,mode:Number.parseInt(row.mode,8)&511});
  for(const row of packageRows){const existing=merged.get(row.path);if(existing){assert.equal(existing.sha256,row.sha256);assert.equal(existing.bytes,row.bytes);assert.equal(existing.mode,row.mode);}else merged.set(row.path,row);}
  for(const row of merged.values()){assert.ok(!row.path.startsWith('/')&&!row.path.split('/').some(p=>p==='..'||p==='AGENTS.md'));const filename=path.join(priorSource,row.path),stat=await fs.lstat(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(await fs.realpath(filename),filename);assert.equal(stat.mode&511,row.mode);const bytes=await fs.readFile(filename);assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);await write(path.join(source,row.path),bytes,row.mode);}
  const originalSource=await inventory(source);receipt.sourceExistingEmits={root:priorSource,entries:originalSource.length,sha256:sha(Buffer.from(JSON.stringify(originalSource))),compilerRuns:0};
  for(const name of ['npm']){
    const tool=base.tools[name],destination=path.join(output,'tools/npm');assert.equal(sha(Buffer.from(JSON.stringify(tool.originalRows))),manifest.toolBindings[name].inventorySha256);
    for(const [relative,mode,length,digest]of tool.originalRows){const filename=path.join(tool.origin,relative),stat=await fs.lstat(filename);if(mode==='SYMLINK'){assert.ok(stat.isSymbolicLink());assert.equal(await fs.readlink(filename),length);assert.ok(tool.omittedInternalBinLinks.some(([name,target])=>name===relative&&target===length));const target=await fs.realpath(filename),real=await fs.realpath(tool.origin);assert.ok(target.startsWith(real+path.sep));const row=tool.originalRows.find(row=>row[0]===path.relative(real,target));assert.ok(row&&row[1]!=='SYMLINK');assert.equal(sha(await fs.readFile(target)),row[3]);continue;}assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,length);assert.equal(stat.mode&511,mode);const bytes=await fs.readFile(filename);assert.equal(sha(bytes),digest);await write(path.join(destination,relative),bytes,mode);}
    receipt.tools[name]={origin:tool.origin,rows:tool.originalRows,omittedInternalBinLinks:tool.omittedInternalBinLinks,copied:destination};assert.equal(JSON.parse(await fs.readFile(path.join(destination,'package.json'))).version,tool.version);
  }
  npm=path.join(output,'tools/npm/bin/npm-cli.js');
  for(const copy of seal.fixtureCopies){const bytes=await fs.readFile(path.join(own,copy.from));assert.equal(sha(bytes),copy.sha256);await write(path.join(harness,copy.destination),bytes);}
  for(const name of ['resources.mjs','worker-policy.mjs','loader.mjs'])await write(path.join(harness,name),await fs.readFile(path.join(own,name)));
  receipt.package={file:priorRecord.package.file,bytes:archive.length,sha256:sha(archive),members:packageRows,reused:true};
  async function affected(label,product,ids){const extras=ids.length===1?{NOVEL_CASE:ids[0]}:{NOVEL_CASES:ids.join(',')};const result=await run(label,product,'novel.mjs',extras);const lines=result.out.toString().trim().split('\n').filter(Boolean).map(JSON.parse);const summary=lines.at(-1)?.summary,cases=lines.slice(0,-1);assert.ok(summary);assert.deepEqual(cases.map(row=>row.id),ids);assert.equal(summary.cases,ids.length);assert.equal(summary.pass,cases.filter(row=>row.pass).length);assert.equal(result.code,summary.fail?1:0);assert.ok(cases.every(row=>row.disposed===true&&!row.cleanupError));receipt.cohorts.push({label,...summary,cases});if(summary.fail)receipt.failures.push({label,cases:cases.filter(row=>!row.pass)});}
  await setupConsumer(source,'source');await affected('source-affected',source,['N01','N10','N11']);
  const installed=path.join(output,'installed');await write(path.join(installed,'package.json'),'{"private":true,"type":"module"}\n');
  const install=await child('offline-install-tail',process.execPath,[npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--omit=dev',tarball],installed);assert.equal(install.code,0,install.err.toString());
  const installedRoot=path.join(installed,'node_modules/virtual-bash');assert.deepEqual(await inventory(installedRoot),sortedPackage);await setupConsumer(installedRoot,'installed');await affected('installed-affected',installedRoot,['N01','N10','N11']);
  const oldInstalledReal=await fs.realpath(installedRoot),moved=path.join(output,'moved package');await fs.rename(installed,moved);await assert.rejects(fs.lstat(installed),error=>error.code==='ENOENT');
  const movedRoot=path.join(moved,'node_modules/virtual-bash'),movedReal=await fs.realpath(movedRoot);consumers.set(movedReal,await fs.realpath(moved));appBaselines.set(movedReal,appBaselines.get(oldInstalledReal));generatedTypeFiles.set(movedReal,[]);await affected('moved-affected',movedRoot,['N01','N10','N11']);
  const restored=path.join(output,'restored-copy');await write(path.join(restored,'package.json'),'{"private":true,"type":"module"}\n');const restoredRoot=path.join(restored,'node_modules/virtual-bash');
  for(const row of packageRows){const bytes=await fs.readFile(path.join(priorRestored,row.path));assert.equal(sha(bytes),row.sha256);await write(path.join(restoredRoot,row.path),bytes,row.mode);}
  await setupConsumer(restoredRoot,'restored');await affected('M04-restored-v3',restoredRoot,['N10']);
  for(const root of [priorMoved,priorRestored,movedRoot,restoredRoot])assert.deepEqual(await inventory(root),sortedPackage);
  for(const row of merged.values()){assert.equal(sha(await fs.readFile(path.join(priorSource,row.path))),row.sha256);assert.equal(sha(await fs.readFile(path.join(source,row.path))),row.sha256);}
  assert.equal(sha(await fs.readFile(path.join(priorScratch,priorRecord.package.file))),seal.expectedPackageSha256);await verifyToolClosure(JSON.parse(await fs.readFile(path.join(own,'TOOL-CENSUS.json'))));
  receipt.status=receipt.failures.length?'INDEPENDENT_ASSERTION_HOLD':'INDEPENDENT_AFFECTED_TAIL_PASS';
}catch(error){receipt.status='FAILED_OR_INCOMPLETE';receipt.error=String(error?.stack??error);}
receipt.elapsedMs=Date.now()-started;receipt.captureBytes=captured;receipt.scratchWriteBytes=written;receipt.actualScratchBytes=await scratchBytes();receipt.qualification='Versioned reader correction only: nine affected layout outcomes plus M04 restored-package-copy companion; original failures/M06 nonactivation unchanged. No new build/compiler/native; same original activation deadline.';assert.ok(Date.now()-campaignStart<seal.bounds.totalSeconds*1000);
receipt.cleanup={directChildren:childCount,observedProductWorkers:workerCount,implicitLoaderAdmissions:loaderReservations,allClosed:receipt.children.every(row=>row.closed),signals:receipt.children.flatMap(row=>row.signals),noGlobalDescendantClaim:true};await save();console.log(JSON.stringify({output,status:receipt.status,failures:receipt.failures.length,package:receipt.package?.sha256}));process.exitCode=receipt.status==='INDEPENDENT_AFFECTED_TAIL_PASS'?0:1;

