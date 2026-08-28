import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, readlinkSync, realpathSync, chmodSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const start = process.hrtime.bigint(), elapsed = () => Number(process.hrtime.bigint() - start) / 1e6;
const hash = data => createHash('sha256').update(data).digest('hex');
const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
const tools = JSON.parse(readFileSync(join(root, 'TOOLS.json')));
const members = JSON.parse(readFileSync(join(root, 'PACKAGE-MEMBERS.json')));
const inputs = JSON.parse(readFileSync(join(root, 'INPUTS.json')));
const mutants = JSON.parse(readFileSync(join(root, 'MUTANTS.json')));
const types = JSON.parse(readFileSync(join(root, 'TYPES.json')));
const ts = tools.find(row => row.name === 'typescript'), npm = tools.find(row => row.name === 'npm');
const run = join(root, 'RUN-01'), work = join(run, 'work'), capture = join(run, 'capture');
const source = join(work, 'source'), installedApp = join(work, 'installed app'), movedApp = join(work, 'physically moved app');
const moved = join(movedApp, 'node_modules/virtual-bash');
const result = { schema: 'fresh-M1A-v11', startedWall: new Date().toISOString(), startMonotonicNs: start.toString(), coordinatorPid: process.pid,
  children: [], layouts: [], types: [], mutants: [], restores: [], bindings: [], guards: [], status: 'RUNNING', nativeGit: 0, mechanicalGroups: 0 };
