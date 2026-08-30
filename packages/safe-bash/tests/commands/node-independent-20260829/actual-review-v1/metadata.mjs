import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const own=dirname(fileURLToPath(import.meta.url));
const root='/Users/kjopek/Workspace/safe-bash';
const commits=new Set(['a2f3983da537b95bed65b8bc727ab93bc7e98ca3','af66b7748af06319751b6cf87acacbe43acc48fd','68b273d343103a1d82f80d4989a87dcca29f2564','ee150ba1d2c9165118310d78de8d6453020b9271','797aa13996f04a332f37a84888d151f2352efee9','f2248c3218ca977ce8550705ee9247c9514745a1']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(let path=own;path!=='/';path=dirname(path))if(lstatSync(path).isSymbolicLink())throw Error('symlink scope');
const [mode,label,...args]=process.argv.slice(2);
if(!['inventory','batch'].includes(mode)||!/^m\d\d$/.test(label??''))throw Error('metadata admission');
let command,input;
if(mode==='inventory'){
  const [commit,prefix]=args;
  if(!commits.has(commit)||!prefix.startsWith('tests/commands/node-author-20260829'))throw Error('inventory admission');
  command=['ls-tree','-rz',commit,'--',prefix];
}else{
  const specPath=resolve(own,args[0]??'');
  if(dirname(specPath)!==own||!specPath.endsWith('.json')||!lstatSync(specPath).isFile()||lstatSync(specPath).size>65536)throw Error('spec input');
  const specs=JSON.parse(readFileSync(specPath,'utf8'));
  if(!Array.isArray(specs)||specs.length>160||specs.some(spec=>typeof spec!=='string'||!commits.has(spec.slice(0,40))||!/^.{40}:(src\/commands\/node\/|tests\/commands\/node-(author|independent)-20260829\/)/.test(spec)||spec.includes('AGENTS')))throw Error('batch admission');
  input=specs.join('\n')+'\n';command=['cat-file','--batch'];
}
const started=Date.now();
const child=spawnSync('/usr/bin/git',command,{cwd:root,input,encoding:null,maxBuffer:64*1024*1024,timeout:30000,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_OPTIONAL_LOCKS:'0'}});
const raw={mode,command,started,ended:Date.now(),status:child.status,signal:child.signal,error:child.error?String(child.error):null,stdout:child.stdout?.toString('base64')??null,stderr:child.stderr?.toString('base64')??null};
writeFileSync(resolve(own,label+'-RAW.json.gz.base64'),gzipSync(Buffer.from(JSON.stringify(raw))).toString('base64')+'\n',{flag:'wx'});
if(child.error||child.signal||child.status!==0||child.stderr.length)throw child.error??Error('metadata failure');
if(mode==='inventory'){
  const rows=child.stdout.toString('utf8').split('\0');if(rows.pop()!=='')throw Error('inventory terminator');
  const entries=rows.map(row=>{const split=row.indexOf('\t');const [mode,type,oid]=row.slice(0,split).split(' ');if(split<1||type!=='blob'||!['100644','100755'].includes(mode))throw Error('inventory mode');return{path:row.slice(split+1),mode,oid};});
  writeFileSync(resolve(own,label+'-INVENTORY.json'),JSON.stringify(entries,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({label,entries:entries.length,child:'natural-close'}));
}else{
  let offset=0;const entries=[];
  for(const spec of input.trimEnd().split('\n')){
    const end=child.stdout.indexOf(10,offset);const [oid,type,sizeText]=child.stdout.subarray(offset,end).toString('ascii').split(' ');const size=Number(sizeText);if(end<offset||type!=='blob'||!Number.isSafeInteger(size)||size<0||size>32*1024*1024)throw Error('blob admission '+spec);offset=end+1;
    const bytes=child.stdout.subarray(offset,offset+size);offset+=size;if(bytes.length!==size||child.stdout[offset++]!==10||createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex')!==oid)throw Error('blob integrity');
    entries.push({spec,oid,bytes:size,sha256:hash(bytes),body:bytes.toString('base64')});
  }
  if(offset!==child.stdout.length)throw Error('trailing batch data');
  const data=gzipSync(Buffer.from(JSON.stringify(entries)),{level:9});
  writeFileSync(resolve(own,label+'-INPUTS.json.gz.base64'),data.toString('base64')+'\n',{flag:'wx'});
  writeFileSync(resolve(own,label+'-MANIFEST.json'),JSON.stringify({sha256:hash(data),entries:entries.map(({body,...entry})=>entry)},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({label,entries:entries.length,bytes:entries.reduce((sum,x)=>sum+x.bytes,0),archive:hash(data),child:'natural-close'}));
}
