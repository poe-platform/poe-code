import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const own=fileURLToPath(new URL('.',import.meta.url)),phase=process.argv[2];
const stdout=fs.openSync(own+phase+'.stdout','wx',384),stderr=fs.openSync(own+phase+'.stderr','wx',384),journal=fs.openSync(own+phase+'.jsonl','wx',384);
const record=value=>fs.writeSync(journal,JSON.stringify(value)+'\n');record({phase,pid:process.pid,utc:new Date().toISOString()});
const root=process.cwd(),base=root+'/tests/integration/agent-bash-coherent-author-20260829/stage-b1-final-binding-v5/';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,max=8388608){const st=fs.lstatSync(filename);assert(st.isFile()&&st.size<=max);const bytes=fs.readFileSync(filename);return {bytes,sha256:hash(bytes),mode:st.mode&4095};}
function json(filename){return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read(filename).bytes));}
function authenticate(pin){const file=read(pin.path);assert.equal(file.bytes.length,pin.bytes);assert.equal(file.sha256,pin.sha256);return file;}
function stream(pin){const st=fs.lstatSync(pin.path);assert(st.isFile()&&st.size===pin.bytes);const fd=fs.openSync(pin.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),digest=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);let count=0;try{const opened=fs.fstatSync(fd);assert.equal(opened.ino,st.ino);assert.equal(opened.dev,st.dev);for(;;){const size=fs.readSync(fd,buffer,0,buffer.length,null);if(!size)break;count+=size;assert(count<=pin.bytes);digest.update(buffer.subarray(0,size));}}finally{fs.closeSync(fd);}assert.equal(count,pin.bytes);assert.equal(digest.digest('hex'),pin.sha256);}
function write(name,value){fs.writeFileSync(own+name,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:384});}
try{
 if(phase==='prepare'){
  fs.mkdirSync(own+'frozen',{recursive:true});const raw=read(own+'inventory.stdout').bytes;assert.equal(raw.at(-1),0);const bindings=[],seen=new Set();
  for(const row of raw.subarray(0,-1).toString().split('\0')){const tab=row.indexOf('\t'),[mode,type,oid]=row.slice(0,tab).split(' '),path=row.slice(tab+1);assert(tab>0&&type==='blob'&&!seen.has(path));seen.add(path);const file=read(path);assert.equal(file.mode,parseInt(mode,8)&4095);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+file.bytes.length+'\0')).update(file.bytes).digest('hex'),oid);bindings.push({path,bytes:file.bytes.length,sha256:file.sha256,mode:file.mode,oid});}
  const finalPin={path:base+'FINAL-BINDING.json',bytes:26277,sha256:'ef0dfcdcafe1da7b274b7f0cfaf9cfea71097796bdf542b93aed9f1e491ff3d7'};const packet=JSON.parse(authenticate(finalPin).bytes);
  assert.equal(packet.actualAuthority,false);assert.equal(packet.issuedUTC,'2026-08-29T14:03:58.806Z');assert.equal(packet.latestStartUTC,'2026-08-29T14:23:58.806Z');assert.equal(packet.expiresUTC,'2026-08-29T14:53:58.806Z');assert(Date.now()<Date.parse(packet.latestStartUTC));
  assert.equal(packet.preimportCommand.argv[0],base+'preimport.mjs');assert.equal(packet.preimportCommand.argv[1],finalPin.path);assert.equal(packet.preimportCommand.executable,packet.node.path);
  const pins=[...packet.runtimeFiles,...packet.publisherFiles,...packet.preimportFiles,packet.runtimePreseal,packet.publisherBinding,packet.publisherPreseal];for(const pin of pins)authenticate(pin);
  for(const review of [...packet.reviews,packet.historicalData.inheritedReview])authenticate({...review,path:root+'/'+review.path});
  stream(packet.node);stream(packet.product.package);for(const path of packet.absentSlots)assert.equal(fs.existsSync(path),false);assert.match(packet.slots.knownStartsBeforePublication.status,/UNMEASURED/);
  for(const name of ['preimport.mjs','identity.mjs']){const pin=packet.preimportFiles.find(pin=>pin.path===base+name);assert(pin);fs.writeFileSync(own+'frozen/'+name,authenticate(pin).bytes,{flag:'wx',mode:384});}
  const control=json(base+'CONTROL-PRESEAL.json');for(const pin of control.files)authenticate(pin);
  const source=read(base+'controls.mjs').bytes.toString();const body=source.slice(source.indexOf('const first ='),source.indexOf('fs.writeFileSync(`${scope}/CONTROLS.json`'));
  assert(body.includes("check('I08-invalid-scalars-and-hole'"));
  const author="import assert from 'node:assert/strict';\nimport {authenticatePacketFiles} from './frozen/preimport.mjs';\nimport {readIdentity} from './frozen/identity.mjs';\nconst seal="+JSON.stringify(control)+";\n"+body+"\nexport {outcomes,first,second};\n";
  fs.writeFileSync(own+'author-pure.mjs',author,{flag:'wx',mode:384});
  const locals={};for(const name of ['review.mjs','pure.mjs','author-pure.mjs','frozen/preimport.mjs','frozen/identity.mjs']){const file=read(own+name);locals[name]={bytes:file.bytes.length,sha256:file.sha256};}
  write('PRESEAL.json',{source:'0bf2b4981943ce5ede61b18dbcddfd6295e4c773',finalCommit:'17c3b717494be4eadbb2616d8a278a02e211cdee',finalPin,bindings,pins,receipts:[...packet.reviews,packet.historicalData.inheritedReview],controlFiles:control.files,locals,node:packet.node,package:packet.product.package,window:{issued:packet.issuedUTC,latestStart:packet.latestStartUTC,expires:packet.expiresUTC},novel:['N01-inherited-iterator-unused','N02-index-accessor-zero-effects','N03-combined-128-129-boundary','N04-null-prototype-and-hidden-index'],authorGroups:8,helpers:1,childMs:30000,maxCapture:1048576,actualProduct:0,qualification:'Unchanged author assertion body; independent dispatch/capture only. Full helper main and publisher are not executed.'});
  write('COMMANDS.json',{runtime:packet.runtimeCommand,preimport:{...packet.preimportCommand,argv:packet.preimportCommand.argv.map((arg,index)=>index===2?finalPin.sha256:index===3?String(finalPin.bytes):arg)},publication:packet.publicationCommand,slots:packet.slots,bounds:packet.bounds});record({prepared:true,inventory:bindings.length,consumedPins:pins.length,toolCensus:'prior independent receipt reused',futureRoles:'UNKNOWN'});
 }else if(phase==='run'){
  const seal=json(own+'PRESEAL.json');for(const [name,pin]of Object.entries(seal.locals)){const file=read(own+name);assert.equal(file.sha256,pin.sha256);assert.equal(file.bytes.length,pin.bytes);}for(const pin of [...seal.bindings,...seal.pins,...seal.controlFiles])authenticate(pin);
  const result=spawnSync(seal.node.path,[own+'pure.mjs'],{stdio:['ignore',stdout,stderr],env:{PATH:'',LANG:'C',LC_ALL:'C',TZ:'UTC'},timeout:30000,killSignal:'SIGKILL'});record({pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message,returned:true});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0);assert(fs.fstatSync(stdout).size+fs.fstatSync(stderr).size<=1048576);for(const pin of [...seal.bindings,...seal.pins])authenticate(pin);record({postguards:seal.bindings.length+seal.pins.length,stdoutBytes:fs.fstatSync(stdout).size,stderrBytes:fs.fstatSync(stderr).size});
 }else throw Error('phase');
}catch(reason){record({failed:true,error:String(reason)});fs.writeSync(stderr,String(reason.stack??reason)+'\n');process.exitCode=1;}
finally{for(const fd of [stdout,stderr,journal]){fs.fsyncSync(fd);fs.closeSync(fd);}}
