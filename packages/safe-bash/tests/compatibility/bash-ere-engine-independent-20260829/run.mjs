import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname);
const started=Date.now();
const deadline=started+3600000;
const output=path.join(root,'ACTUAL-01');
fs.mkdirSync(output);
const log=fs.openSync(path.join(output,'events.data'),'wx',0o600);
const emit=value=>{if(Date.now()>=deadline)throw Error('STOP final deadline');fs.writeSync(log,JSON.stringify({at:new Date().toISOString(),...value})+'\n');};
let starts=0,captureBytes=0;const receipts=[],results=[];let seal,work;
const hash=location=>{
  const stat=fs.lstatSync(location);if(!stat.isFile()||stat.size>128*1024*1024)throw Error('STOP file admission');
  const digest=crypto.createHash('sha256');const descriptor=fs.openSync(location,'r');const buffer=Buffer.alloc(65536);let size=0;
  try{let count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){digest.update(buffer.subarray(0,count));size+=count;}}finally{fs.closeSync(descriptor);}
  if(size!==stat.size)throw Error('STOP changed during read');
  return{path:location,size,mode:stat.mode&0o777,sha256:digest.digest('hex')};
};
const verify=rows=>{for(const row of rows){const actual=hash(row.path);if(actual.size!==row.size||actual.mode!==row.mode||actual.sha256!==row.sha256)throw Error('STOP integrity '+row.path);}};
const write=(location,body)=>{fs.mkdirSync(path.dirname(location),{recursive:true});fs.writeFileSync(location,body,{mode:0o600,flag:'wx'});};
const artifact=directory=>({directory,files:fs.readdirSync(directory).sort().map(name=>{const row=hash(path.join(directory,name));return{name,size:row.size,mode:row.mode,sha256:row.sha256};})});
const manifest=(directory,label)=>{const value=artifact(directory);const location=path.join(output,label+'.manifest.json');write(location,JSON.stringify(value,null,2)+'\n');return{value,location};};
const verifyArtifact=value=>{const actual=artifact(value.directory);if(JSON.stringify(actual)!==JSON.stringify(value))throw Error('STOP artifact integrity');};
const census=directory=>{let count=0,size=0;const visit=current=>{for(const name of fs.readdirSync(current)){const location=path.join(current,name);const stat=fs.lstatSync(location);if(stat.isDirectory())visit(location);else if(stat.isFile()){count++;size+=stat.size;}else throw Error('STOP unexpected work role');}};visit(directory);if(size>1073741824)throw Error('STOP storage');return{files:count,bytes:size};};
async function child(id,args,cap=30000){
  if(Date.now()>=deadline-120000||++starts>32)throw Error('STOP runtime admission');
  verify([seal.node,...seal.inputs]);
  const stdoutPath=path.join(output,`${starts}-${id}.stdout.data`),stderrPath=path.join(output,`${starts}-${id}.stderr.data`);
  const stdout=fs.openSync(stdoutPath,'wx',0o600),stderr=fs.openSync(stderrPath,'wx',0o600);
  const begin=Date.now();let stop=null,code=null,signal=null,bodyBytes=0,pid=null;let timer,killTimer,retirementTimer;
  const chunks=[];
  try{
    await new Promise((resolve,reject)=>{
      const processChild=spawn(seal.node.path,args,{cwd:work,env:{PATH:'',HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore','pipe','pipe'],detached:true});
      pid=processChild.pid;emit({event:'start',id,pid,args,cap});
      const terminate=reason=>{stop??=reason;try{process.kill(-pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')stop=String(error);}killTimer??=setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')stop=String(error);}},2000);};
      timer=setTimeout(()=>terminate('deadline'),Math.min(cap,deadline-Date.now()-3000));
      retirementTimer=setTimeout(()=>reject(Error('STOP unknown retirement after deadline and TERM/KILL grace')),Math.min(cap+3000,deadline-Date.now()));
      const consume=(descriptor,data,collect)=>{try{bodyBytes+=data.length;captureBytes+=data.length;if(bodyBytes>8388608||captureBytes>201326592){terminate('capture cap');return;}fs.writeSync(descriptor,data);if(collect)chunks.push(data);}catch(error){terminate('capture '+String(error));}};
      processChild.stdout.on('data',data=>consume(stdout,data,true));processChild.stderr.on('data',data=>consume(stderr,data,false));
      processChild.on('error',error=>{stop??=String(error);});
      processChild.on('close',(exit,reason)=>{code=exit;signal=reason;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(retirementTimer);resolve();});
    });
    if(pid){try{process.kill(-pid,0);throw Error('STOP unknown group retirement');}catch(error){if(error.code!=='ESRCH')throw error;}}
    fs.fsyncSync(stdout);fs.fsyncSync(stderr);
  }finally{fs.closeSync(stdout);fs.closeSync(stderr);clearTimeout(timer);clearTimeout(killTimer);clearTimeout(retirementTimer);}
  const receipt={id,pid,code,signal,stop,elapsedMs:Date.now()-begin,stdout:hash(stdoutPath),stderr:hash(stderrPath),bytes:bodyBytes,retired:true};receipts.push(receipt);emit({event:'retired',...receipt});
  if(stop||signal)throw Error('STOP child '+id+' '+stop+' '+signal);
  verify([seal.node,...seal.inputs]);census(work);
  return{...receipt,text:Buffer.concat(chunks).toString('utf8')};
}
try{
  emit({event:'begin',started,deadline,scope:'pure-engine-only'});
  seal=JSON.parse(fs.readFileSync(path.join(root,'SEAL.json'),'utf8'));
  verify([seal.node,...seal.inputs,...seal.sources,...seal.tools]);
  if(seal.source!=='f97fd06024cb63edfd01873d81d84576a22189db')throw Error('STOP source');
  work=path.join(output,'work');fs.mkdirSync(work);fs.mkdirSync(path.join(work,'home'));fs.mkdirSync(path.join(work,'tmp'));
  const copied=[];
  for(const row of seal.tools){const relative=path.relative('/Users/kjopek/Workspace/safe-bash',row.path);if(!relative.startsWith('node_modules/')||relative.includes('..'))throw Error('STOP tool path');const destination=path.join(work,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(row.path,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,row.mode);copied.push({...row,path:destination});}
  verify(copied);
  const source=path.join(work,'source');fs.mkdirSync(source);
  for(const row of seal.sources){fs.copyFileSync(row.path,path.join(source,row.name),fs.constants.COPYFILE_EXCL);}
  write(path.join(source,'package.json'),'{"type":"module","private":true}\n');
  const sourceLayout=path.join(work,'source-consumer');fs.mkdirSync(sourceLayout);
  const emitted=path.join(sourceLayout,'artifact');
  const compiler=path.join(work,'node_modules/typescript/lib/tsc.js');
  const typeRoots=path.join(work,'node_modules/@types');
  const built=await child('strict-build',[compiler,...seal.flags,'--typeRoots',typeRoots,'--declaration','--outDir',emitted,...seal.sources.map(row=>path.join(source,row.name))],120000);
  if(built.code!==0){results.push({id:'BUILD',pass:false,code:built.code});throw Error('ordinary build failed; dependent cases UNRUN');}
  write(path.join(emitted,'package.json'),'{"type":"module","private":true}\n');
  const original=manifest(emitted,'original');
  if(original.value.files.length!==11)throw Error('STOP emitted membership');
  write(path.join(sourceLayout,'consumer.mts'),fs.readFileSync(path.join(root,'witnesses/consumer.mts.data')));
  write(path.join(sourceLayout,'negative.mts'),fs.readFileSync(path.join(root,'witnesses/negative.mts.data')));
  const installed=path.join(work,'installed-consumer');fs.cpSync(sourceLayout,installed,{recursive:true,errorOnExist:true,force:false});
  const suite=path.join(root,'witnesses/suite.mjs.data');
  const authorSuite=path.join(work,'suite.mjs');write(authorSuite,fs.readFileSync(suite));
  const independentSuite=path.join(root,'independent.mjs');
  const entry=path.join(root,'entry.mjs');const cases=path.join(root,'witnesses/cases.json.data');
  async function suiteRun(id,directory,suitePath,selection='all',expectedCount=66){
    const bound=manifest(directory,id);const observed=await child(id,[entry,bound.location,suitePath,cases,selection]);verifyArtifact(bound.value);
    const parsed=observed.text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const row=parsed.find(value=>value.event==='results');
    const pass=observed.code===0&&row?.rows.length===expectedCount&&row.fail===0;
    const summary={id,pass,code:observed.code,results:row??null,manifest:bound.value};results.push(summary);return summary;
  }
  for(const [layout,directory] of [['source',sourceLayout],['installed',installed],['moved',path.join(work,'moved-consumer')]]){
    if(layout==='moved'){fs.renameSync(installed,directory);if(fs.existsSync(installed))throw Error('STOP old installed path remains');}
    const directoryArtifact=path.join(directory,'artifact');
    const compared=artifact(directoryArtifact);if(JSON.stringify(compared.files)!==JSON.stringify(original.value.files))throw Error('STOP layout changed');
    await suiteRun(`${layout}-author`,directoryArtifact,authorSuite);
    await suiteRun(`${layout}-independent`,directoryArtifact,independentSuite,'all',24);
    for(const negative of [false,true]){
      const id=`${layout}-types-${negative?'negative':'positive'}`;
      const observed=await child(id,[compiler,...seal.flags,'--typeRoots',typeRoots,'--noEmit',path.join(directory,negative?'negative.mts':'consumer.mts')]);
      const diagnostics=[...observed.text.matchAll(/error TS(\d+):/g)].map(match=>Number(match[1]));
      const expected=negative?[2345,2339,2322]:[];
      results.push({id,pass:observed.code===(negative?2:0)&&JSON.stringify(diagnostics)===JSON.stringify(expected),code:observed.code,diagnostics,expected});
    }
  }
  const mutations=[
    ['M01-whole','matcher','return candidate.position > incumbent.position;','return candidate.position < incumbent.position;','E03',1],
    ['M02-ascii','syntax','if (code === 0 || code > 127)','if (false)','R14',1],
    ['M03-nullable','syntax','if (child.nullable && child.captured && max > 1)','if (false)','R11',1],
    ['M04-truncate','matcher','captures: Object.freeze(captures)','captures: Object.freeze(captures.slice(0, 1))','E08',1],
    ['M05-slot','matcher','ledger.charge("captureSlots", width, signal);','void width;','all',66],
    ['M06-binding','syntax','if (!entry || entry.ledger !== ledger)','if (!entry)','all',66],
  ];
  for(const [id,name,before,after,selection,count] of mutations){
    const location=path.join(emitted,name+'.js');const bytes=fs.readFileSync(location);const text=bytes.toString('utf8');
    if(text.split(before).length!==2){results.push({id,pass:false,reason:'exact mutation marker absent'});continue;}
    const changed=text.replace(before,after);write(path.join(output,id+'.delta.json'),JSON.stringify({name,before,after,base:hash(location).sha256,changed:crypto.createHash('sha256').update(changed).digest('hex')},null,2)+'\n');
    let killed;
    try{fs.writeFileSync(location,changed);killed=await suiteRun(id,emitted,authorSuite,selection,count);}
    finally{fs.writeFileSync(location,bytes);verifyArtifact(original.value);}
    const restored=await suiteRun(id+'-restore',emitted,authorSuite,selection,count);
    results.push({id:id+'-control',pass:killed.code===1&&killed.results?.fail>0&&restored.pass,killed:killed.results?.fail,restored:restored.pass});
  }
  for(const kind of ['wrong-hash','wrong-path']){
    const value=structuredClone(original.value);if(kind==='wrong-hash')value.files[0].sha256='0'.repeat(64);else value.directory=path.join(work,'absent-artifact');
    const location=path.join(output,kind+'.manifest.json');write(location,JSON.stringify(value)+'\n');
    const observed=await child(kind,[entry,location,authorSuite,cases]);
    results.push({id:kind,pass:observed.code===2&&observed.text.includes('ADMISSION_DENIED')&&!observed.text.includes('"event":"loaded"'),code:observed.code});
  }
  verify(copied);verify([seal.node,...seal.inputs,...seal.sources,...seal.tools]);verifyArtifact(original.value);
  const working=census(work);
  const failures=results.filter(row=>!row.pass&&!/^M\d\d-[^-]+$/.test(row.id));
  const result={source:seal.source,seal:hash(path.join(root,'SEAL.json')),started,ended:Date.now(),elapsedMs:Date.now()-started,children:starts,peakRuntimeProcesses:2,captureBytes,working,receipts,results,disposition:failures.length?'FAIL':'PASS',knownFailures:failures.map(row=>row.id),native:'UNRUN',integration:'UNRUN',retainedWork:work};
  write(path.join(output,'RESULT.json'),JSON.stringify(result,null,2)+'\n');emit({event:'complete',disposition:result.disposition,children:starts,captureBytes,working});
  if(failures.length)process.exitCode=1;
}catch(error){
  emit({event:'terminal',message:String(error?.stack??error),children:starts,receipts:receipts.length,results:results.length});
  write(path.join(output,'HOLD.json'),JSON.stringify({source:seal?.source,message:String(error?.stack??error),starts,receipts,results},null,2)+'\n');process.exitCode=2;
}finally{fs.fsyncSync(log);fs.closeSync(log);}
