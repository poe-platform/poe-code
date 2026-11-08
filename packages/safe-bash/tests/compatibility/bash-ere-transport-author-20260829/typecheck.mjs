import { open, lstat, readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const own=dirname(fileURLToPath(import.meta.url)), root=resolve(own,'../../..');
const phase=process.argv[2], label=process.argv[3];
const valid=phase==='seal'||(phase==='types'&&/^TYPE-0[1-2]$/.test(label??''));
if(!valid)throw new Error('exact seal/types interface required');
const output=phase==='seal'?own:join(own,label);
if(phase!=='seal')await mkdir(output);
const outer=await open(join(output,phase==='seal'?'SEAL.outer.jsonl':'OUTER.jsonl'),'wx');
const begun=Date.now(), deadline=begun+600000, children=[], result={ phase, started:new Date(begun).toISOString(), pid:process.pid, children, runtimeImports:0, workers:0, native:0 };
await outer.write(JSON.stringify(result)+'\n');
let captured=0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function info(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw new Error('regular bounded input required: '+path);const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){size+=chunk.length;if(size>stat.size)throw new Error('input grew');hash.update(chunk);}if(size!==stat.size)throw new Error('input size drift');return{path,size,mode:stat.mode&511,sha256:hash.digest('hex')};}
async function verify(row){const actual=await info(row.path);if(actual.size!==row.size||actual.mode!==row.mode||actual.sha256!==row.sha256)throw new Error('input integrity: '+row.path);return actual;}
async function text(path,max=8*1024*1024){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('text admission');return readFile(path,'utf8');}
async function census(path){const rows=[];async function visit(dir){for(const name of (await readdir(dir)).sort()){const path=join(dir,name),stat=await lstat(path);if(stat.isSymbolicLink())throw new Error('unexpected linked output');if(stat.isDirectory())await visit(path);else rows.push(await info(path));}}await visit(path);return rows;}
async function execute(node,args,cwd,name,timeout){
  if(children.length>=6||Date.now()>=deadline)throw new Error('compiler budget');
  const stdout=await open(join(output,name+'.stdout'),'wx'),stderr=await open(join(output,name+'.stderr'),'wx');
  let child;const receipt={name,args,cwd,started:Date.now(),pid:null,closed:false,code:null,signal:null};
  const chunks=[];
  try{
    child=spawn(node,args,{cwd,env:{PATH:dirname(node),LANG:'C',LC_ALL:'C',HOME:output,TMPDIR:output},stdio:['ignore','pipe','pipe']});
    children.push(receipt);receipt.pid=child.pid??null;
    const closed=new Promise(resolveClose=>{child.once('error',error=>{receipt.error=String(error);});child.once('close',(code,signal)=>{receipt.closed=true;receipt.code=code;receipt.signal=signal;resolveClose();});});
    let fault;let writing=Promise.resolve();
    const accept=(target,chunk)=>{captured+=chunk.length;if(captured>32*1024*1024){fault=new Error('capture cap');child.kill('SIGKILL');return;}chunks.push(chunk);writing=writing.then(()=>target.write(chunk)).catch(error=>{fault=error;child.kill('SIGKILL');});};
    child.stdout.on('data',chunk=>accept(stdout,chunk));child.stderr.on('data',chunk=>accept(stderr,chunk));
    const timer=setTimeout(()=>{fault=new Error('compiler deadline');child.kill('SIGKILL');},Math.min(timeout,deadline-Date.now()));
    await closed;clearTimeout(timer);await writing;receipt.elapsedMs=Date.now()-receipt.started;
    await outer.write(JSON.stringify(receipt)+'\n');if(fault)throw fault;if(receipt.error||receipt.signal)throw new Error('compiler lifecycle failure');
    return{receipt,text:Buffer.concat(chunks).toString('utf8')};
  }finally{await stdout.close();await stderr.close();}
}
try{
  const previousPath=join(root,'tests/compatibility/bash-ere-engine-author-20260829/r02-v2/SEAL.json');
  const previousText=await text(previousPath);
  if(sha(previousText)!=='4f6d24661fc75ab4f2bc26836a735f998a88591caf377fddff36f45709799b12')throw new Error('provisional engine seal mismatch');
  const previous=JSON.parse(previousText);
  if(phase==='seal'){
    const transportDir=join(root,'src/commands/regex-execution/ere/transport');
    const names=['accounting.ts','owner.ts','protocol.ts','root.ts','validation.ts','wire-engine.ts','worker-entry.ts'];
    if(JSON.stringify((await readdir(transportDir)).sort())!==JSON.stringify(names))throw new Error('unexpected transport membership');
    const sources=[];for(const row of previous.sources)sources.push(await verify(row));for(const name of names)sources.push(await info(join(transportDir,name)));
    const fixtures=[];for(const name of ['consumer.mts','negative.mts','PRESEAL.md','typecheck.mjs'])fixtures.push(await info(join(own,name)));
    const design=[];for(const name of ['README.md','DECISIONS-v2.md','ROOT-RATIFICATION-v1.md','INTERFACE.md','VALIDATION.json'])design.push(await info(join(root,'tests/compatibility/bash-ere-transport-design-20260829',name)));
    const tools=[];for(const row of previous.tools)tools.push(await verify(row));await verify(previous.node);
    const seal={ schema:'private-ere-transport-type-only-v1',baseline:previous.baseline,engine:'b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb',sources,fixtures,design,node:previous.node,tools,compiler:previous.compiler,flags:previous.tscFlags,expectedCompilerProcesses:3,maximumCompilerProcesses:6,runtimeVariants:'32 families / 60 variants ALL UNRUN',compressedInputs:0,negativeCodes:[2353,2322,2345] };
    await writeFile(join(own,'SEAL.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx'});result.sealSha256=sha(await readFile(join(own,'SEAL.json')));result.sources=sources.length;result.tools=tools.length;
  }else{
    const seal=JSON.parse(await text(join(own,'SEAL.json')));
    for(const row of [seal.node,...seal.sources,...seal.fixtures,...seal.design,...seal.tools])await verify(row);
    if(process.execPath!==seal.node.path)throw new Error('wrong coordinator binary');
    const work=join(output,'work');await mkdir(work);
    await writeFile(join(work,'package.json'),'{"type":"module"}\n',{flag:'wx'});
    const source=join(work,'source'),emitted=join(work,'emitted');await mkdir(source);
    for(const row of seal.sources){const target=join(source,relative(join(root,'src/commands/regex-execution/ere'),row.path));await mkdir(dirname(target),{recursive:true});await copyFile(row.path,target);const actual=await info(target);if(actual.sha256!==row.sha256)throw new Error('source copy mismatch');}
    const toolRoot=join(work,'node_modules');
    for(const row of seal.tools){const target=join(toolRoot,relative(join(root,'node_modules'),row.path));await mkdir(dirname(target),{recursive:true});await copyFile(row.path,target);const actual=await info(target);if(actual.sha256!==row.sha256)throw new Error('tool copy mismatch');}
    for(const name of ['consumer.mts','negative.mts'])await copyFile(join(own,name),join(work,name));
    const before=await census(work);result.admittedFiles=before.length;result.admittedBytes=before.reduce((sum,row)=>sum+row.size,0);if(result.admittedBytes>256*1024*1024)throw new Error('work cap');
    const compiler=join(toolRoot,'typescript/lib/tsc.js'),flags=[...seal.flags,'--typeRoots',join(toolRoot,'@types')];
    const files=seal.sources.map(row=>join(source,relative(join(root,'src/commands/regex-execution/ere'),row.path)));
    const build=await execute(seal.node.path,[compiler,...flags,'--declaration','--outDir',emitted,'--rootDir',source,...files],work,'source',120000);
    result.sourceTypes=build.receipt.code===0;
    if(result.sourceTypes){
      const positive=await execute(seal.node.path,[compiler,...flags,'--noEmit',join(work,'consumer.mts')],work,'positive',30000);result.positive=positive.receipt.code===0;
      const negative=await execute(seal.node.path,[compiler,...flags,'--noEmit',join(work,'negative.mts')],work,'negative',30000);
      const diagnostics=[...negative.text.matchAll(/negative\.mts\((\d+),(\d+)\): error TS(\d+): ([^\n]*)/g)].map(match=>({line:Number(match[1]),column:Number(match[2]),code:Number(match[3]),message:match[4]}));
      result.negative={code:negative.receipt.code,diagnostics,pass:negative.receipt.code===2&&JSON.stringify(diagnostics.map(row=>row.code))===JSON.stringify(seal.negativeCodes)&&JSON.stringify(diagnostics.map(row=>row.line))==='[2,3,5]'};
    }
    for(const row of before)await verify(row);for(const row of [seal.node,...seal.sources,...seal.fixtures,...seal.design,...seal.tools])await verify(row);
    result.emitted=await census(emitted);result.captureBytes=captured;result.integrity='original admitted files unchanged; emitted-only addition';result.elapsedMs=Date.now()-begun;
    if(Date.now()>deadline)throw new Error('publication deadline');if(!result.sourceTypes||!result.positive||!result.negative?.pass)process.exitCode=1;
  }
}catch(error){result.failure=String(error?.stack??error);process.exitCode=1;}
finally{result.ended=new Date().toISOString();result.knownRetired=children.filter(row=>row.closed).length;await writeFile(join(output,phase==='seal'?'SEAL-RESULT.json':'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});await outer.write(JSON.stringify({end:result.ended,exitCode:process.exitCode??0,retired:result.knownRetired})+'\n');await outer.close();console.log(JSON.stringify(result.phase==='seal'?result:{...result,emitted:result.emitted?.length,children:result.children.map(row=>({name:row.name,code:row.code,closed:row.closed}))}));}
