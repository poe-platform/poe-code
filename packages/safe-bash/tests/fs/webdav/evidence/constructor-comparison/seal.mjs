import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root='/tmp/safe-bash-webdav-constructor-8tiSAh';
const destination='tests/fs/webdav/evidence/constructor-comparison';
assert.ok(!existsSync(destination));
const hash=data=>createHash('sha256').update(data).digest('hex');
const entries=new Map(), encoded=[];
const put=(path,data)=>{
  let bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  const text=bytes.toString('utf8');
  if(!Buffer.from(text).equals(bytes)||(text!==''&&!text.endsWith('\n'))){
    encoded.push({original:path,encoded:path+'.base64',sha256:hash(bytes)});
    path+='.base64';bytes=Buffer.from(bytes.toString('base64')+'\n');
  }
  entries.set(path,bytes);
};
for(const path of ['REPORT.md','run.mjs','seal.mjs'])put(path,readFileSync(join(root,path)));
for(const name of ['safe-bash-sdk-constructor-source-review.txt','safe-bash-sdk-composition-review-aligned.txt'])put(`review/${name}`,readFileSync(join('/tmp',name)));
for(const path of ['src/fs/webdav/README.md','src/fs/webdav/resource-id.ts','src/fs/webdav/webdav.ts','tests/fs/webdav/mock.ts','tests/fs/webdav/operation-authority.test.ts','tests/fs/mount/identity-compatibility-review/compatibility.test.ts'])put(`original/${path}.txt`,readFileSync(join(root,'baseline/archive',path)));
const scratch=mkdtempSync(join(root,'seal-'));
const checkpoints=[];
for(const phase of ['baseline','candidate','corrected','final']){
  const folder=join(root,phase);
  for(const entry of readdirSync(folder,{withFileTypes:true}))if(entry.isFile())put(`${phase}/${entry.name}`,readFileSync(join(folder,entry.name)));
  const manifest=JSON.parse(readFileSync(join(folder,'manifest-before.json')));
  assert.deepEqual(manifest,JSON.parse(readFileSync(join(folder,'manifest-after.json'))));
  const pin=JSON.parse(readFileSync(join(folder,'provenance.json'))).pin;
  let patch='';
  for(const entry of manifest){
    const current=readFileSync(join(folder,'archive',entry.path));
    assert.equal(hash(current),entry.sha256);
    if(!entry.path.startsWith('src/fs/webdav/')&&!entry.path.startsWith('tests/fs/webdav/'))continue;
    const old=spawnSync('git',['show',`${pin}:${entry.path}`],{maxBuffer:16*1024*1024});
    if(old.status===0&&old.stdout.equals(current))continue;
    const before=join(scratch,'before'),after=join(scratch,'after');
    if(old.status===0)writeFileSync(before,old.stdout);
    writeFileSync(after,current);
    const diff=spawnSync('git',['diff','--no-index','--',old.status===0?before:'/dev/null',after],{encoding:'utf8',maxBuffer:16*1024*1024});
    assert.equal(diff.status,1);
    const lines=diff.stdout.split('\n');
    lines[0]=`diff --git a/${entry.path} b/${entry.path}`;
    patch+=lines.map(line=>line.startsWith('--- ')?(old.status===0?`--- a/${entry.path}`:'--- /dev/null'):line.startsWith('+++ ')?`+++ b/${entry.path}`:line).join('\n');
  }
  put(`${phase}/input.patch`,patch);
  const source=manifest.filter(entry=>entry.path.startsWith('src/'));
  const owned=source.filter(entry=>entry.path.startsWith('src/fs/webdav/'));
  checkpoints.push({phase,pin,sourceTreeSha256:hash(JSON.stringify(source)),webdavTreeSha256:hash(JSON.stringify(owned))});
}
const finalArchive=join(root,'final/archive');
const walk=path=>readdirSync(join(finalArchive,path),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]);
const artifacts=[...walk('dist'),...walk('consumer-out')].sort().map(path=>({path,sha256:hash(readFileSync(join(finalArchive,path)))}));
put('checkpoint.json',JSON.stringify({checkpoints,finalBuiltArtifacts:artifacts},null,2)+'\n');
put('encoded-files.json',JSON.stringify(encoded,null,2)+'\n');
put('SHA256SUMS',[...entries].map(([path,data])=>`${hash(data)}  ${path}\n`).join(''));
let patch='*** Begin Patch\n';
for(const [path,data] of entries){const text=data.toString('utf8');patch+=`*** Add File: ${destination}/${path}\n`;if(text)patch+=text.slice(0,-1).split('\n').map(line=>`+${line}\n`).join('');}
patch+='*** End Patch\n';
execFileSync('apply_patch',[],{input:patch,maxBuffer:4*1024*1024});
for(const [path,data] of entries)assert.ok(readFileSync(`${destination}/${path}`).equals(data),path);
console.log(JSON.stringify({files:entries.size,bytes:[...entries.values()].reduce((total,data)=>total+data.length,0),destination}));
