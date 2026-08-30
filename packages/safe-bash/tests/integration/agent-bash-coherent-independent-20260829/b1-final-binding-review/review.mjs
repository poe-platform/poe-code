import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../../../..');
const phase=process.argv[2];
const fd=fs.openSync(root+'/'+phase+'.jsonl','wx');
const log=value=>fs.writeSync(fd,JSON.stringify(value)+'\n');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=(file,size,sha)=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size||size>8388608)throw Error('TYPE_SIZE '+file);const bytes=fs.readFileSync(file);if(hash(bytes)!==sha)throw Error('HASH '+file);return bytes;};
const write=(name,value)=>fs.writeFileSync(root+'/'+name,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const fileHash=async(file,size)=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size)throw Error('STREAM_TYPE_SIZE');const digest=crypto.createHash('sha256');let count=0;for await(const bytes of fs.createReadStream(file,{highWaterMark:65536})){count+=bytes.length;if(count>size)throw Error('STREAM_LONG');digest.update(bytes);}if(count!==size)throw Error('STREAM_SHORT');return digest.digest('hex');};
try{
 log({pid:process.pid,phase,utc:new Date().toISOString()});
 const binding=JSON.parse(read(root+'/frozen/BINDING.json',4265,'adce87b6432ac4c80b84bdf13a225e1b9b0771a398740866734b70476610c97f'));
 const absent=()=>{const rows=[binding.workRoot,...binding.captures].map(file=>{let exists=true;try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}return {path:file,absent:!exists};});if(rows.some(row=>!row.absent))throw Error('ACTUAL_SLOT_OCCUPIED');return rows;};
 const window=()=>{const now=Date.now();if(now>Date.parse(binding.latestStartUTC)||Date.parse(binding.expiresUTC)-now<1800000)throw Error('WINDOW_CLOSED_NO_EXTENSION');return new Date(now).toISOString();};
 const node='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';if(await fileHash(node,112989184)!=='5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011')throw Error('NODE_HASH');
 const runtime=JSON.parse(read(path.join(repo,binding.preseal.path),binding.preseal.bytes,binding.preseal.sha256));
 read(path.join(repo,binding.reviewReceipt.path),binding.reviewReceipt.bytes,binding.reviewReceipt.sha256);
 for(const entry of binding.publicationFiles)read(path.join(repo,entry.path),entry.bytes,entry.sha256);
 if(await fileHash(path.join(repo,binding.package.path),binding.package.bytes)!==binding.package.sha256)throw Error('PACKAGE_HASH');
 if(phase==='prepare'){
  const rows=[];for(const entry of runtime.files){if(await fileHash(path.join(repo,entry.path),entry.bytes)!==entry.sha256)throw Error('RUNTIME_INPUT '+entry.path);rows.push(entry);}
  const source=read(root+'/frozen/controls.mjs',2828,'603ce16f9549f2572998e830175197bfb38f75ff4d6aadd50c2bde444cd6461f').toString();
  const needle='`${scope}/CONTROL-RESULTS.json`';if(source.split(needle).length!==2)throw Error('OUTPUT_DELTA');
  write('pure.mjs',source.replace(needle,JSON.stringify(path.join(root,'CONTROL-RESULTS.json'))));
  const files=['PLAN.md','review.mjs','pure.mjs','frozen/actual-publication.mjs','frozen/BINDING.json','frozen/PUBLICATION-PRESEAL.json'];const inputs=files.map(name=>{const stat=fs.lstatSync(root+'/'+name);if(!stat.isFile()||stat.size>32768)throw Error('LOCAL_TYPE');const bytes=fs.readFileSync(root+'/'+name);return {path:name,bytes:bytes.length,sha256:hash(bytes)};});
  const value={schema:1,node:{path:node,bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'},bindingSha256:'adce87b6432ac4c80b84bdf13a225e1b9b0771a398740866734b70476610c97f',inputs,runtimeInputs:rows,utc:window(),absence:absent(),pureGroups:8,pureChildren:1,actual:0,outputDeltaOnly:true};write('INDEPENDENT-PRESEAL.json',value);log({presealSha256:hash(Buffer.from(JSON.stringify(value,null,2)+'\n')),runtimeInputs:rows.length,utc:value.utc,absence:value.absence});
 }else if(phase==='run'){
  const out=fs.openSync(root+'/pure.stdout','wx'),err=fs.openSync(root+'/pure.stderr','wx');const stat=fs.lstatSync(root+'/INDEPENDENT-PRESEAL.json');const seal=JSON.parse(read(root+'/INDEPENDENT-PRESEAL.json',stat.size,process.argv[3]));for(const row of seal.inputs)read(root+'/'+row.path,row.bytes,row.sha256);const before={utc:window(),absence:absent()};
  const child=spawnSync(node,['--unhandled-rejections=strict',root+'/pure.mjs'],{cwd:repo,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},timeout:10000,maxBuffer:1048576,killSignal:'SIGKILL'});
  fs.writeFileSync(out,child.stdout??Buffer.alloc(0));fs.writeFileSync(err,child.stderr??Buffer.alloc(0));fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);
  log({pid:child.pid,status:child.status,signal:child.signal,error:child.error?.message,stdoutBytes:child.stdout?.length,stderrBytes:child.stderr?.length,before,after:{utc:window(),absence:absent()}});if(child.status!==0||child.signal||child.error)throw Error('PURE_STOP');for(const row of seal.inputs)read(root+'/'+row.path,row.bytes,row.sha256);
  write('POSTGUARDS.json',{files:seal.inputs.length,actual:0,utc:new Date().toISOString()});
 }else throw Error('PHASE');
}catch(error){log({error:String(error),stack:error?.stack});process.exitCode=1;}finally{fs.fsyncSync(fd);fs.closeSync(fd);}