const inventory = (directory, links = false) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name); assert.notEqual(entry.name, 'AGENTS.md', 'no instruction materialization');
  if (entry.isSymbolicLink()) { assert.ok(links); return [{ path, link: readlinkSync(path), realpath: realpathSync(path) }]; }
  return entry.isDirectory() ? [{ path, directory: true, bytes: 0 }, ...inventory(path, links)] : [{ path, bytes: lstatSync(path).size, sha256: hash(readFileSync(path)) }];
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const put = (path, data, flag = 'wx') => {
  assert.ok(path.startsWith(root + '/')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data, { flag });
};
const json = (path, value) => put(path, JSON.stringify(value, null, 2) + '\n');
function guard(label) {
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  assert.equal(hash(readFileSync(seal.node.path)), seal.node.sha256);
  for (const row of seal.files) assert.equal(hash(readFileSync(join(root, row.path))), row.sha256, row.path);
  const own = inventory(root).filter(row => !row.path.startsWith(run + '/') && row.path !== run);
  assert.deepEqual(own.filter(row => !row.directory).map(row => row.path).sort(), [...seal.files.map(row => join(root, row.path)), join(root, 'PRESEAL.json')].sort());
  for (const tree of seal.oldTrees) assert.deepEqual(inventory(tree.root), tree.rows, 'old complete census ' + tree.root);
  for (const tool of tools) assert.deepEqual(inventory(tool.root, tool.name === 'npm'), tool.rows, 'immutable tool census');
  assert.ok(elapsed() < seal.limits.aggregateMs - 5000, 'fresh aggregate cleanup reserve');
  result.guards.push({ label, elapsedMs: elapsed(), sealed: true, oldAppendProof: true, toolsAppendProof: true });
}
function unpack(bytes) {
  const files = []; let offset = 0;
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some(value => value !== 0)) {
    const header = bytes.subarray(offset, offset + 512), text = (start, size) => header.subarray(start, start + size).toString().replace(/\0.*$/s, '');
    const name = (text(345, 155) ? text(345, 155) + '/' : '') + text(0, 100), size = parseInt(text(124, 12).trim(), 8);
    assert.ok(header[156] === 48 || header[156] === 0); assert.ok(name.startsWith('package/') && !name.split('/').some(part => part === '..' || part === 'AGENTS.md'));
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length);
    assert.equal(header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0), parseInt(text(148, 8).trim(), 8));
    const path = name.slice(8), data = Buffer.from(bytes.subarray(offset + 512, offset + 512 + size)), expected = members.find(row => row.path === path);
    assert.ok(expected); assert.equal(hash(data), expected.sha256); files.push({ ...expected, data }); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(bytes.subarray(offset).every(value => value === 0)); assert.equal(files.length, 898); assert.equal(new Set(files.map(row => row.path)).size, 898);
  return files;
}
let payload, captureUsed = 0;
const known = new Set();
function enroll(child, row, cap) {
  let resolveClose, escalation;
  const close = new Promise(resolve => { resolveClose = resolve; });
  const stdout = [], stderr = [];
  const stop = reason => {
    row.stopReason ??= reason;
    if (!row.closed) {
      row.signals.push({ signal: 'SIGTERM', accepted: child.kill('SIGTERM'), elapsedMs: elapsed() });
      escalation ??= setTimeout(() => { if (!row.closed) row.signals.push({ signal: 'SIGKILL', accepted: child.kill('SIGKILL'), elapsedMs: elapsed() }); }, 1000);
    }
  };
  child.once('error', error => { row.spawnError = String(error); stop('spawn error'); });
  child.once('exit', (code, signal) => { row.exit = { code, signal, elapsedMs: elapsed() }; });
  child.once('close', (code, signal) => { row.closed = true; row.close = { code, signal, elapsedMs: elapsed() }; clearTimeout(escalation); resolveClose(); });
  for (const [name, stream, chunks] of [['stdout', child.stdout, stdout], ['stderr', child.stderr, stderr]]) {
    stream.once('close', () => { row[name + 'Closed'] = true; }); stream.on('error', error => { row.captureError = String(error); stop('capture error'); });
    stream.on('data', bytes => {
      row.outputBytes += bytes.length; captureUsed += bytes.length;
      if (row.outputBytes > cap || captureUsed > 112 * 1024 * 1024) { row.captureIncomplete = true; stop('capture reserve exhausted'); }
      else chunks.push(Buffer.from(bytes));
    });
  }
  row.listenersEnrolled = true;
  const cleanup = async () => {
    row.cleanupAttempted = true;
    if (!row.closed) stop('owned finally cleanup');
    let timer; await Promise.race([close, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]); clearTimeout(timer); clearTimeout(escalation);
    row.cleanupSettled = row.closed && row.stdoutClosed === true && row.stderrClosed === true;
    row.unknownClosure = !row.cleanupSettled;
  };
  return { close, cleanup, stop, stdout, stderr };
}
async function child(recipe, packet, cwd) {
  const number = result.children.length + 1, packetPath = join(capture, `${number}-${recipe.id}.packet.json`);
  const tool = recipe.kind === 'tool' || recipe.kind === 'type';
  packet.node = seal.node; json(packetPath, packet);
  const environment = { PATH: dirname(seal.node.path), HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), UV_THREADPOOL_SIZE: '1',
    npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'home/user.npmrc'), npm_config_globalconfig: join(work, 'home/global.npmrc') };
  const args = [join(root, tool ? 'tool.mjs' : 'bootstrap.mjs'), packetPath];
  const row = { number, id: recipe.id, kind: recipe.kind, args, cwd, environment, signals: [], closed: false, outputBytes: 0, startedMs: elapsed() };
  result.children.push(row);
  const processHandle = spawn(seal.node.path, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  known.add(processHandle);
  let owned, timer, hardTimer;
  try {
    owned = enroll(processHandle, row, recipe.captureMiB * 1024 * 1024);
    row.pid = processHandle.pid; row.enrollment = 'known.add immediately after spawn before fallible helper';
    assert.ok(result.children.length + 1 <= 48, 'all processes incl coordinator');
    const timeout = Math.min(recipe.timeoutMs, seal.limits.aggregateMs - elapsed() - 6000);
    assert.ok(timeout > 0);
    timer = setTimeout(() => owned.stop('fresh recipe/aggregate deadline'), timeout);
    await Promise.race([owned.close, new Promise(resolve => { hardTimer = setTimeout(resolve, timeout + 7000); })]);
    if (!row.closed) owned.stop('unknown closure after hard wait');
  } finally {
    clearTimeout(timer); clearTimeout(hardTimer);
    if (owned) await owned.cleanup();
    else {
      row.unknownClosure = true; processHandle.on('error', () => {});
      let rescueTimer;
      const rescue = new Promise(resolve => processHandle.once('close', () => { row.closed = true; resolve(); }));
      processHandle.kill('SIGKILL'); await Promise.race([rescue, new Promise(resolve => { rescueTimer = setTimeout(resolve, 5000); })]); clearTimeout(rescueTimer);
    }
    for (const [suffix, chunks] of [['stdout.jsonl', owned?.stdout], ['stderr.txt', owned?.stderr]]) if (chunks) {
      const bytes = Buffer.concat(chunks), path = join(capture, `${number}-${recipe.id}.${suffix}`); put(path, bytes);
      row[suffix.startsWith('stdout') ? 'stdout' : 'stderr'] = { path, bytes: bytes.length, sha256: hash(bytes) };
    }
  }
  assert.ok(row.cleanupSettled && !row.unknownClosure && !row.stopReason && !row.captureIncomplete && !row.captureError, 'child/capture safety');
  assert.equal(row.exit.signal, null);
  return { row, stdout: Buffer.concat(owned.stdout).toString(), stderr: Buffer.concat(owned.stderr).toString() };
}
function verifyPackage(directory) {
  const actual = inventory(directory).filter(row => !row.directory).map(row => ({ path: row.path.slice(directory.length + 1), sha256: row.sha256, bytes: row.bytes }));
  assert.deepEqual(actual, members.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })).sort((left, right) => left.path < right.path ? -1 : 1));
}
function manifest(directory, sourceMode, trace) {
  const rows = sourceMode ? inputs.filter(row => row.path.startsWith('src/') && row.path.endsWith('.ts')).map(row => ({ path: join(directory, row.path), sha256: row.sha256, role: 'unmodified-source' })) :
    inventory(join(directory, 'dist')).filter(row => !row.directory && row.path.endsWith('.js')).map(row => ({ path: row.path, sha256: row.sha256, role: 'unmodified-emit' }));
  for (const name of ['worker.mjs','observer.mjs','cases.mjs','fixtures.mjs']) rows.push({ path: join(root,name), sha256: seal.files.find(row => row.path === name).sha256, role: 'versioned-harness' });
  return { root: directory, source: sourceMode, productEntry: join(directory, sourceMode ? 'src/commands/git/index.ts' : 'dist/commands/git/index.js'),
    compiler: join(ts.root, 'lib/typescript.js'), compilerSha256: ts.rows.find(row => row.path.endsWith('/lib/typescript.js')).sha256,
    trace, allowedBuiltins: seal.allowedBuiltins, files: rows };
}
async function executeLayout(recipe, directory, sourceMode, mutant = null) {
  const trace = join(capture, recipe.id + '-loads.jsonl'), binding = manifest(directory, sourceMode, trace);
  if (mutant) binding.files.find(row => row.path === join(directory, mutant.file)).role = 'loaded-mutant';
  const packet = { candidate: seal.candidate, layout: recipe.id, root: directory, source: sourceMode, cases: recipe.cases,
    workRoot: work, realRoot: join(work, 'real', recipe.id), captureBytes: recipe.captureMiB * 1024 * 1024,
    records: join(root, 'records.json'), recordsSha256: seal.files.find(row => row.path === 'records.json').sha256, routes: join(root, 'ROUTES-CAPACITY.json'),
    loader: join(root, 'loader.mjs'), loaderSha256: seal.files.find(row => row.path === 'loader.mjs').sha256,
    launchEntry: join(root, 'worker.mjs'), binding, mutant: mutant?.id };
  mkdirSync(packet.realRoot, { recursive: true });
  const output = await child(recipe, packet, directory);
  assert.equal(output.stderr, '', 'runtime stderr');
  const records = output.stdout.trim().split('\n').map(line => JSON.parse(line));
  const birth = records.find(row => row.kind === 'birth'); assert.equal(birth.pid, output.row.pid); assert.equal(birth.ppid, process.pid);
  const summary = records.find(row => row.kind === 'summary'); assert.ok(summary, 'complete runtime summary required');
  assert.equal(summary.safety, false, 'actual lifecycle safety stops dependents');
  assert.equal(summary.executed, recipe.cases.length); assert.equal(summary.expected, recipe.cases.length);
  assert.equal(output.row.exit.code, summary.failed ? 1 : 0, 'allPASS/nonzero remains failure');
  assert.ok(!existsSync(packet.realRoot), 'owned Real fixture root removed');
  const loads = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const row of binding.files) assert.equal(hash(readFileSync(row.path)), row.sha256, 'post-load immutable module');
  for (const loaded of loads.filter(row => row.kind === 'module')) assert.equal(loaded.sourceSha256, binding.files.find(row => row.path === fileURLToPath(loaded.url)).sha256);
  if (mutant) assert.ok(loads.some(row => row.role === 'loaded-mutant' && row.sourceSha256 === mutant.mutatedSha256));
  return { ...summary, outputPath: output.row.stdout.path, loadsPath: trace, loadCount: loads.filter(row => row.kind === 'module').length,
    loadedIdentitySha256: hash(readFileSync(trace)), code: output.row.exit.code };
}

