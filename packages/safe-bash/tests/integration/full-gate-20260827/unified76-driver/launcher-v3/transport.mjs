import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,open,symlink} from 'node:fs/promises';
import {dirname,join,posix} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {BOUNDS,enforceCharge} from './policy.mjs';
import {selectProjection,projectionReceipt,assertLinkProjection} from './projection.mjs';

export const ARCHIVE_PATH_PROFILE=Object.freeze({platform:'darwin',arch:'arm64',syntax:'posix',separator:'/'});

export function cleanGitEnvironment(environment){
  const result=Object.fromEntries(Object.entries(environment).filter(([key])=>!key.startsWith('GIT_')));
  return{...result,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null'};
}
export function validateEntries(entries,bounds=BOUNDS,pathProfile=ARCHIVE_PATH_PROFILE){
  assert.deepEqual(pathProfile,ARCHIVE_PATH_PROFILE,'only the pinned POSIX archive path profile is supported');
  assert.equal(process.platform,pathProfile.platform,'archive extraction host is outside the pinned POSIX profile');
  assert.equal(process.arch,pathProfile.arch,'archive extraction architecture is outside the pinned profile');
  assert.equal(entries.length,bounds.archiveEntries);const seen=new Set();let bytes=0;
  for(const entry of entries){
    assert.ok(typeof entry.path==='string'&&entry.path.length>0&&!entry.path.includes('\0'));
    assert.ok(!posix.isAbsolute(entry.path)&&entry.path===posix.normalize(entry.path)&&!entry.path.split('/').some(part=>part==='..'||part==='.git'));
    assert.ok(!seen.has(entry.path));seen.add(entry.path);assert.ok(['100644','100755','120000'].includes(entry.mode));assert.match(entry.blob,/^[a-f0-9]{40}$/u);
    bytes=enforceCharge(bytes,entry.bytes,bounds.archiveBytes);
  }
  const links=new Set(entries.filter(entry=>entry.mode==='120000').map(entry=>entry.path));
  for(const entry of entries){let parent=posix.dirname(entry.path);while(parent!=='.'){assert.ok(!links.has(parent),'symlink ancestor is not an extraction directory');parent=posix.dirname(parent);}}
  assert.equal(bytes,bounds.archiveBytes);return{entries:entries.length,bytes};
}
function groupMembers(pid){
  return execFileSync('/bin/ps',['-axo','pid=,pgid='],{encoding:'utf8',timeout:2000,maxBuffer:BOUNDS.setupStderrBytes}).split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/u).map(Number)).filter(row=>row[1]===pid).map(row=>row[0]);
}
function managed(command,args,options){
  const {observer,...spawnOptions}=options;
  const child=spawn(command,args,{...spawnOptions,detached:true,stdio:['pipe','pipe','pipe']});let stderrBytes=0,stderr='',failure,closed=false;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')failure??=error;}};
  const done=new Promise(resolve=>{child.once('error',error=>{failure=error;});child.once('close',(status,signal)=>{closed=true;resolve({status,signal});});});
  child.stderr.on('data',chunk=>{try{stderrBytes=enforceCharge(stderrBytes,chunk.length,BOUNDS.setupStderrBytes);stderr+=chunk.toString();}catch(error){failure=error;kill();}});
  const timer=setTimeout(()=>{failure=new Error('bounded setup deadline exceeded');kill();},BOUNDS.setupTimeoutMs);
  const ready=observer?observer.register(child.pid):Promise.resolve(undefined);
  ready.catch(()=>{kill();});
  const observedMembers=async()=>observer?observer.members(await ready):child.pid?groupMembers(child.pid):[];
  const finish=async()=>{
    const result=await done;clearTimeout(timer);let survivors=await observedMembers();
    if(survivors.length){failure??=new Error('setup left descendants');kill();const deadline=Date.now()+BOUNDS.cleanupTimeoutMs;while(survivors.length&&Date.now()<deadline){await delay(25);survivors=await observedMembers();}}
    assert.equal(closed,true);assert.equal(survivors.length,0,'setup descendants unreaped');if(failure)throw failure;
    assert.equal(result.signal,null);assert.equal(result.status,0,stderr);return{...result,closed,stderrBytes,survivors};
  };
  return{child,done,kill,finish,ready};
}
class Reader{
  constructor(stream){this.iterator=stream[Symbol.asyncIterator]();this.chunk=Buffer.alloc(0);this.offset=0;this.transferred=0;}
  async take(maximum){
    if(this.offset===this.chunk.length){const next=await this.iterator.next();if(next.done)throw Error('truncated Git blob stream');this.chunk=next.value;this.offset=0;this.transferred=enforceCharge(this.transferred,this.chunk.length,BOUNDS.archiveTransferBytes);}
    const count=Math.min(maximum,this.chunk.length-this.offset,BOUNDS.chunkBytes),bytes=this.chunk.subarray(this.offset,this.offset+count);this.offset+=count;return bytes;
  }
  async line(){const bytes=[];for(let count=0;count<256;count++){const byte=(await this.take(1))[0];if(byte===10)return Buffer.from(bytes).toString();bytes.push(byte);}throw Error('oversized Git batch header');}
  async end(){assert.equal(this.offset,this.chunk.length,'unexpected buffered Git output');assert.equal((await this.iterator.next()).done,true,'unexpected trailing Git output');}
}
export async function extractCommitted({git,repository,candidate,entries,destination,environment,bounds=BOUNDS,observer,pathProfile=ARCHIVE_PATH_PROFILE}){
  validateEntries(entries,bounds,pathProfile);
  const metadataOnly=new Map(selectProjection(entries,candidate).map(entry=>[entry.path,entry]));
  const process=managed(git,['--no-replace-objects','cat-file','--batch'],{cwd:repository,env:cleanGitEnvironment(environment),observer});
  const reader=new Reader(process.child.stdout);const hashes={};let written=0;
  try{
    await process.ready;
    for(const entry of entries){
      process.child.stdin.write(entry.blob+'\n');assert.equal(await reader.line(),`${entry.blob} blob ${entry.bytes}`);
      const omitted=metadataOnly.get(entry.path),target=join(destination,entry.path);if(!omitted)await mkdir(dirname(target),{recursive:true});
      const digest=createHash('sha1').update(`blob ${entry.bytes}\0`),sha256=createHash('sha256');let remaining=entry.bytes;
      const chunks=[];const file=omitted||entry.mode==='120000'?null:await open(target,'wx',Number.parseInt(entry.mode.slice(-3),8));
      if(!file&&!omitted)assert.ok(entry.bytes<=4096,'bounded symlink target');
      try{while(remaining){const bytes=await reader.take(remaining);digest.update(bytes);sha256.update(bytes);written=enforceCharge(written,bytes.length,bounds.archiveBytes);remaining-=bytes.length;if(file){let offset=0;while(offset<bytes.length){const result=await file.write(bytes,offset,bytes.length-offset);assert.ok(result.bytesWritten>0);offset+=result.bytesWritten;}}else if(!omitted)chunks.push(Buffer.from(bytes));}}
      finally{await file?.close();}
      assert.equal((await reader.take(1))[0],10);assert.equal(digest.digest('hex'),entry.blob,'Git content/hash mismatch');
      if(!file&&!omitted){const link=Buffer.concat(chunks).toString(),normalized=posix.normalize(posix.join(posix.dirname(entry.path),link));assert.ok(!posix.isAbsolute(link)&&normalized!=='..'&&!normalized.startsWith('../')&&!link.includes('\0'));assertLinkProjection(entry.path,link);await symlink(link,target);}
      hashes[entry.path]=sha256.digest('hex');
      if(omitted)assert.equal(hashes[entry.path],omitted.sha256,'instruction content SHA256 mismatch');
    }
    process.child.stdin.end();await reader.end();const lifecycle=await process.finish();return{...lifecycle,entries:entries.length,bytes:written,transferBytes:reader.transferred,hashes,projection:projectionReceipt(entries,candidate,hashes),method:'All original logical Git blobs streamed and authenticated; exactly pinned instruction bodies hash-discarded without plaintext files; remaining entries extracted without filters'};
  }catch(error){process.kill();process.child.stdin.destroy();process.child.stdout.destroy();await process.finish().catch(()=>{});throw error;}
}
export async function transferHistory({git,repository,candidate,destination,environment,observer}){
  const env=cleanGitEnvironment(environment),producer=managed(git,['--no-replace-objects','pack-objects','--stdout','--revs'],{cwd:repository,env,observer}),consumer=managed(git,['--no-replace-objects','--git-dir',join(destination,'.git'),'index-pack','--stdin'],{cwd:repository,env,observer});
  let bytes=0,stdout=0;consumer.child.stdout.on('data',chunk=>{try{stdout=enforceCharge(stdout,chunk.length,BOUNDS.setupStderrBytes);}catch{producer.kill();consumer.kill();}});
  const charge=new Transform({transform(chunk,encoding,callback){try{bytes=enforceCharge(bytes,chunk.length,BOUNDS.historyTransferBytes);callback(null,chunk);}catch(error){callback(error);}}});
  try{await Promise.all([producer.ready,consumer.ready]);producer.child.stdin.end(candidate+'\n');await pipeline(producer.child.stdout,charge,consumer.child.stdin);const lifecycle=await Promise.all([producer.finish(),consumer.finish()]);return{bytes,stdout,lifecycle,instructionPolicy:'Root-approved original opaque Git objects only; historical instruction blobs remain inert provenance. No checkout or plaintext instruction materialization.',checkoutPerformed:false};}
  catch(error){producer.kill();consumer.kill();await Promise.allSettled([producer.finish(),consumer.finish()]);throw error;}
}
