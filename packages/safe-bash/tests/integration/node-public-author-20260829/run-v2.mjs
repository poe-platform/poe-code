import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { internalLoaderArguments } from './internal-loader-arguments.mjs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash, hashExecutable } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const seal = JSON.parse(await fs.readFile(path.join(own, 'PRESEAL.json')));
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR-v2.json')));
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const manifest = JSON.parse(await fs.readFile(path.join(own, 'SOURCE.json')));
assert.equal(sha(await fs.readFile(path.join(own, 'SOURCE.json'))), executor.source);
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version); assert.equal(await hashExecutable(process.execPath), seal.node.sha256);
const base = JSON.parse(await fs.readFile(path.join(own, 'TOOLS.json')));
const started = Date.now(), output = await fs.mkdtemp(path.join(os.tmpdir(), 'node-public-author-'));
const campaignStart = started;
console.log(JSON.stringify({ output, source: executor.source, candidate: manifest.computedTree }));
const receipt = { schema: 'node-public-author-result-v1', output, source: manifest, executor, status: 'PREPARING', children: [], cohorts: [], types: [], controls: [], failures: [], tools: {}, nativeRuns: 0, privateRuns: 0 };
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
  assert.ok(++childCount <= seal.bounds.children);
  const guarded = args.includes('--loader');
  if (guarded) { loaderReservations++; assert.ok(loaderReservations <= seal.bounds.loaderAdmissions); assert.ok(childCount <= seal.bounds.children && workerCount + loaderReservations + nodeWorkers <= 192); }
  const resourceLog = path.join(output, label + '-resources.jsonl');
  if (guarded) args = internalLoaderArguments(args, { root: await fs.realpath(output), loader: path.join(harness, 'loader.mjs'), bootstrap: path.join(harness, 'resources.mjs'), consumer: args.at(-1) });
  extra = { ...extra, ...(guarded ? { RESOURCE_LOG: resourceLog, RESOURCE_ALLOWANCE: String(Math.min(seal.bounds.regexWorkers - workerCount, 192 - nodeWorkers - workerCount - loaderReservations)) } : {}) }; assert.ok(Date.now() - campaignStart < seal.bounds.totalSeconds * 1000);
  assert.ok(seal.plannedLabels.includes(label) && !receipt.children.some(row => row.label === label), 'unplanned/repeated child role');
  const row = { label, executable, executableSha256: await hashExecutable(executable), args, cwd, signals: [], closed: false };
  assert.equal(row.executableSha256, executable === seal.node.path ? seal.node.sha256 : seal.developmentGit.sha256); assert.ok(executable === seal.node.path || executable === seal.developmentGit.path);
  receipt.children.push(row);
  const stdoutFd = fsSync.openSync(path.join(output, label + '.stdout'), 'wx'), stderrFd = fsSync.openSync(path.join(output, label + '.stderr'), 'wx');
  const out = [], err = []; let size = 0, rescue, spawnError, captureError, spawnErrorPresent = false, captureErrorPresent = false, alarm = false;
  const instance = spawn(executable, args, { cwd, env: { ...environment, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] }); row.pid = instance.pid;
  const closed = new Promise(resolve => instance.once('close', (...values) => resolve(values)));
  instance.once('error', error => { spawnErrorPresent = true; spawnError = error; }); instance.stdin.on('error', () => {});
  const terminate = () => { if (alarm) return; alarm = true; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000); };
  for (const [stream, chunks, descriptor] of [[instance.stdout, out, stdoutFd], [instance.stderr, err, stderrFd]]) stream.on('data', bytes => {
    size += bytes.length; captured += bytes.length;
    try { if (size > seal.bounds.childCaptureBytes || captured > seal.bounds.captureBytes) { terminate(); return; } fsSync.writeSync(descriptor, bytes); chunks.push(Buffer.from(bytes)); }
    catch (error) { captureErrorPresent = true; captureError = error; terminate(); }
  });
  const timer = setTimeout(terminate, Math.min(120000, seal.bounds.totalSeconds * 1000 - (Date.now() - campaignStart)));
  instance.stdin.end(input);
  const [code, signal] = await closed;
  row.closed = true; clearTimeout(timer); clearTimeout(rescue); fsSync.closeSync(stdoutFd); fsSync.closeSync(stderrFd);
  Object.assign(row, { code, signal, alarm, spawnErrorPresent, captureErrorPresent });
  await save();
  assert.ok(!captureErrorPresent, 'capture integrity stop');
  if (guarded) {
    const events = (await fs.readFile(resourceLog, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const births = events.filter(event => event.kind === 'worker-create'), exits = events.filter(event => event.kind === 'worker-exit');
    workerCount += births.length; assert.ok(workerCount <= seal.bounds.regexWorkers); row.resources = { events, births: births.length, exits: exits.length, loaderReservation: 1 };
    assert.ok(childCount <= seal.bounds.children && workerCount + loaderReservations + nodeWorkers <= 192);
    if (!events.some(event => event.kind === 'bootstrap') || births.length !== exits.length || births.some(event => !exits.some(exit => exit.id === event.id))) { row.resourceClosureUnknown = true; }
  }
  const stdout = Buffer.concat(out), stderr = Buffer.concat(err); Object.assign(row, { code, signal, spawnError, alarm, outputBytes: size, stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
  assert.equal(sha(await fs.readFile(path.join(output, label + '.stdout'))), sha(stdout), 'raw stdout capture integrity');
  assert.equal(sha(await fs.readFile(path.join(output, label + '.stderr'))), sha(stderr), 'raw stderr capture integrity');
  await save();
  row.scratchBytesAfterClose = await scratchBytes();
  assert.ok(!row.resourceClosureUnknown && !alarm && !spawnErrorPresent && signal === null && code !== 78, `safety/setup/retirement stop: ${label}`);
  return { row, code, out: stdout, err: stderr };
}
const source = path.join(output, 'source'), harness = path.join(output, 'harness');
let compiler, npm, packageRows;
const consumers = new Map();
async function setupConsumer(product, layout) {
  const directory = layout === 'source' ? path.join(product, '__consumer') : path.dirname(path.dirname(product));
  await fs.mkdir(directory, { recursive: true });
  for (const name of ['public.mjs', 'apply-public.mjs', 'm1a.mjs', 'packs.mjs', 'fixture.json', 'packs.json', 'names.mjs', 'arrays.mjs', 'ARRAY-CASES.json', 'stream-consumer.mjs', 'redirections.mjs', 'redirection-cases.json', 'close-observer.mjs', 'strict.mjs', 'strict-design.json', 'novel.mjs', 'NOVEL-CASES.json']) await write(path.join(directory, name), await fs.readFile(path.join(harness, name)));
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
    const exactErrors = JSON.parse(await fs.readFile(path.join(own, 'TYPE-EXPECTATIONS.json'))).map(suffix => path.relative(output, filename) + suffix);
    const pass = negative ? result.code !== 0 && JSON.stringify(errors) === JSON.stringify(exactErrors) : result.code === 0 && errors.length === 0;
    const declarations = result.out.toString().split('\n').filter(line => line.endsWith('.d.ts') && line.includes('/dist/'));
    assert.ok(declarations.length > 0);
    const real = await fs.realpath(product), bound = [];
    for (const file of declarations) { const actual = await fs.realpath(file); assert.ok(actual.startsWith(real + '/dist/')); const row = packageRows.find(row => row.path === path.relative(real, actual)); assert.ok(row); assert.equal(sha(await fs.readFile(actual)), row.sha256); bound.push({ file: actual, sha256: row.sha256 }); }
    receipt.types.push({ label, negative, pass, errors, declarations: bound }); if (!pass) receipt.failures.push({ label: `types-${label}`, negative, errors });
  }
}
let nodeWorkers=0,guestEntries=0;
const nodeFixtures=path.join(harness,'node');
async function setupNodeFixtures(){
 const from=path.join(repo,'tests/commands/node-author-20260829/validation-v2/author-v5');
 const inherited=JSON.parse(gunzipSync(Buffer.from((await fs.readFile(path.join(from,'INPUTS-v1.json.gz.base64'),'utf8')).trim(),'base64'),{maxOutputLength:16777216}));
 assert.equal(inherited.engine.length,96);
 for(const row of inherited.engine){assert.ok(row.target.startsWith('compiled/engine/')&&!row.target.split('/').includes('..')&&!row.target.endsWith('/AGENTS.md'));const body=Buffer.from(row.body,'base64');assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);await write(path.join(nodeFixtures,row.target.slice('compiled/'.length)),body);}
 const maps=[['focused-v5.mjs','tests/commands/node-independent-20260829/actual-review-v1/capsule-v3/focused-v5.mjs'],['workers-v5.mjs','tests/commands/node-independent-20260829/actual-review-v1/capsule-v3/workers-v5.mjs'],...['engine-adapter-v1.mjs','engine-adapter-noise-v1.mjs'].map(name=>[name,'tests/commands/node-author-20260829/validation-v2/author-v5/'+name]),...['public-node.mjs','node-batch.mjs','node-policy.mjs','node-load-guard.mjs'].map(name=>[name,'tests/integration/node-public-author-20260829/'+name])];
 for(const [name,origin]of maps){const bytes=await fs.readFile(path.join(repo,origin));const bound=executor.files.find(row=>row.path===origin);assert.ok(bound);assert.equal(sha(bytes),bound.sha256);await write(path.join(nodeFixtures,name),bytes);}
 receipt.engine={entries:inherited.engine.map(({body,...row})=>row),productDependency:false,qualification:'PUBLIC95 unchanged emitted engine plus package metadata, test-only explicitly supplied adapter; no private read or engine build'};
}
async function nodeBatch(label,product,role,ids,expected,expectedFailure=false){
 const root=await fs.realpath(product),moduleRoot=path.join(root,'dist');
 const realRoot=path.join(output,'node-real',label);await fs.mkdir(realRoot,{recursive:true});
 const files=[];
 for(const directory of [moduleRoot,nodeFixtures])for(const row of await inventory(directory))if(row.path.endsWith('.js')||row.path.endsWith('.mjs')){const filename=path.join(directory,row.path);const body=await fs.readFile(filename,'utf8');const builtins=[...new Set([...body.matchAll(/(?:from\s*|import\s*)["'](node:[^"']+)["']/gu)].map(match=>match[1]))].sort();files.push({...row,path:filename,builtins});}
 const manifestFile=path.join(harness,'load-manifest.json');await fs.writeFile(manifestFile,JSON.stringify({files,aliases:{'virtual-bash':path.join(moduleRoot,'index.js'),'virtual-bash/commands/node':path.join(moduleRoot,'commands/node/index.js')}}));
 const log=path.join(output,label+'-node-resources.jsonl');await write(log,'');
 const maximum=role==='focused'?0:role==='worker'?ids.length:Math.min(24,seal.bounds.nodeWorkers-nodeWorkers);
 assert.ok(maximum>=0);const policy={log,maximum,workerEntry:path.join(moduleRoot,'commands/node/worker-main.js'),adapters:['engine-adapter-v1.mjs','engine-adapter-noise-v1.mjs'].map(name=>new URL('file://'+path.join(nodeFixtures,name)).href)};
 await fs.writeFile(path.join(harness,'node-policy.json'),JSON.stringify(policy));
 const input={role,ids,moduleRoot,packageRoot:root,adapter:path.join(nodeFixtures,'engine-adapter-v1.mjs'),realRoot};const inputFile=path.join(output,label+'-input.json');await write(inputFile,JSON.stringify(input));
 const bindingBefore=await inventory(moduleRoot);
 const result=await child(label,process.execPath,['--experimental-permission','--allow-fs-read='+output,'--allow-fs-write='+output,'--allow-worker','--import',path.join(nodeFixtures,'node-policy.mjs'),'--import',path.join(nodeFixtures,'node-load-guard.mjs'),path.join(nodeFixtures,'node-batch.mjs'),inputFile],root);
 const resourceRows=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const births=resourceRows.filter(row=>row.kind==='node-worker-create'),exits=resourceRows.filter(row=>row.kind==='node-worker-exit');
 nodeWorkers+=births.length;assert.ok(nodeWorkers<=seal.bounds.nodeWorkers&&nodeWorkers+workerCount+loaderReservations<=192);assert.ok(resourceRows.some(row=>row.kind==='node-policy-bootstrap'));
 assert.equal(births.length,exits.length,'Node Worker retirement');for(const birth of births)assert.ok(exits.some(exit=>exit.id===birth.id));
 const rows=result.out.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));const summary=rows.pop();assert.equal(summary.role,'node-batch-summary');assert.equal(summary.cases,expected);assert.equal(rows.length,expected);assert.ok(summary.clean&&summary.unhandled.length===0,'Node cleanup failure');assert.equal(result.code,summary.fail?1:0);
 assert.deepEqual(rows.map(row=>row.id),role==='focused'?seal.moduleFocusedIds:ids);
 assert.ok(rows.every(row=>row.clean!==false));
 const entries=rows.reduce((sum,row)=>sum+(row.guestEntries??0)+(row.facts?.W28?.guestEntries??0)+(row.facts?.W29?.guestEntries??0),0);guestEntries+=entries;assert.ok(guestEntries<=192);
 await fs.writeFile(path.join(output,label+'-loads.jsonl'),result.err.toString().split('\n').filter(line=>line.startsWith('@@NODE_LOAD ')).join('\n')+'\n');
 assert.deepEqual(await inventory(moduleRoot),bindingBefore);
 receipt.nodeCohorts??=[];receipt.nodeCohorts.push({label,role,...summary,rows,resources:resourceRows,nodeWorkers:births.length,guestEntries:entries,loadManifestSha256:sha(await fs.readFile(manifestFile))});
 if(summary.fail&&!expectedFailure)receipt.failures.push({label,cases:rows.filter(row=>!row.pass)});
 return {result,summary,rows};
}
async function nodeLayout(label,product){
 await nodeBatch(label+'-node-focused',product,'focused',[],34);
 for(let offset=0;offset<27;offset+=9){const ids=seal.moduleWorkerIds.slice(offset,offset+9);await nodeBatch(label+'-node-module-'+offset,product,'worker',ids,ids.length);}
 for(let offset=0;offset<24;offset+=6){const ids=seal.publicIds.slice(offset,offset+6);await nodeBatch(label+'-node-public-'+offset,product,'public',ids,ids.length);}
 await nodeTypes(label,product);
}
async function nodeTypes(label,product){
 for(const negative of [false,true]){
  const filename=path.join(consumers.get(await fs.realpath(product)),`node-consumer-${label}-${negative}.mts`);await write(filename,await fs.readFile(path.join(own,negative?'types-negative.mts.fixture':'types-positive.mts.fixture')));
  const result=await child(`node-types-${label}-${negative}`,process.execPath,[compiler,'--strict','--exactOptionalPropertyTypes','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--skipLibCheck','--pretty','false','--listFiles','--typeRoots',path.join(source,'node_modules/@types'),filename],output);
  const errors=(result.out.toString()+result.err.toString()).split('\n').filter(line=>/error TS\d+:/.test(line));const intended=negative?[{line:3,code:2345,contains:"Argument of type '{}' is not assignable to parameter of type 'NodeCommandsOptions'"},{line:4,code:2322,contains:"Type 'string' is not assignable to type 'boolean'"},{line:5,code:2322,contains:"Type 'number' is not assignable to type 'boolean'"},{line:6,code:2353,contains:"'limits' does not exist in type 'NodeCommandsOptions'"},{line:7,code:2305,contains:"no exported member 'NodeOwner'"},{line:8,code:2307,contains:"Cannot find module 'virtual-bash/commands/node/host'"}]:[];
  const pass=negative?result.code!==0&&errors.length===6&&intended.every((item,index)=>errors[index].includes(`(${item.line},`)&&errors[index].includes(`error TS${item.code}:`)&&errors[index].includes(item.contains)):result.code===0&&errors.length===0;
  const declarations=result.out.toString().split('\n').filter(line=>line.endsWith('.d.ts')&&line.includes('/dist/'));assert.ok(declarations.length>0);const bound=[];for(const filename of declarations){const actual=await fs.realpath(filename);assert.ok(actual.startsWith(product+'/dist/'));const row=packageRows.find(item=>item.path===path.relative(product,actual));assert.ok(row);assert.equal(sha(await fs.readFile(actual)),row.sha256);bound.push({path:actual,sha256:row.sha256});}
  receipt.nodeTypes??=[];receipt.nodeTypes.push({label,negative,pass,errors,code:result.code,declarations:bound});if(!pass)receipt.failures.push({label:`node-types-${label}-${negative}`,errors});
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
    assert.equal(sha(Buffer.from(JSON.stringify(tool.originalRows))), {"node":{"origin":"/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node","version":"v22.22.2","sha256":"5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011"},"typescript":{"origin":"/Users/kjopek/Workspace/safe-bash/node_modules/typescript","version":"5.9.3","inventorySha256":"795fdf528d284319ca578873e6a6f0d145860022c0fe8ea2231bc608889e9b41"},"npm":{"origin":"/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm","version":"10.9.7","inventorySha256":"76ddb347ab8dce68f6ce84513b57e6489eb5f4a6492a87748db863ef11f9be55"},"@types/node":{"origin":"/Users/kjopek/Workspace/safe-bash/node_modules/@types/node","version":"22.20.1","inventorySha256":"e113c1687ab6020f64ac29d870556eea9048cc09c7f07720f1c31a83173d3bae"},"undici-types":{"origin":"/Users/kjopek/Workspace/safe-bash/node_modules/undici-types","version":"6.21.0","inventorySha256":"e0f1f3f618db2ed230f15d2f74810541aeced3f5334a5167a8cc469a5b05f986"}}[name].inventorySha256);
    for (const [relative, mode, length, digest] of tool.originalRows) {
      const filename = path.join(tool.origin, relative), stat = await fs.lstat(filename);
      if (mode === 'SYMLINK') { assert.ok(stat.isSymbolicLink()); assert.equal(await fs.readlink(filename), length); assert.ok(tool.omittedInternalBinLinks.some(([name, target]) => name === relative && target === length)); const target = await fs.realpath(filename), real = await fs.realpath(tool.origin); assert.ok(target.startsWith(real + path.sep)); const row = tool.originalRows.find(row => row[0] === path.relative(real, target)); assert.ok(row && row[1] !== 'SYMLINK'); assert.equal(sha(await fs.readFile(target)), row[3]); continue; }
      assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, length); const bytes = await fs.readFile(filename); assert.equal(stat.mode & 0o777, mode); assert.equal(bytes.length, length); assert.equal(sha(bytes), digest); await write(path.join(destination, relative), bytes, mode);
    }
    receipt.tools[name] = { origin: tool.origin, rows: tool.originalRows, omittedInternalBinLinks: tool.omittedInternalBinLinks, copied: destination };
    assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'))).version, tool.version);
  }
  const harnessMap = [
    ['fixture.json', 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'], ['packs.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json'],
    ...['public.mjs', 'apply-public.mjs', 'm1a.mjs', 'packs.mjs', 'resources.mjs', 'names.mjs', 'loader.mjs', 'consumer.ts.fixture'].map(name => [name, ['resources.mjs', 'loader.mjs'].includes(name) ? 'tests/integration/git-public-independent-20260829/successor-bindings-v2/' + name : 'tests/integration/git-public-20260829/' + name]),
    ['arrays.mjs', 'tests/integration/coherent78-arrays-author-20260828/arrays.mjs'], ['ARRAY-CASES.json', 'tests/integration/coherent78-arrays-author-20260828/ARRAY-CASES.json'],
    ...['probe.mjs', 'names.mjs', 'CASES.json', 'CASES-v2-overlay.json'].map(name => ['coherence/' + name, 'tests/integration/coherent78-shell-author-20260828/' + name]),
    ['stream-consumer.mjs', 'tests/plugins/stream-five-public/consumer.mjs'],
  ];
  harnessMap.push(['redirections.mjs', 'tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs'], ['redirection-cases.json', 'tests/compatibility/bash-redirection-author-20260829/CASES.json'], ['close-observer.mjs', 'tests/compatibility/bash-redirection-author-20260829/close-observer.mjs'], ['strict.mjs', 'tests/compatibility/bash-strict-mode-author-20260829/strict.mjs'], ['strict-design.json', 'tests/compatibility/bash-strict-mode-design-20260829/CASES.json']);
  harnessMap.push(['worker-policy.mjs', 'tests/integration/git-public-independent-20260829/successor-bindings-v2/worker-policy.mjs'], ['novel.mjs', 'tests/compatibility/bash-strict-mode-independent-20260829/novel.mjs'], ['NOVEL-CASES.json', 'tests/compatibility/bash-strict-mode-independent-20260829/NOVEL-CASES.json']);
  for (const [destination, from] of harnessMap) { const row = executor.files.find(row => row.path === from), bytes = await fs.readFile(path.join(repo, from)); assert.equal(sha(bytes), row.sha256); await write(path.join(harness, destination), bytes); }
  await setupNodeFixtures();
  const sourceBefore = await inventory(path.join(source, 'src'));
  compiler = path.join(source, 'node_modules/typescript/bin/tsc'); npm = path.join(output, 'tools/npm/bin/npm-cli.js');
  const build = await child('production-build-once', process.execPath, [compiler, '-p', path.join(source, 'tsconfig.build.json')], source); assert.equal(build.code, 0, build.out.toString());
  const packed = await child('offline-pack', process.execPath, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output], source); assert.equal(packed.code, 0, packed.err.toString());
  const filename = JSON.parse(packed.out.toString())[0].filename; assert.equal(path.basename(filename), filename); const tarball = path.join(output, filename), archive = await fs.readFile(tarball);
  receipt.package = { file: filename, bytes: archive.length, sha256: sha(archive), manifest: JSON.parse(packed.out.toString())[0] };
  receipt.package.acceptedBaseSha256 = seal.acceptedBasePackageSha256; receipt.package.isNewComposition = true;
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
  const coherenceIds = Array.from({ length: 17 }, (_, index) => 'C' + String(index + 2).padStart(2, '0')).concat('R15').join(',');
  async function layout(label, product) {
    await setupConsumer(product, label); await cohort(label + '-public', product, 'public.mjs', seal.cohorts.gitPublic); await cohort(label + '-apply', product, 'apply-public.mjs', 28); await cohort(label + '-redirections-v2', product, 'redirections.mjs', 48); await cohort(label + '-strict', product, 'strict.mjs', 50); await cohort(label + '-novel', product, 'novel.mjs', 16); await cohort(label + '-arrays', product, 'arrays.mjs', 12); await cohort(label + '-coherence', product, 'coherence/probe.mjs', 18, { CASE_IDS: coherenceIds }); await types(label, product); await nodeLayout(label, product);
  }
  await layout('source', source);
  const installed = path.join(output, 'installed'); await write(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('offline-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], installed); assert.equal(install.code, 0, install.err.toString());
  const installedRoot = path.join(installed, 'node_modules/virtual-bash'); assert.deepEqual(await inventory(installedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  await layout('installed', installedRoot);
  const moved = path.join(output, 'moved package'); await fs.rename(installed, moved); const movedRoot = path.join(moved, 'node_modules/virtual-bash');
  consumers.set(await fs.realpath(movedRoot), await fs.realpath(moved));
  await cohort('moved-public', movedRoot, 'public.mjs', seal.cohorts.gitPublic); await cohort('moved-apply', movedRoot, 'apply-public.mjs', 28); await cohort('moved-redirections-v2', movedRoot, 'redirections.mjs', 48); await cohort('moved-strict', movedRoot, 'strict.mjs', 50); await cohort('moved-novel', movedRoot, 'novel.mjs', 16); await cohort('moved-arrays', movedRoot, 'arrays.mjs', 12); await cohort('moved-coherence', movedRoot, 'coherence/probe.mjs', 18, { CASE_IDS: coherenceIds }); await types('moved', movedRoot); await nodeLayout('moved', movedRoot);
  const mutant = path.join(output, 'operator-mutants'); await write(path.join(mutant, 'package.json'), '{"private":true,"type":"module"}\n');
  const mutantRoot = path.join(mutant, 'node_modules/virtual-bash');
  for (const row of tarRows) await write(path.join(mutantRoot, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode);
  await setupConsumer(mutantRoot, 'mutant');
  const mutations = [
    { id: 'node-export-missing', file: 'index.js', before: 'export * from "./commands/node/index.js";', after: '', case: 'P02' },
    { id: 'node-collision-missing', file: 'commands/node/index.js', before: 'if (!replace && host.commands.has("node"))', after: 'if (false && host.commands.has("node"))', case: 'P07' },
    { id: 'node-definition-missing', file: 'commands/node/index.js', before: 'Object.freeze([definition])', after: 'Object.freeze([])', case: 'P03' },
  ];
  for (const mutation of mutations) {
    const filename = path.join(mutantRoot, 'dist', mutation.file), original = await fs.readFile(filename, 'utf8');
    assert.equal(original.split(mutation.before).length, 2); await fs.writeFile(filename, original.replace(mutation.before, mutation.after));
    const observed = await nodeBatch(mutation.id, mutantRoot, 'public', [mutation.case], 1, true);
    const detected = observed.result.code === 1 && observed.rows[0].pass === false;
    receipt.controls.push({ name: mutation.id, detected, originalSha256: sha(Buffer.from(original)), mutantSha256: sha(await fs.readFile(filename)) }); if (!detected) receipt.failures.push({label:mutation.id});
    await fs.writeFile(filename, original); await nodeBatch(mutation.id + '-restored', mutantRoot, 'public', [mutation.case], 1);
    assert.equal(sha(await fs.readFile(filename)), tarRows.find(row => row.path === 'dist/' + mutation.file).sha256);
  }
  for (const kind of ['missing', 'changed']) {
    const result = await run('binding-' + kind, movedRoot, 'strict.mjs', {}, binding => {
      if (kind === 'missing') binding.inputs = binding.inputs.filter(row => row.path !== 'index.js');
      else binding.inputs.find(row => row.path === 'shell/parser.js').sha256 = '0'.repeat(64);
    });
    assert.equal(result.code, 1); assert.match(result.err.toString(), /package (binding missing member|hash mismatch)/);
    receipt.controls.push({ name: 'binding-' + kind, pass: true });
  }
  assert.deepEqual(await inventory(mutantRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  assert.deepEqual(await inventory(path.join(source, 'src')), sourceBefore); assert.deepEqual(await inventory(path.join(source, 'dist')), sourceDist); assert.deepEqual(await inventory(movedRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const row of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(source, row.path))), row.sha256);
  receipt.status = receipt.failures.length ? 'AUTHOR_ASSERTION_FAILURES' : 'AUTHOR_SCOPED_PASS';
} catch (error) { receipt.status = 'FAILED_OR_INCOMPLETE'; receipt.error = String(error?.stack ?? error); }
receipt.elapsedMs = Date.now() - started;
receipt.qualification = 'AUTHOR public Node opt-in only on accepted26215b99 plus accepted a2 module; default80 unchanged. Module qualifications, Unit2 eleven OPEN identities and historical failures retained. No full Node/Bash/RSS/alljobs/native/independent-public acceptance.'; receipt.captureBytes = captured; receipt.scratchWriteBytes = written;
receipt.actualScratchBytes = await scratchBytes();
for (const row of executor.files) { const bytes = await fs.readFile(path.join(repo, row.path)); assert.equal(sha(bytes), row.sha256, 'executor postguard ' + row.path); }
receipt.cleanup = { directChildren: childCount, observedRegexWorkers: workerCount, observedNodeWorkers: nodeWorkers, observedGuestEntries: guestEntries, implicitLoaderAdmissions: loaderReservations, knownDirectOsProcesses: childCount, totalObservedWorkerCategories: nodeWorkers + workerCount + loaderReservations, allClosed: receipt.children.every(row => row.closed), signals: receipt.children.flatMap(row => row.signals), noGlobalDescendantClaim: true };
await save(); console.log(JSON.stringify({ output, status: receipt.status, failures: receipt.failures.length, package: receipt.package?.sha256 }));
process.exitCode = receipt.status === 'AUTHOR_SCOPED_PASS' ? 0 : 1;
