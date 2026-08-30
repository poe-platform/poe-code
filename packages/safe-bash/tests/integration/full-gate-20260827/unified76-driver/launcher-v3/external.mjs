import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {lstat,readdir,readlink,realpath,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {PRODUCT,BOUNDS,enforceCharge} from './policy.mjs';
import {inspectLinkage} from './tool-routing.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function fileIdentity(path) {
  const physical=await realpath(path),before=await lstat(physical);
  assert.ok(before.isFile());assert.ok(before.size <= BOUNDS.dependencyBytes);
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(physical,{highWaterMark:BOUNDS.chunkBytes})){bytes=enforceCharge(bytes,chunk.length,before.size);digest.update(chunk);}
  const after=await lstat(physical);assert.equal(bytes,before.size);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.mode,before.mode);
  return{origin:path,physical,bytes,mode:before.mode&0o777,sha256:digest.digest('hex')};
}

export async function directoryIdentity(origin) {
  const root=await realpath(origin),entries=[];let bytes=0;
  const visit=async local=>{
    enforceCharge(entries.length,1,50000);
    const path=join(root,local),stat=await lstat(path);
    if(stat.isSymbolicLink()){
      const target=await readlink(path),physical=await realpath(path),targetStat=await lstat(physical);
      entries.push({path:local,kind:'symlink',mode:stat.mode&0o777,target,physical,insideOrigin:physical===root||physical.startsWith(root+'/'),targetFile:targetStat.isFile()?await fileIdentity(path):null});
    }else if(stat.isDirectory()){
      entries.push({path:local,kind:'directory',mode:stat.mode&0o777});
      for(const name of(await readdir(path)).sort())await visit(local==='.'?name:local+'/'+name);
    }else{
      assert.ok(stat.isFile());bytes=enforceCharge(bytes,stat.size,BOUNDS.dependencyBytes);
      entries.push({path:local,kind:'file',...await fileIdentity(path)});
    }
  };
  await visit('.');return{origin,root,entries,bytes,sha256:hash(JSON.stringify(entries))};
}

export async function captureExternal() {
  const directory=dirname(fileURLToPath(import.meta.url)),repository=resolve(directory,'../../../../..');
  const profile=JSON.parse(gunzipSync(Buffer.from((await readFile(join(directory,'PROFILE.json.gz.base64'),'utf8')).trim(),'base64')));
  assert.equal(profile.candidate,PRODUCT);
  const preflightPath=join(repository,'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs');
  assert.equal(hash(await readFile(preflightPath)),profile.support['tests/integration/full-gate-20260827/preflight-repair/preflight.mjs']);
  const {assessNative}=await import(pathToFileURL(preflightPath));
  const native=assessNative(profile.native,repository,{RG_NATIVE_BIN:'/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-rg-recovered-gsSpuz/rg',TREE_NATIVE_BIN:'/tmp/safe-bash-tree-external-oracle-TbVJVK/tree'});
  assert.deepEqual(native.issues,[]);assert.equal(native.assets.length,51);
  const directories={};
  for(const[name,origin]of Object.entries({main:join(repository,'node_modules'),benchmarks:join(repository,'benchmarks/node_modules'),npm:'/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm',gitCore:'/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core'}))directories[name]=await directoryIdentity(origin);
  const origins=[...new Set(['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node','/usr/bin/git','/Applications/Xcode.app/Contents/Developer/usr/bin/git','/bin/sh','/usr/bin/tar','/bin/ps','/usr/sbin/lsof','/usr/bin/otool','/usr/bin/sw_vers',...native.assets.map(asset=>asset.origin)])];
  const tools=[];for(const origin of origins)tools.push(await fileIdentity(origin));
  const host=spawnSync('/usr/bin/sw_vers',[],{encoding:'utf8',timeout:10000,maxBuffer:BOUNDS.setupStderrBytes});assert.equal(host.status,0);assert.equal(host.signal,null);
  const linkage=[];
  for(const origin of ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/Applications/Xcode.app/Contents/Developer/usr/bin/git','/usr/bin/tar']){
    const result=inspectLinkage(origin);
    const dependencies=[];
    for(const line of result.stdout.split('\n').slice(1).filter(line=>line.trim())){
      const path=line.trim().split(' (compatibility version ')[0];
      try{dependencies.push({path,identity:await fileIdentity(path)});}catch(error){dependencies.push({path,identity:null,error:error.code??error.message});}
    }
    linkage.push({origin,stdout:result.stdout,stderr:result.stderr,dependencies});
  }
  return{schema:3,capturedAt:new Date().toISOString(),candidate:PRODUCT,native,directories,tools,host:{stdout:host.stdout,stderr:host.stderr,platform:process.platform,arch:process.arch},linkage,bindingComplete:false,qualification:'Readable external code trees and tools are byte-bound observations; native linkage sampling is incomplete and OS-resident library bytes are not authenticated. No gate acceptance or approved trusted-OS boundary is inferred.',fullGateLaunched:false};
}

if(import.meta.main){
  assert.deepEqual(process.argv.slice(2),['--capture']);
  const output=await mkdtemp(join(tmpdir(),'unified76-external-v3-'));
  const report=await captureExternal();await writeFile(join(output,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,candidate:PRODUCT,directories:Object.fromEntries(Object.entries(report.directories).map(([name,value])=>[name,{entries:value.entries.length,bytes:value.bytes,sha256:value.sha256}])),tools:report.tools.length,native:report.native.assets.length,bindingComplete:false,fullGateLaunched:false}));
}
