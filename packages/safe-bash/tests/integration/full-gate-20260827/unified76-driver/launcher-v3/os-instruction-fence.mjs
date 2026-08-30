import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectLinkage,toolRoutes} from './tool-routing.mjs';

const directory=dirname(fileURLToPath(import.meta.url));
export const INSTRUCTION_COMPONENT='(^|/)[Aa][Gg][Ee][Nn][Tt][Ss][.][Mm][Dd]($|/)';
export const SANDBOX_EXEC='/usr/bin/sandbox-exec';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>Object.assign(new Error(message),{exitCode:78});

export function instructionFenceIdentity(){return JSON.parse(readFileSync(join(directory,'OS-INSTRUCTION-FENCE.json')));}

function externalBinding(value){
  const binding=structuredClone(value);
  delete binding.inspection.pid;
  delete binding.inspection.invocation.receipt.admittedAt;
  return binding;
}

export function verifyInstructionFenceExternal(){
  const expected=instructionFenceIdentity();
  try{
    assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
    const stat=lstatSync(SANDBOX_EXEC);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
    assert.equal(stat.size,expected.binary.bytes);assert.equal(stat.mode&0o777,expected.binary.mode);
    assert.equal(digest(readFileSync(SANDBOX_EXEC)),expected.binary.sha256);
    const inspection=inspectLinkage(SANDBOX_EXEC);
    assert.equal(inspection.invocation.receipt.host,expected.host);
    assert.equal(inspection.stdout,expected.linkage);
    assert.deepEqual(expected.systemReferences,[[SANDBOX_EXEC,'/usr/lib/libsandbox.1.dylib'],[SANDBOX_EXEC,'/usr/lib/libSystem.B.dylib']]);
    for(const [,file]of expected.systemReferences){let absent=false;try{lstatSync(file);}catch(error){assert.equal(error.code,'ENOENT');absent=true;}assert.equal(absent,true,'readable library needs an explicit new hash binding');}
    return{manifestSha256:digest(JSON.stringify(expected)),binary:expected.binary,host:expected.host,systemReferences:expected.systemReferences,qualification:expected.qualification,inspection};
  }catch(error){throw fail('OS instruction fence identity unavailable or changed: '+error.message);}
}

function identity(path){
  const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'real directory required');
  assert.equal(realpathSync(path),path,'canonical writable root required');assert.equal(stat.mode&0o777,0o700);
  assert.equal(stat.uid,process.getuid());
  return{path,device:stat.dev,inode:stat.ino,mode:stat.mode&0o777,uid:stat.uid};
}

export function renderInstructionFence(envelope){
  assert.equal(envelope.schema,'unified76-os-instruction-fence/1');
  assert.equal(envelope.roots.length,2);
  const [root,output]=envelope.roots.map(row=>row.path);
  assert.match(root,/^\/private\/tmp\/unified76-os-write-[A-Za-z0-9]+$/u);
  assert.match(output,/^\/private\/tmp\/(?:full-gate-unified76|unified76-build-types-review)-[A-Za-z0-9_-]+$/u);
  assert.notEqual(root,output);
  const selectors=toolRoutes().deniedSelectorExecutables.map(path=>`(deny process-exec (literal ${JSON.stringify(path)}))\n`).join('');
  return `(version 1)\n(allow default)\n(deny file-write* file-link)\n(allow file-write* file-link (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(output)}))\n(allow file-write-data (literal "/dev/null"))\n(deny file-write* file-link (regex #"${INSTRUCTION_COMPONENT}"))\n${selectors}`;
}

export function createInstructionFence(output){
  const external=verifyInstructionFenceExternal();
  assert.equal(resolve(output),output);assert.match(output,/^\/tmp\/(?:full-gate-unified76|unified76-build-types-review)-[A-Za-z0-9_-]+$/u);
  assert.equal(realpathSync(dirname(output)),'/private/tmp');
  const physicalOutput=join('/private/tmp',basename(output));
  let absent=false;try{lstatSync(physicalOutput);}catch(error){assert.equal(error.code,'ENOENT');absent=true;}assert.equal(absent,true,'output must be fresh, including dangling-link refusal');
  const root=realpathSync(mkdtempSync('/private/tmp/unified76-os-write-'));
  mkdirSync(physicalOutput,{mode:0o700});
  const envelope={schema:'unified76-os-instruction-fence/1',createdAt:new Date().toISOString(),launcherPid:process.pid,roots:[identity(root),identity(physicalOutput)],output,external,stdio:'ignored stdin; stdout/stderr pipes only; no inherited writable regular-file descriptor'};
  for(const name of ['home','tmp'])mkdirSync(join(root,name),{mode:0o700});
  envelope.profileSha256=digest(renderInstructionFence(envelope));
  return envelope;
}

export function validateInstructionFence(envelope,{initial=false}={}){
  assert.equal(envelope.schema,'unified76-os-instruction-fence/1');
  assert.deepEqual(externalBinding(envelope.external),externalBinding(verifyInstructionFenceExternal()));
  assert.equal(envelope.profileSha256,digest(renderInstructionFence(envelope)));
  for(const row of envelope.roots)assert.deepEqual(identity(row.path),row);
  assert.equal(realpathSync(envelope.output),envelope.roots[1].path);
  if(initial){
    assert.deepEqual(readdirSync(envelope.roots[0].path).sort(),['home','tmp']);
    for(const name of ['home','tmp']){identity(join(envelope.roots[0].path,name));assert.deepEqual(readdirSync(join(envelope.roots[0].path,name)),[]);}
    assert.deepEqual(readdirSync(envelope.roots[1].path),[]);
  }
  return envelope;
}

export function instructionFenceInvocation(envelope,executable,args,environment,{preserveEnvironment=false}={}){
  validateInstructionFence(envelope);
  const root=envelope.roots[0].path;
  if(preserveEnvironment)for(const name of ['HOME','TMPDIR','TMP','TEMP']){const path=realpathSync(environment[name]);assert.ok(path===root||path.startsWith(root+'/'),'phase environment must retain its bound owned directory');}
  return{executable:SANDBOX_EXEC,args:['-p',renderInstructionFence(envelope),executable,...args],env:preserveEnvironment?{...environment}:{...environment,HOME:join(root,'home'),TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp')},receipt:{profileSha256:envelope.profileSha256,binary:envelope.external.binary,roots:envelope.roots,stdio:envelope.stdio}};
}
