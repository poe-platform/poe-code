import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { git, sha256 } from './replay/review.mjs';

export function inventory(directory,prefix='') {
  return readdirSync(directory).sort().flatMap(name=>{
    const path=join(directory,name),relative=prefix?`${prefix}/${name}`:name,stat=lstatSync(path);
    if(stat.isDirectory())return inventory(path,relative);
    const bytes=stat.isSymbolicLink()?Buffer.from(readlinkSync(path)):readFileSync(path);
    return [{path:relative,kind:stat.isSymbolicLink()?'symlink':'file',sha256:sha256(bytes),gitBlob:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}];
  });
}
export function authenticateSourceTests(stage) {
  const actual=['src','tests'].flatMap(path=>inventory(join(stage.source,path),path)).sort((left,right)=>left.path.localeCompare(right.path,'en'));
  const expected=git('ls-tree','-r','-z',stage.commit,'--','src','tests').toString().split('\0').filter(Boolean).map(line=>{
    const separator=line.indexOf('\t'),metadata=line.slice(0,separator),path=line.slice(separator+1),[mode,,gitBlob]=metadata.split(' ');
    return {path,kind:mode==='120000'?'symlink':'file',gitBlob};
  }).sort((left,right)=>left.path.localeCompare(right.path,'en'));
  assert.deepEqual(actual.map(({sha256:unused,...entry})=>entry),expected,'src/tests original and added entries differ from immutable Git candidate');
  return actual;
}
