import assert from 'node:assert/strict';
import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createChmodCommand } from '/Users/kjopek/Workspace/safe-bash/src/commands/metadata/chmod.ts';
import { createRealFileSystem } from '/Users/kjopek/Workspace/safe-bash/src/fs/real/index.ts';
import { MemoryFileSystem } from '/Users/kjopek/Workspace/safe-bash/src/fs/memory/index.ts';
import { FsError, toByteSource } from '/Users/kjopek/Workspace/safe-bash/src/contracts/index.ts';

const repository = '/Users/kjopek/Workspace/safe-bash';
assert.equal(process.cwd(), repository);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const replay = JSON.parse(await host.readFile('/tmp/safe-bash-metadata-sgid-replay.json', 'utf8'));
async function snapshot() {
  const files = {};
  for (const path of Object.keys(replay.before.files)) files[path] = hash(await host.readFile(path));
  return { head: spawnSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).stdout.trim(), files, digest: hash(JSON.stringify(files)) };
}
function external(binary, args, cwd = repository) {
  const result = spawnSync(binary, args, { cwd, encoding:'utf8', timeout:10000, env:{PATH:'/usr/bin:/bin', LC_ALL:'C', TZ:'UTC'} });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { binary, args, status:result.status, stdout:result.stdout, stderr:result.stderr };
}
async function invoke(fs, args, controller = new AbortController()) {
  const stderr = [];
  try {
    const result = await createChmodCommand({umask:0o027}).execute({command:'chmod', args:['--', ...args], fs, cwd:'/', env:{}, signal:controller.signal, stdin:toByteSource(''), stdout:{async write() {}}, stderr:{async write(bytes) {stderr.push(Buffer.from(bytes));}}});
    return {status:result.exitCode, stderr:Buffer.concat(stderr).toString()};
  } catch (error) { return {rejected:true, sameAbortReason:error === controller.signal.reason, code:error.code, message:error.message}; }
}
const report = {started:new Date().toISOString(), before:await snapshot(), synthetic:[], native:[], primarySources:[]};
const specs = [
  'readonly', 'unsupported', 'missing-chmod', 'missing-identity-and-owner',
  'pre-abort', 'abort-during-chmod', 'EPERM', 'EACCES', 'EIO', 'ENOTSUP',
  'identity-change-before-fresh-stat', 'concurrent-mode-before-fresh-stat',
  'reused-alias-after-fresh-stat', 'abort-after-effect'
];
for (const name of specs) {
  const memory = new MemoryFileSystem();
  await memory.writeFile('/file', Buffer.from('sentinel'));
  await memory.chmod('/file', 0o777);
  const controller = new AbortController();
  const reason = new FsError('EPERM', {message:'caller cancellation, not permission result'});
  let calls = 0;
  let stats = 0;
  const events = [];
  const fs = new Proxy(memory, {get(target, key) {
    if (key === 'capabilities') return {...target.capabilities, ...(name === 'readonly' ? {readOnly:true} : {}), ...(name === 'unsupported' ? {permissions:false} : {})};
    if (key === 'chmod' && name === 'missing-chmod') return undefined;
    if (key === 'lstat') return async (...args) => {
      stats++;
      if (stats === 2 && name === 'concurrent-mode-before-fresh-stat') {await target.chmod('/file', 0o600); events.push('same inode mode became0600 before fresh stat');}
      const stat = await target.lstat(...args);
      if (stats === 2 && name === 'identity-change-before-fresh-stat') return {...stat, ino:stat.ino + 1};
      if (name === 'missing-identity-and-owner') {const {uid,gid,ino,dev,identityScope,...partial} = stat; return partial;}
      return stat;
    };
    if (key === 'chmod') return async (...args) => {
      calls++;
      if (name === 'abort-during-chmod') {controller.abort(reason); throw reason;}
      if (['EPERM','EACCES','EIO','ENOTSUP'].includes(name)) throw new FsError(name, {syscall:'chmod', path:'/file'});
      if (name === 'reused-alias-after-fresh-stat') {await target.rm('/file'); await target.writeFile('/file', Buffer.from('replacement')); await target.chmod('/file',0o600); events.push('new backing inode under same pathname after freshness check');}
      await target.chmod(...args);
      if (name === 'abort-after-effect') {controller.abort(reason); events.push('backend fulfilled after chmod effect and abort');}
    };
    const value = Reflect.get(target,key);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  if (name === 'pre-abort') controller.abort(reason);
  const before = await memory.stat('/file');
  const result = await invoke(fs, ['u-s,g=s,o-t','file'],controller);
  const after = await memory.stat('/file');
  report.synthetic.push({name,beforeMode:(before.mode & 0o7777).toString(8),result,calls,stats,afterMode:(after.mode & 0o7777).toString(8),inodeChanged:before.ino !== after.ino,events});
}
let fixture;
const savedMask = process.umask(0o027);
try {
  fixture = await host.mkdtemp('/tmp/safe-bash-metadata-sgid-controls-owned-');
  const file = `${fixture}/file`;
  await host.writeFile(file,'sentinel');
  const real = await createRealFileSystem({root:fixture});
  const oracle = `${repository}/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod`;
  await host.chown(file,process.getuid(),process.getgid());
  for (const [name,initial,symbolic,numeric] of [['already-set-member-sgid',0o2777,'g+s',0o2777],['clear-member-sgid',0o2777,'g-s',0o777]]) {
    for (const layer of ['gnu','node','real','command']) {
      await host.chmod(file,initial);
      const before = await host.stat(file);
      let result;
      if (layer === 'gnu') result = external(oracle,['--',symbolic,'file'],fixture);
      else if (layer === 'command') result = await invoke(real,[symbolic,'file']);
      else {try {await (layer === 'node' ? host.chmod(file,numeric) : real.chmod('/file',numeric)); result={status:0};} catch(error) {result={status:1,code:error.code};}}
      const after = await host.stat(file);
      report.native.push({name,layer,before:(before.mode & 0o7777).toString(8),uid:before.uid,gid:before.gid,result,after:(after.mode & 0o7777).toString(8)});
    }
  }
  await host.mkdir(`${fixture}/denied`);
  await host.writeFile(`${fixture}/denied/file`,'denial-sentinel');
  await host.chmod(`${fixture}/denied/file`,0o777);
  await host.chmod(`${fixture}/denied`,0);
  try {
    for (const layer of ['gnu','node','real','command']) {
      let result;
      if(layer === 'gnu') result=external(oracle,['--','u-s,g=s,o-t','denied/file'],fixture);
      else if(layer === 'command') result=await invoke(real,['u-s,g=s,o-t','denied/file']);
      else {try {await (layer === 'node' ? host.chmod(`${fixture}/denied/file`,0o2707) : real.chmod('/denied/file',0o2707)); result={status:0};} catch(error) {result={status:1,code:error.code};}}
      report.native.push({name:'real-search-permission-denied',layer,result});
    }
  } finally {await host.chmod(`${fixture}/denied`,0o700);}
  report.deniedFinalMode=((await host.stat(`${fixture}/denied/file`)).mode & 0o7777).toString(8);
  assert.equal(await host.readFile(file,'utf8'),'sentinel');
  assert.equal(await host.readFile(`${fixture}/denied/file`,'utf8'),'denial-sentinel');
  report.sentinelsUnchanged=true;
} finally {
  process.umask(savedMask);
  if(fixture) {await host.rm(fixture,{recursive:true,force:true}); report.fixtureRemoved=await host.stat(fixture).then(()=>false,error=>error.code==='ENOENT');}
}
const proof = JSON.parse(await host.readFile('tests/fs/real/metadata-review/source-proof.json','utf8'));
for(const source of proof.sources) {
  const response=await fetch(source.url,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.ok,true);
  const bytes=Buffer.from(await response.arrayBuffer());
  report.primarySources.push({url:source.url,sha256:hash(bytes),expected:source.sha256,bytes:bytes.length,matches:hash(bytes)===source.sha256});
}
report.after=await snapshot();
report.inputsStable=report.before.digest===report.after.digest;
report.driftFromReplay=Object.keys(report.before.files).filter(path=>report.before.files[path]!==replay.after.files[path]);
report.finished=new Date().toISOString();
report.activeOwnedProcesses=0;
const content=JSON.stringify(report,null,2);
const applied=spawnSync('apply_patch',[],{encoding:'utf8',input:`*** Begin Patch\n*** Add File: /tmp/safe-bash-metadata-sgid-controls.json\n${content.split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`});
assert.equal(applied.status,0,applied.stderr);
console.log(JSON.stringify({synthetic:report.synthetic,native:report.native,inputsStable:report.inputsStable,driftFromReplay:report.driftFromReplay,primaryHashesMatch:report.primarySources.every(source=>source.matches),fixtureRemoved:report.fixtureRemoved},null,2));
