import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const home=path.dirname(fileURLToPath(import.meta.url));
if(process.argv[2]!=='ACTIVATE-COMMITTED-NATIVE-v1')throw Error('native resolution admission');
const output=path.join(home,'native-actual-v1');fs.mkdirSync(output);
const startup=fs.openSync(path.join(output,'startup.json'),'wx',0o600);
const state={role:'native-public-no-guest-resolution',start:new Date().toISOString(),children:[],NodeWorkers:0,guestEntries:0,loaderAdmissions:0,unsafe:false,cleanup:false};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(filename,max=33554432)=>{const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('regular bounded input');return fs.readFileSync(filename);};
const write=(filename,bytes)=>{fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes,{flag:'wx'});};
try{
 const seal=JSON.parse(read(path.join(home,'NATIVE-PRESEAL.json')));for(const row of seal.inputs){const bytes=read(path.join(home,row.path));if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('native recipe binding');}
 const executable=fs.lstatSync(process.execPath);if(process.execPath!==seal.node.path||!executable.isFile()||executable.isSymbolicLink()||executable.size>268435456)throw Error('native executable admission');const descriptor=fs.openSync(process.execPath,'r'),digest=createHash('sha256'),block=Buffer.alloc(65536);try{let bytes;while((bytes=fs.readSync(descriptor,block,0,block.length,null))!==0)digest.update(block.subarray(0,bytes));}finally{fs.closeSync(descriptor);}if(digest.digest('hex')!==seal.node.sha256)throw Error('native executable binding');state.executableBytesHashed=executable.size;
 const terminal=JSON.parse(read(path.join(home,'actual-v1/TERMINAL.json')));if(terminal.unsafe||!terminal.cleanup||!terminal.closed)throw Error('prior retirement STOP');
 const compressed=Buffer.from(read(path.join(home,'actual-v1/EVIDENCE.json.gz.base64')).toString().trim(),'base64');if(sha(compressed)!==seal.mainEvidenceSha256)throw Error('main evidence integrity');
 const entries=JSON.parse(gunzipSync(compressed,{maxOutputLength:67108864}));const packed=entries.find(row=>row.path==='virtual-bash-0.0.0.tgz');const tar=Buffer.from(packed.body,'base64');if(tar.length!==packed.bytes||sha(tar)!==seal.packageSha256)throw Error('full package integrity');
 const unpacked=gunzipSync(tar,{maxOutputLength:16777216});const packageFiles=[];
 for(let offset=0;offset+512<=unpacked.length;){const header=unpacked.subarray(offset,offset+512);if(header.every(value=>value===0))break;const name=header.subarray(0,100).toString().replace(/\0.*$/u,''),size=Number.parseInt(header.subarray(124,136).toString().replace(/\0.*$/u,'').trim(),8);if(!name.startsWith('package/')||name.split('/').includes('..')||![0,48].includes(header[156])||!Number.isSafeInteger(size)||size<0||offset+512+size>unpacked.length)throw Error('tar admission');packageFiles.push({path:name.slice(8),body:Buffer.from(unpacked.subarray(offset+512,offset+512+size))});offset+=512+Math.ceil(size/512)*512;}
 if(packageFiles.length!==1010)throw Error('full package count');
 const scratch=path.join(output,'scratch');let consumer=path.join(scratch,'consumer');let product=path.join(consumer,'node_modules/virtual-bash');
 for(const row of packageFiles)write(path.join(product,row.path),row.body);write(path.join(consumer,'package.json'),'{"type":"module","private":true}\n');
 for(const [from,to]of [['native-consumer.mjs','consumer.mjs'],['native-guard.mjs','guard.mjs']])write(path.join(consumer,to),read(path.join(home,from)));
 const originalPackage=read(path.join(product,'package.json'));
 function validatePackage(mutated=false){for(const row of packageFiles){if(mutated&&row.path==='package.json')continue;if(sha(read(path.join(product,row.path)))!==sha(row.body))throw Error('package drift');}}
 function run(label,expectFailure=false){
  validatePackage(expectFailure);const manifest=packageFiles.filter(row=>row.path.endsWith('.js')).map(row=>{const filename=path.join(product,row.path);return{path:filename,body:read(filename)};});for(const name of ['consumer.mjs','guard.mjs'])manifest.push({path:path.join(consumer,name),body:read(path.join(consumer,name))});
  fs.writeFileSync(path.join(consumer,'manifest.json'),JSON.stringify(manifest.map(row=>({path:row.path,bytes:row.body.length,sha256:sha(row.body),builtins:[...new Set([...row.body.toString().matchAll(/(?:from\s*|import\s*)["'](node:[^"']+)["']/gu)].map(match=>match[1]))]}))));
  const stdout=fs.openSync(path.join(output,label+'.stdout'),'wx'),stderr=fs.openSync(path.join(output,label+'.stderr'),'wx');let result;
  try{result=spawnSync(process.execPath,['--experimental-permission','--allow-fs-read='+scratch,'--import',path.join(consumer,'guard.mjs'),path.join(consumer,'consumer.mjs')],{cwd:consumer,env:{PATH:path.dirname(process.execPath),HOME:path.join(scratch,'home'),TZ:'UTC',NO_COLOR:'1'},encoding:null,timeout:30000,maxBuffer:2097152});fs.writeFileSync(stdout,result.stdout??Buffer.alloc(0));fs.writeFileSync(stderr,result.stderr??Buffer.alloc(0));}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
  const row={label,pid:result.pid,code:result.status,signal:result.signal,closed:result.status!==null,stdoutSha256:sha(result.stdout??Buffer.alloc(0)),stderrSha256:sha(result.stderr??Buffer.alloc(0)),bytes:(result.stdout?.length??0)+(result.stderr?.length??0)};state.children.push(row);
  if(result.error||result.signal||result.status===null)throw Error('native child capture/retirement STOP');const text=result.stderr.toString();const resolutions=text.split('\n').filter(line=>line.startsWith('@@NATIVE_RESOLVE ')).map(line=>JSON.parse(line.slice(17)));if(resolutions.length!==2||!resolutions.every(item=>item.native))throw Error('native resolution witness');row.resolutions=resolutions;row.loaded=text.split('\n').filter(line=>line.startsWith('@@NATIVE_LOAD ')).length;
  if(expectFailure){if(result.status!==1||!text.includes('NATIVE_PUBLIC_EXPORT_MISMATCH'))throw Error('native mutant not detected');row.expectedFailure=true;}else{if(result.status!==0)throw Error('native public assertion');const receipt=JSON.parse(result.stdout);if(receipt.role!=='I13-native-public-resolution'||receipt.aliases!==false||receipt.prepared!==0)throw Error('native receipt');row.receipt=receipt;}
  validatePackage(expectFailure);
 }
 run('rehydrated');const oldConsumer=consumer;consumer=path.join(scratch,'physically-moved');fs.renameSync(oldConsumer,consumer);product=path.join(consumer,'node_modules/virtual-bash');if(fs.existsSync(oldConsumer))throw Error('origin still present');state.originAbsent=true;run('moved');
 const altered=JSON.parse(originalPackage);altered.exports['./commands/node'].import='./dist/commands/node/host.js';fs.writeFileSync(path.join(product,'package.json'),JSON.stringify(altered));state.packageMutation={original:sha(originalPackage),mutated:sha(read(path.join(product,'package.json'))),change:'import target only; types untouched'};run('wrong-import-target',true);fs.writeFileSync(path.join(product,'package.json'),originalPackage);run('restored');
 validatePackage();fs.rmSync(scratch,{recursive:true});state.cleanup=true;state.pass=true;
}catch(error){state.error={name:error?.name??null,message:typeof error?.message==='string'?error.message:'unknown'};state.pass=false;if(/integrity|binding|capture|retirement|drift|admission|STOP/u.test(state.error.message))state.unsafe=true;}
finally{state.end=new Date().toISOString();fs.writeFileSync(startup,JSON.stringify(state,null,2)+'\n');fs.closeSync(startup);}
console.log(JSON.stringify(state));process.exitCode=state.pass&&state.cleanup&&!state.unsafe?0:1;
