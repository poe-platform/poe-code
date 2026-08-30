import { openSync, readSync, closeSync, writeSync, writeFileSync, readFileSync, lstatSync, realpathSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateBootstrap } from './import-policy.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function read(filename, maximum) { const stat = lstatSync(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || realpathSync(filename) !== filename) throw Error('owner input admission'); return readFileSync(filename); }
export async function runWorkerQualification(expectedGrantSha256) {
  const capture = path.join(directory, 'actual-v5-01'); mkdirSync(capture);
  const stdout = openSync(path.join(capture, 'parent.stdout.raw'), 'wx');
  const stderr = openSync(path.join(capture, 'parent.stderr.raw'), 'wx');
  let child; let primary = null; let closed = false; let code = null; let signal = null; let bytesSeen = 0; let killTimer;
  const started = Date.now(); const events = [{kind:'capture-owned',at:0}];
  let resolveClosed; const closePromise = new Promise(resolve => { resolveClosed = resolve; });
  const fail = value => { primary ??= String(value?.message ?? value); if (child && !closed) { child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2000); } };
  const timer = setTimeout(() => fail(Error('outer Worker qualification deadline')), 180000);
  let capsule; let manifests;
  try {
    const grantBytes = read(path.join(directory, 'ROOT-WORKER-GO.json'), 16384);
    if (typeof expectedGrantSha256 !== 'string' || digest(grantBytes) !== expectedGrantSha256) throw Error('fresh ROOT grant hash');
    const grant = JSON.parse(grantBytes);
    if (grant.authorized !== true || grant.phase !== 'worker' || grant.oneShot !== true || grant.compiler !== false) throw Error('Worker GO required');
    const compositionBytes = read(path.join(directory, 'COMPOSITION.json'), 262144);
    if (digest(compositionBytes) !== grant.compositionSha256) throw Error('composition GO');
    const composition = JSON.parse(compositionBytes);
    const tool = composition.node; const toolStat = lstatSync(tool.origin);
    if (!toolStat.isFile() || toolStat.isSymbolicLink() || toolStat.size !== tool.bytes || realpathSync(tool.origin) !== tool.origin) throw Error('Node tool metadata');
    const descriptor = openSync(tool.origin, 'r'); const scratch = Buffer.alloc(65536); const toolDigest = createHash('sha256'); let hashed = 0;
    try { for (;;) { const count = readSync(descriptor, scratch, 0, scratch.length, null); if (!count) break; hashed += count; if (hashed > tool.bytes) throw Error('Node grew'); toolDigest.update(scratch.subarray(0,count)); } } finally { closeSync(descriptor); }
    if (hashed !== tool.bytes || toolDigest.digest('hex') !== tool.sha256) throw Error('Node tool binding');
    capsule = path.join(capture, 'capsule'); mkdirSync(capsule);
    let written = 0;
    if (composition.files.length > 160) throw Error('copy count');
    for (const file of composition.files) {
      if (typeof file.target !== 'string' || file.target.startsWith('/') || file.target.includes('..') || file.target.includes('\\')) throw Error('copy destination');
      const bytes = read(path.resolve(directory, file.source), 2097152);
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw Error('copy input binding');
      written += bytes.length; if (written > 16777216) throw Error('copy work cap');
      const target = path.join(capsule, file.target); mkdirSync(path.dirname(target), {recursive:true}); writeFileSync(target, bytes, {flag:'wx'});
    }
    const template = JSON.parse(read(path.join(capsule, 'GRANT.template.json'), 16384));
    const boundGrant = {};
    for (const key of Object.keys(template)) boundGrant[key] = grant[key];
    writeFileSync(path.join(capsule, 'GRANT.json'), JSON.stringify(boundGrant)+'\n', {flag:'wx'});
    manifests = JSON.parse(read(path.join(capsule, 'MODULES.json'), 262144));
    validateBootstrap(manifests, manifests.bootstrap.map(record => { const bytes = read(path.join(capsule, record.path), 2097152); return {path:record.path,bytes:bytes.length,sha256:digest(bytes)}; }));
    const runtime = path.join(capsule, 'runtime'); mkdirSync(runtime);
    const paths = composition.files.map(file => path.join(capsule, file.target)); paths.push(path.join(capsule,'GRANT.json'));
    const args = ['--permission','--allow-worker',...paths.map(path => '--allow-fs-read='+path),'--allow-fs-write='+runtime,'--max-old-space-size=64','--unhandled-rejections=strict',path.join(capsule,'parent-entry.mjs')];
    if (Date.now()-started >= 180000) throw Error('pre-acquisition deadline');
    child = spawn(composition.node.origin, args, {cwd:capsule,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
    child.once('error',fail);
    child.once('close',(exitCode,exitSignal)=>{closed=true;code=exitCode;signal=exitSignal;resolveClosed();});
    for (const [stream,fd] of [[child.stdout,stdout],[child.stderr,stderr]]) { stream.on('error',fail); stream.on('data',bytes=>{try{bytesSeen+=bytes.length;if(bytesSeen>1048576){fail(Error('parent capture cap'));return;}writeSync(fd,bytes);}catch(value){fail(value);}}); }
    try { events.push({kind:'parent-spawn',pid:child.pid??null,at:Date.now()-started}); } catch(value) { fail(value); }
    await closePromise;
  } catch(value) { fail(value); if(child&&!closed)await closePromise; }
  finally { clearTimeout(timer);clearTimeout(killTimer);closeSync(stdout);closeSync(stderr); }
  let authenticatedFiles=0;let artifactBytes=0;const census=[];
  if(capsule){const walk=directory=>{for(const name of readdirSync(directory).sort()){const file=path.join(directory,name);const stat=lstatSync(file);if(stat.isSymbolicLink())throw Error('output symlink');if(stat.isDirectory())walk(file);else{if(!stat.isFile()||stat.size>2097152)throw Error('output cap');artifactBytes+=stat.size;if(artifactBytes>33554432||++authenticatedFiles>220)throw Error('output census cap');const data=read(file,2097152);census.push({path:path.relative(capsule,file),bytes:data.length,sha256:digest(data)});}}};try{walk(capsule);}catch(value){primary??=String(value?.message??value);}}
  const receipt={closed,code,signal,primary,bytesSeen,elapsedMs:Date.now()-started,events,authenticatedFiles,artifactBytes,census,cleanClaim:false,qualification:'Outer process exit is not parent cleanup proof; per-case raw receipts and different review required. Artifacts retained, no automatic retry.'};
  writeFileSync(path.join(capture,'OWNER.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