try {
  guard('pre'); mkdirSync(run); mkdirSync(work); mkdirSync(capture);
  for (const name of ['home','tmp','npm-cache','real']) mkdirSync(join(work,name));
  put(join(work,'home/user.npmrc'),''); put(join(work,'home/global.npmrc'),'');
  for (const row of inputs) { const bytes=Buffer.from(row.base64,'base64'); assert.equal(hash(bytes),row.sha256); put(join(source,row.path),bytes); chmodSync(join(source,row.path),(typeof row.mode === 'string' ? parseInt(row.mode,8) : row.mode) & 0o777); }
  for (const tool of tools.filter(row => row.name === '@types/node' || row.name === 'undici-types')) {
    for (const row of tool.rows.filter(row => !row.directory && (row.path.endsWith('.ts') || row.path.endsWith('/package.json')))) {
      const relative = row.path.slice(tool.root.length + 1); put(join(source,'node_modules',tool.name,relative),readFileSync(row.path));
    }
  }
  const packageBytes=Buffer.from(readFileSync(join(root,'PACKAGE.tgz.base64'),'utf8').trim(),'base64'); assert.equal(hash(packageBytes),seal.packageSha256);
  payload=unpack(gunzipSync(packageBytes)); put(join(work,'PACKAGE.tgz'),packageBytes);
  json(join(installedApp,'package.json'),{name:'m1a-v11-consumer',private:true,type:'module',dependencies:{'virtual-bash':'file:'+join(work,'PACKAGE.tgz')}});
  let installDone=false;
  for (const recipe of seal.sequence) {
    assert.ok(elapsed()<seal.limits.aggregateMs-5000);
    if (recipe.id === 'build' || recipe.id === 'offline-install' || recipe.kind === 'type') {
      let entry, args, cwd, consumer;
      if (recipe.id === 'build') { entry=join(ts.root,'lib/tsc.js'); args=['-p',join(source,'tsconfig.build.json'),'--pretty','false']; cwd=source; }
      else if (recipe.id === 'offline-install') { entry=join(npm.root,'bin/npm-cli.js'); args=['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--omit=dev','--no-bin-links']; cwd=installedApp; }
      else {
        consumer=types.find(row=>'types-'+row.id===recipe.id); entry=join(ts.root,'lib/tsc.js'); cwd=source;
        args=['--noEmit','--strict','--exactOptionalPropertyTypes','--skipLibCheck','false','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',join(source,'node_modules/@types'),join(root,consumer.path),'--pretty','false'];
      }
      const toolReceipt=join(capture,recipe.id+'-tool.json');
      const entrySha256=tools.flatMap(tool=>tool.rows).find(row=>row.path===entry).sha256;
      assert.equal(hash(readFileSync(entry)),entrySha256,'sealed tool entry');
      const output=await child(recipe,{role:recipe.id,entry,entrySha256,args,receipt:toolReceipt},cwd);
      const toolResult=JSON.parse(readFileSync(toolReceipt)); assert.equal(toolResult.nestedProcessAttempts,0); assert.equal(toolResult.networkAttempts,0);
      const passed=output.row.exit.code===recipe.exitCode && (!recipe.diagnostic || (output.stdout+output.stderr).includes(recipe.diagnostic));
      if (recipe.kind==='type') result.types.push({id:recipe.id,passed,expected:recipe.exitCode,actual:output.row.exit.code,diagnostic:recipe.diagnostic,consumerSha256:consumer.sha256});
      else { assert.ok(passed,recipe.id+' failed'); result[recipe.id]={passed:true,exitCode:output.row.exit.code}; }
      if (recipe.id==='build') for (const member of members.filter(row=>row.path.startsWith('dist/'))) assert.equal(hash(readFileSync(join(source,member.path))),member.sha256,'fresh strict emit vs original author package');
      if (recipe.id==='offline-install') { verifyPackage(join(installedApp,'node_modules/virtual-bash')); installDone=true; result.installation='actual offline npm install, scripts disabled, full898 bytes verified'; }
    } else if (recipe.kind==='layout') {
      let directory=source;
      if (recipe.id==='installed') { assert.ok(installDone); directory=join(installedApp,'node_modules/virtual-bash'); }
      if (recipe.id==='moved') { renameSync(installedApp,movedApp); assert.ok(!existsSync(installedApp)); directory=moved; verifyPackage(moved); }
      result.layouts.push(await executeLayout(recipe,directory,recipe.id==='source'));
    } else if (recipe.kind==='mutant' || recipe.kind==='restore') {
      const mutant=mutants.find(row=>row.id===recipe.mutant), directory=join(work,'mutant-'+mutant.id);
      if (recipe.kind==='mutant') {
        for (const member of payload) {
          let data=member.data;
          if (member.path===mutant.file) { assert.equal(data.toString().split(mutant.needle).length,2); data=Buffer.from(`globalThis.__reviewMutant = ${JSON.stringify(mutant.id)};\n`+data.toString().replace(mutant.needle,mutant.replacement)); assert.equal(hash(data),mutant.mutatedSha256); }
          put(join(directory,member.path),data);
        }
        const report=await executeLayout(recipe,directory,false,mutant);
        result.mutants.push({id:mutant.id,detected:report.failed===1&&report.passed===0&&report.mutant===mutant.id,report});
      } else {
        const original=payload.find(row=>row.path===mutant.file); put(join(directory,mutant.file),original.data,'w'); verifyPackage(directory);
        const report=await executeLayout(recipe,directory,false);
        result.restores.push({id:mutant.id,passed:report.failed===0&&report.passed===recipe.cases.length,restoredSha256:hash(readFileSync(join(directory,mutant.file))),report});
      }
    } else {
      const binding=manifest(moved,false,join(capture,recipe.id+'-loads.jsonl'));
      const packet={loader:join(root,'loader.mjs'),loaderSha256:seal.files.find(row=>row.path==='loader.mjs').sha256,binding,launchEntry:join(root,'worker.mjs')};
      if (recipe.binding==='entry') binding.productEntry=join(moved,'dist/commands/git/absent.js');
      if (recipe.binding==='hash') binding.files.find(row=>row.path===binding.productEntry).sha256='0'.repeat(64);
      if (recipe.binding==='import') packet.launchEntry=join(installedApp,'node_modules/virtual-bash/dist/commands/git/index.js');
      const output=await child(recipe,packet,moved);
      const refused=output.row.exit.code===1&&output.stderr.includes(recipe.diagnostic)&&!output.stdout.includes('product-loaded');
      assert.ok(refused,'binding refusal exact'); result.bindings.push({id:recipe.id,refused,diagnostic:recipe.diagnostic});
    }
    assert.ok(inventory(capture).reduce((total,row)=>total+row.bytes,0)<seal.limits.captureBytes-1048576,'capture hard bound');
    assert.ok(inventory(work).reduce((total,row)=>total+row.bytes,0)<seal.limits.workBytes-seal.limits.captureBytes,'work reserve');
  }
  result.layoutEquality=[];
  const baseline=readFileSync(result.layouts[0].outputPath,'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.kind==='case');
  for (const layout of result.layouts.slice(1)) {
    const rows=readFileSync(layout.outputPath,'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.kind==='case');
    result.layoutEquality.push({layout:layout.layout,equal:JSON.stringify(rows.map(row=>({id:row.id,status:row.status,observations:row.observations})))===JSON.stringify(baseline.map(row=>({id:row.id,status:row.status,observations:row.observations})))});
  }
  verifyPackage(moved);
  for(const row of inputs) assert.equal(hash(readFileSync(join(source,row.path))),row.sha256,'source unchanged');
  guard('post');
  assert.equal(result.children.length,20);
  result.status=result.layouts.every(row=>row.failed===0)&&result.types.every(row=>row.passed)&&result.mutants.every(row=>row.detected)&&result.restores.every(row=>row.passed)&&result.bindings.every(row=>row.refused)&&result.layoutEquality.every(row=>row.equal)?'SCOPED_PASS':'SCOPED_FAILURES';
} catch (error) { result.status='HOLD'; result.error={message:error.message,stack:error.stack}; }
finally {
  if(existsSync(capture)) {
    result.finishedWall=new Date().toISOString(); result.inclusiveBeforePublicationMs=elapsed();
    result.captureBytesBeforeReceipt=inventory(capture).reduce((total,row)=>total+row.bytes,0); result.workBytes=inventory(work).reduce((total,row)=>total+row.bytes,0);
    result.unrunRoles=seal.sequence.slice(result.children.length).map(row=>row.id);
    json(join(capture,'RESULT.json'),result);
    json(join(capture,'PUBLICATION-CLOCK.json'),{afterResultWriteMs:elapsed(),finalWriteTailMeasured:false,limitMs:seal.limits.aggregateMs});
  }
}
console.log(JSON.stringify({status:result.status,error:result.error,layouts:result.layouts.map(row=>({layout:row.layout,passed:row.passed,failed:row.failed})),children:result.children.length,elapsedMs:elapsed()}));
process.exitCode=result.status==='SCOPED_PASS'&&elapsed()<seal.limits.aggregateMs?0:1;
