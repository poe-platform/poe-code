import { openSync, closeSync, writeSync, lstatSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const own=fileURLToPath(new URL('.',import.meta.url));
const capture=[];
let primary={present:false};
let result={schema:1,role:'strict-types-and-pure-DATA-only',children:[],workers:0,matchingCalls:0};
let captureBytes=0;
const begun=Date.now();
const deadline=begun+480000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function output(fd,bytes){captureBytes+=bytes.length;if(captureBytes>16*1024*1024)throw Error('capture cap');let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(count<=0)throw Error('capture write failure');offset+=count;}}
function read(path,maximum=8*1024*1024){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('regular bounded read '+path);const bytes=readFileSync(path);if(bytes.length!==stat.size)throw Error('read drift');return bytes;}
async function info(path,maximum=128*1024*1024){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('regular bounded hash '+path);const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){bytes+=chunk.length;if(bytes>stat.size)throw Error('hash drift');digest.update(chunk);}if(bytes!==stat.size)throw Error('hash short');return {path,size:bytes,mode:stat.mode&511,sha256:digest.digest('hex')};}
async function verify(row){const actual=await info(row.path);if(actual.size!==row.size||actual.sha256!==row.sha256||actual.mode!==row.mode)throw Error('input binding '+row.path);}
async function census(dir){const rows=[];async function visit(current){for(const name of readdirSync(current).sort()){const path=join(current,name);const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('linked output');if(stat.isDirectory())await visit(path);else rows.push(await info(path));if(rows.length>1024)throw Error('census cap');}}await visit(dir);if(rows.reduce((sum,row)=>sum+row.size,0)>256*1024*1024)throw Error('work cap');return rows;}
async function child(node,args,cwd,name,timeout){
  if(result.children.length>=4||Date.now()>=deadline-2000)throw Error('child admission');
  const opened=[];let processChild;let ownedClose;let timer;let fault={present:false};const chunks=[];let bytes=0;
  const row={name,args,pid:null,closed:false,code:null,signal:null};
  try{
    opened.push(openSync(join(own,'RUN-v1',name+'.stdout'),'wx'));
    opened.push(openSync(join(own,'RUN-v1',name+'.stderr'),'wx'));
    processChild=spawn(node,args,{cwd,env:{PATH:dirname(node),LANG:'C',LC_ALL:'C',HOME:cwd,TMPDIR:cwd},stdio:['ignore','pipe','pipe']});
    result.children.push(row);
    ownedClose=new Promise(resolve=>{processChild.once('error',reason=>{if(!fault.present)fault={present:true,value:reason};});processChild.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;resolve();});});
    try{
      row.pid=processChild.pid??null;
      for(const [index,stream]of [processChild.stdout,processChild.stderr].entries()){
        stream.on('data',chunk=>{try{bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('child capture cap');output(opened[index],chunk);chunks.push(chunk);}catch(reason){if(!fault.present)fault={present:true,value:reason};processChild.kill('SIGKILL');}});
        stream.on('error',reason=>{if(!fault.present)fault={present:true,value:reason};processChild.kill('SIGKILL');});
      }
      timer=setTimeout(()=>{if(!fault.present)fault={present:true,value:Error('child deadline')};processChild.kill('SIGKILL');},Math.min(timeout,deadline-Date.now()-1000));
    }catch(reason){if(!fault.present)fault={present:true,value:reason};processChild.kill('SIGKILL');}
    await ownedClose;clearTimeout(timer);output(capture[0],Buffer.from(JSON.stringify(row)+'\n'));
    if(fault.present)throw fault.value;if(row.signal)throw Error('child signal');
    return {code:row.code,text:Buffer.concat(chunks).toString('utf8')};
  }catch(reason){if(!fault.present)fault={present:true,value:reason};throw reason;}finally{if(processChild&&!row.closed){processChild.kill('SIGKILL');await ownedClose;}clearTimeout(timer);let closeFault={present:false};for(const fd of opened){try{closeSync(fd);}catch(reason){if(!closeFault.present)closeFault={present:true,value:reason};}}if(closeFault.present){row.cleanupFailure=true;if(!fault.present)throw closeFault.value;}}
}
try{
  capture.push(openSync(join(own,'RUN-v1','owner.stdout'),'wx'));
  capture.push(openSync(join(own,'RUN-v1','owner.stderr'),'wx'));
  const sealBytes=read(join(own,'PRESEAL.json'),1024*1024);
  if(hash(sealBytes)!==process.argv[2])throw Error('preseal binding');
  const seal=JSON.parse(sealBytes);
  if(process.execPath!==seal.node.path)throw Error('Node identity');
  for(const row of [seal.node,...seal.tools,...seal.sources,...seal.fixtures])await verify(row);
  const work=join(own,'RUN-v1','work');mkdirSync(work);writeFileSync(join(work,'package.json'),'{"type":"module"}\n',{flag:'wx'});
  const source=join(work,'source');mkdirSync(source);
  for(const row of seal.sources){const target=join(source,row.relative);mkdirSync(dirname(target),{recursive:true});const bytes=read(row.path);writeFileSync(target,bytes,{flag:'wx'});if(hash(read(target))!==row.sha256)throw Error('source copy');}
  const engine=JSON.parse(read(join(own,'PINNED-ENGINE.json'),1024*1024));
  for(const row of engine.files){const bytes=Buffer.from(row.base64,'base64');if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('pinned source bytes');writeFileSync(join(source,row.name),bytes,{flag:'wx'});}
  const toolRoot=join(work,'node_modules');
  for(const row of seal.tools){const target=join(toolRoot,row.relative);mkdirSync(dirname(target),{recursive:true});const bytes=read(row.path,8*1024*1024);writeFileSync(target,bytes,{flag:'wx'});if(hash(read(target))!==row.sha256)throw Error('tool copy');}
  for(const [sourceName,targetName]of [['positive.mts.data','consumer.mts'],['negative.mts.data','negative.mts'],['pure-controls.mjs.data','pure-controls.mjs']])writeFileSync(join(work,targetName),read(join(own,sourceName)),{flag:'wx'});
  const before=await census(work);result.inputs=before.length;
  const compiler=join(toolRoot,'typescript/lib/tsc.js');const flags=[...seal.flags,'--typeRoots',join(toolRoot,'@types')];
  const files=[...engine.files.map(row=>join(source,row.name)),...seal.sources.map(row=>join(source,row.relative))];
  const emitted=join(work,'emitted');
  const build=await child(seal.node.path,[compiler,...flags,'--declaration','--outDir',emitted,'--rootDir',source,...files],work,'source',120000);
  result.source={code:build.code,diagnostics:build.text};
  if(build.code!==0)throw Error('strict source compiler failed; no subsequent checks launched');
  const emits=await census(emitted);result.emitted=emits;
  const positive=await child(seal.node.path,[compiler,...flags,'--noEmit',join(work,'consumer.mts')],work,'positive',30000);result.positive={code:positive.code,diagnostics:positive.text};
  const negative=await child(seal.node.path,[compiler,...flags,'--noEmit',join(work,'negative.mts')],work,'negative',30000);const codes=[...negative.text.matchAll(/error TS(\d+):/g)].map(match=>Number(match[1]));result.negative={code:negative.code,diagnostics:negative.text,codes,pass:negative.code===2&&JSON.stringify(codes)==='[2353,2322,2345]'};
  const pureNames=['transport/accounting.js','transport/validation.js','transport/protocol.js','limits.js','errors.js'];
  const loads=pureNames.map(name=>{const row=emits.find(entry=>entry.path===join(emitted,name));if(!row)throw Error('missing pure emit');return{path:row.path,bytes:row.size,sha256:row.sha256};});
  const loadBytes=Buffer.from(JSON.stringify(loads,null,2)+'\n');writeFileSync(join(work,'PURE-LOADS.json'),loadBytes,{flag:'wx'});
  const pure=await child(seal.node.path,[join(work,'pure-controls.mjs'),hash(loadBytes)],work,'pure',30000);result.pureProcess={code:pure.code,diagnostics:pure.text};
  const pureResultPath=join(work,'PURE-RESULT.json');if(lstatSync(pureResultPath).size>65536)throw Error('pure result cap');result.pure=JSON.parse(read(pureResultPath,65536));
  for(const row of before)await verify(row);for(const row of [seal.node,...seal.tools,...seal.sources,...seal.fixtures])await verify(row);
  result.integrity='all admitted bytes unchanged; full emitted/output census retained';result.outputs=await census(work);
  result.pass=result.positive.code===0&&result.negative.pass&&pure.code===0&&result.pure.passed===12;
  if(!result.pass)process.exitCode=1;
}catch(reason){primary={present:true,value:reason};result.failure={present:true,kind:reason instanceof Error?'Error':typeof reason,message:reason instanceof Error?reason.message.slice(0,4096):'non-Error primary'};process.exitCode=1;}
finally{
  result.elapsedMs=Date.now()-begun;result.captureBytes=captureBytes;result.knownChildren=result.children.length;result.closedChildren=result.children.filter(row=>row.closed).length;
  try{writeFileSync(join(own,'RUN-v1','RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}catch(reason){if(!primary.present)primary={present:true,value:reason};process.exitCode=1;}
  for(const fd of capture){try{closeSync(fd);}catch(reason){if(!primary.present)primary={present:true,value:reason};process.exitCode=1;}}
  console.log(JSON.stringify({pass:result.pass??false,source:result.source?.code,positive:result.positive?.code,negative:result.negative?.codes,pure:result.pure?.passed,children:result.knownChildren,closed:result.closedChildren,primaryPresent:primary.present}));
}
