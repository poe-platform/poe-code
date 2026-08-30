import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,cpSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanGitEnvironment} from './transport.mjs';
import {dependencyProjection,hashRegularFile,instructionName,readProjection} from './projection.mjs';
import {BOUNDS,enforceCharge} from './policy.mjs';

export const directory=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(directory,'../../../../..');
export const candidate=JSON.parse(readFileSync(join(directory,'CANDIDATE.json')));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const git=(args,options={})=>execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',['--no-replace-objects',...args],{cwd:repository,timeout:600000,maxBuffer:32*1024*1024,env:cleanGitEnvironment(process.env),...options});
export const text=args=>git(args).toString().trim();
export const blob=(path,revision=candidate.candidate)=>git(['show',`${revision}:${path}`]);
export const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export const node24='/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
export const npm='/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
export function entries(revision=candidate.candidate) {
  return git(['ls-tree','-rlz',revision]).toString().split('\0').filter(Boolean).map(row=>{
    const split=row.indexOf('\t'),[mode,type,object,size]=row.slice(0,split).trim().split(/\s+/u);
    assert.equal(type,'blob');return{path:row.slice(split+1),mode,blob:object,bytes:Number(size)};
  });
}
export function copySelection(root,paths,revision=candidate.candidate) {
  const selected=entries(revision).filter(entry=>paths.some(path=>entry.path===path||entry.path.startsWith(path+'/')));
  const instructionBlobs=new Set(readProjection().candidateEntries.map(entry=>entry.blob));
  assert.ok(selected.every(entry=>!instructionName(entry.path)&&!instructionBlobs.has(entry.blob)),'selected copy may not materialize instruction paths or aliases');
  for(const entry of selected){assert.ok(['100644','100755'].includes(entry.mode));const target=join(root,entry.path);mkdirSync(dirname(target),{recursive:true});const bytes=blob(entry.path,revision);writeFileSync(target,bytes,{flag:'wx'});chmodSync(target,entry.mode==='100755'?0o755:0o644);entry.sha256=sha(bytes);}
  return selected;
}
export function copyDependencies(destination,origin=join(repository,'node_modules')) {
  assert.equal(realpathSync(origin),origin,'dependency origin must use its exact authenticated path');
  const original=[],directories=[];let total=0;
  const inspect=(source,prefix='')=>{
    for(const name of readdirSync(source).sort()){
      const from=join(source,name),path=prefix?prefix+'/'+name:name,stat=lstatSync(from);
      if(name==='.bin')continue;
      assert.equal(stat.isSymbolicLink(),false,from);
      if(stat.isDirectory()){assert.ok(!instructionName(path),'instruction-named dependency directory');directories.push(path);inspect(from,path);}else{const identity=hashRegularFile(from);total=enforceCharge(total,identity.bytes,BOUNDS.dependencyBytes);original.push({path,...identity});}
    }
  };
  inspect(origin);
  const metadataOnly=dependencyProjection(original,origin),omitted=new Set(metadataOnly.map(entry=>entry.path)),physical=original.filter(entry=>!omitted.has(entry.path));
  mkdirSync(destination,{recursive:true});for(const path of directories)mkdirSync(join(destination,path));
  for(const entry of physical){const from=join(origin,entry.path),to=join(destination,entry.path);cpSync(from,to);const expected={mode:entry.mode,bytes:entry.bytes,sha256:entry.sha256};assert.deepEqual(hashRegularFile(to),expected,'dependency copy identity');assert.deepEqual(hashRegularFile(from),expected,'dependency changed after preflight');}
  mkdirSync(join(destination,'.bin'));
  for(const name of readdirSync(join(origin,'.bin')).sort()){
    const target=realpathSync(join(origin,'.bin',name));assert.ok(target.startsWith(origin+'/'));
    const installed=join(destination,relative(origin,target));assert.ok(lstatSync(installed).isFile());
    const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    writeFileSync(join(destination,'.bin',name),'#!/bin/sh\nexec '+quote(installed)+' "$@"\n',{mode:0o755});
  }
  for(const entry of metadataOnly)assert.deepEqual(hashRegularFile(join(origin,entry.path)),{mode:0o644,bytes:entry.bytes,sha256:entry.sha256},'metadata-only dependency changed after preflight');
  return{origin,logical:{files:original.length,bytes:total,sha256:sha(JSON.stringify(original))},physical:{files:physical.length,bytes:physical.reduce((sum,entry)=>sum+entry.bytes,0),sha256:sha(JSON.stringify(physical))},metadataOnly,qualification:'Original dependency bodies hash-authenticated; exact declared metadata-only omission; .bin wrappers retain existing separate setup policy'};
}
export function verifyAssembly(receipt=candidate) {
  assert.equal(text(['rev-parse',`${receipt.base}:src`]),receipt.sourceTree);
  assert.equal(text(['rev-parse',`${receipt.candidate}:src`]),receipt.sourceTree);
  assert.equal(text(['rev-parse',`${receipt.candidate}^{tree}`]),receipt.tree);
  assert.deepEqual(text(['show','-s','--format=%P',receipt.candidate]),receipt.base);
  assert.deepEqual(text(['diff','--name-only',receipt.base,receipt.candidate]).split('\n').sort(),receipt.changes.map(entry=>entry.path).sort());
  const raw=Buffer.from(receipt.rawCommitBase64,'base64');assert.equal(sha(raw),receipt.rawCommitSha256);assert.deepEqual(raw,git(['cat-file','commit',receipt.candidate]));
  for(const entry of receipt.changes){let expected=blob(entry.path,receipt.base).toString();assert.equal(sha(expected),entry.beforeSha256);for(const[from,to,count=1]of entry.replacements){assert.equal(expected.split(from).length-1,count);expected=expected.replaceAll(from,to);}assert.equal(sha(expected),entry.afterSha256);assert.deepEqual(Buffer.from(expected),blob(entry.path));assert.deepEqual(blob(entry.path,receipt.fixtureSourceCommit),blob(entry.path));}
  return{candidate:receipt.candidate,tree:receipt.tree,sourceTree:receipt.sourceTree,paths:receipt.changes.length};
}
