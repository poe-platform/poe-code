import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCaptureOwner } from '../preparation-v7-capture/capture-owner.mjs';
const root = new URL('.', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function bounded(url, maximum) {
  const filename = fileURLToPath(url), stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename || stat.size > maximum) throw Error('regular bounded input');
  return fs.readFileSync(filename);
}
export async function run(token) {
  const output = new URL('run-01/', root);
  fs.mkdirSync(output);
  const capture = createCaptureOwner({ open: url => fs.openSync(url,'wx',0o600), write: (fd,bytes,offset,length) => fs.writeSync(fd,bytes,offset,length), close: fd => fs.closeSync(fd) });
  if (!capture.acquire([new URL('stdout.raw',output),new URL('stderr.raw',output)])) return { capture:capture.snapshot(), launched:false };
  let child, timer, killTimer, code = null, signal = null, childErrorPresent = false, closed = false;
  const started = Date.now();
  try {
    const sealBytes = bounded(new URL('PRESEAL.json',root),65536);
    if (digest(sealBytes) !== token) throw Error('preseal token');
    const seal = JSON.parse(sealBytes);
    for (const record of [...seal.modules,...seal.hostInputs]) {
      const bytes = bounded(new URL(record.path,root),65536);
      if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw Error('input hash');
    }
    const nodeStat = fs.lstatSync(seal.node.path);
    if (!nodeStat.isFile() || nodeStat.isSymbolicLink() || fs.realpathSync(seal.node.path) !== seal.node.path || nodeStat.size !== seal.node.bytes) throw Error('Node admission');
    const nodeHash = createHash('sha256');
    for await (const bytes of fs.createReadStream(seal.node.path,{highWaterMark:65536})) nodeHash.update(bytes);
    if (nodeHash.digest('hex') !== seal.node.sha256) throw Error('Node hash');
    const args = [...seal.argv];
    await new Promise(resolve => {
      const stop = () => { if (child && !closed) { child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!closed) child.kill('SIGKILL'); },2000); } };
      timer = setTimeout(() => { capture.record(undefined,'outer-deadline'); stop(); },30000);
      try {
        child = spawn(seal.node.path,args,{cwd:fileURLToPath(root),env:seal.env,stdio:['ignore','pipe','pipe']});
      } catch (value) { capture.record(value,'spawn'); clearTimeout(timer); resolve(); return; }
      child.once('close',(exitCode,exitSignal)=>{ closed=true;code=exitCode;signal=exitSignal;clearTimeout(timer);clearTimeout(killTimer);resolve(); });
      child.once('error',value=>{ childErrorPresent=true;capture.record(value,'child-error');stop(); });
      child.stdout.on('data',bytes=>{ if(!capture.write(0,bytes))stop(); });
      child.stderr.on('data',bytes=>{ if(!capture.write(1,bytes))stop(); });
      child.stdout.on('error',value=>{ capture.record(value,'stdout-error');stop(); });
      child.stderr.on('error',value=>{ capture.record(value,'stderr-error');stop(); });
    });
  } catch (value) { capture.record(value,'outer-admission'); }
  finally { clearTimeout(timer);clearTimeout(killTimer);capture.close(); }
  return { schema:'parent-only-owner-v1', launched:!!child, pid:child?.pid??null, closed, code, signal, childErrorPresent, elapsedMs:Date.now()-started, capture:capture.snapshot(), primary:capture.primary, secondary:capture.secondary };
}
