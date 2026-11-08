import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(root,'acquisition.capture.data'),'wx',0o600);
const emit=value=>fs.writeSync(capture,JSON.stringify(value)+'\n');
const roles=[['v3-source','4eea354169492b4c47d373d504e5918e1c4f3830','functional-reference-v3'],['v3-evidence','73065e68469e2e514c0ee87ff34ac1db04ba51cb','functional-reference-v3'],['v2-source','a5fd225af5f9985ae805f48ab1b1790a9c3fbc7f','functional-reference-v2']];
let total=0;
const git=(args,input)=>{
  emit({event:'start',args});
  const result=spawnSync('/usr/bin/git',args,{cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',HOME:root},input,timeout:10000,maxBuffer:16777216});
  emit({event:'retired',pid:result.pid,status:result.status,signal:result.signal,stderr:result.stderr?.toString()});
  assert.equal(result.status,0);assert.equal(result.signal,null);return result.stdout;
};
try{
  emit({event:'begin',at:new Date().toISOString(),role:'SOURCE/DATA'});
  for(const [label,commit,suffix] of roles){
    const prefix='tests/compatibility/bash-surface-independent-20260829/'+suffix+'/';
    const directory=path.join(root,label);fs.mkdirSync(directory);
    const inventory=git(['ls-tree','-r','-z',commit,'--',prefix]);fs.writeFileSync(path.join(directory,'inventory.data'),inventory,{flag:'wx',mode:0o600});
    const rows=inventory.toString().split('\0').filter(Boolean).map(text=>{
      const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(text);assert.ok(match);return{mode:match[1],blob:match[2],path:match[3]};
    }).filter(row=>!row.path.slice(prefix.length).includes('/')&&/\.(md|json|mjs|sh|zsh)$/.test(row.path)&&!/(^|\/)(AGENTS|ROOT-GO|ROOT-GRANT|GO)\./.test(row.path));
    assert.ok(rows.length>0&&rows.length<=64);
    const body=git(['cat-file','--batch'],rows.map(row=>row.blob).join('\n')+'\n');
    let offset=0;
    for(const row of rows){
      const newline=body.indexOf(10,offset);const [blob,type,length]=body.subarray(offset,newline).toString().split(' ');const size=Number(length);
      assert.equal(blob,row.blob);assert.equal(type,'blob');assert.ok(Number.isSafeInteger(size)&&size>=0&&size<=4194304);
      const bytes=body.subarray(newline+1,newline+1+size);assert.equal(bytes.length,size);assert.equal(body[newline+1+size],10);
      assert.equal(crypto.createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex'),blob);
      total+=size;assert.ok(total<=16777216);row.bytes=size;row.sha256=crypto.createHash('sha256').update(bytes).digest('hex');row.capture=path.basename(row.path)+'.data';
      fs.writeFileSync(path.join(directory,row.capture),bytes,{flag:'wx',mode:0o600});offset=newline+size+2;
    }
    assert.equal(offset,body.length);
    fs.writeFileSync(path.join(directory,'MANIFEST.json'),JSON.stringify({commit,role:'inert source/data; not launch authority',rows},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({label,files:rows.map(row=>({name:row.capture,bytes:row.bytes,sha256:row.sha256}))}));
  }
  emit({event:'complete',total});
}catch(error){emit({event:'failure',error:String(error?.stack??error)});process.exitCode=1;}
finally{fs.fsyncSync(capture);fs.closeSync(capture);}
