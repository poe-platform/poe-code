import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,cpSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const directory=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(directory,'../../../..');
export const candidate=JSON.parse(readFileSync(join(directory,'CANDIDATE.json')));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const git=(args,options={})=>execFileSync('git',['--no-replace-objects',...args],{cwd:repository,maxBuffer:32*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},...options});
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
  for(const entry of selected){assert.ok(['100644','100755'].includes(entry.mode));const target=join(root,entry.path);mkdirSync(dirname(target),{recursive:true});const bytes=blob(entry.path,revision);writeFileSync(target,bytes,{flag:'wx'});chmodSync(target,entry.mode==='100755'?0o755:0o644);entry.sha256=sha(bytes);}
  return selected;
}
export function copyDependencies(destination,origin=join(repository,'node_modules')) {
  const visit=(source,target)=>{
    for(const name of readdirSync(source).sort()){
      const from=join(source,name),to=join(target,name),stat=lstatSync(from);
      if(name==='.bin')continue;
      assert.equal(stat.isSymbolicLink(),false,from);
      if(stat.isDirectory()){mkdirSync(to,{recursive:true});visit(from,to);}else{assert.ok(stat.isFile());cpSync(from,to);assert.equal(sha(readFileSync(to)),sha(readFileSync(from)));}
    }
  };
  mkdirSync(destination,{recursive:true});visit(origin,destination);
  mkdirSync(join(destination,'.bin'));
  for(const name of readdirSync(join(origin,'.bin')).sort()){
    const target=realpathSync(join(origin,'.bin',name));assert.ok(target.startsWith(origin+'/'));
    const installed=join(destination,relative(origin,target));assert.ok(lstatSync(installed).isFile());
    const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    writeFileSync(join(destination,'.bin',name),'#!/bin/sh\nexec '+quote(installed)+' "$@"\n',{mode:0o755});
  }
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
