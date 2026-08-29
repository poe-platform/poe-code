import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const own=fileURLToPath(new URL('.',import.meta.url));
const phase=process.argv[2];
const output=fs.openSync(own+phase+'.stdout','wx',384);
const error=fs.openSync(own+phase+'.stderr','wx',384);
const journal=fs.openSync(own+phase+'.jsonl','wx',384);
const record=value=>fs.writeSync(journal,JSON.stringify(value)+'\n');
record({phase,pid:process.pid,utc:new Date().toISOString()});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=(filename,max=2097152)=>{const stat=fs.lstatSync(filename);assert(stat.isFile()&&stat.size<=max);const bytes=fs.readFileSync(filename);return {bytes,sha256:hash(bytes),mode:stat.mode&4095};};
const json=filename=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read(filename).bytes));
const write=(name,value)=>fs.writeFileSync(own+name,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:384});
const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const node='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
try {
 if(phase==='prepare-v2'){
  const author=process.cwd()+'/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/';
  const previous=author.replace('preexec-v4','preexec-v3');
  const seal=read(author+'PRESEAL.json');assert.equal(seal.bytes.length,9470);assert.equal(seal.sha256,'b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3');
  const config=JSON.parse(seal.bytes);const bindings=[];fs.mkdirSync(own+'frozen',{recursive:true});
  const raw=read(own+'inventory.stdout').bytes;assert.equal(raw.at(-1),0);
  const entries=raw.subarray(0,-1).toString('utf8').split('\0');const names=new Set();
  for(const entry of entries){const tab=entry.indexOf('\t');assert(tab>0);const [mode,type,oid]=entry.slice(0,tab).split(' ');const filename=entry.slice(tab+1);assert.equal(type,'blob');assert(!names.has(filename));names.add(filename);const actual=read(filename);assert.equal(actual.mode,parseInt(mode,8)&4095);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+actual.bytes.length+'\0')).update(actual.bytes).digest('hex'),oid);bindings.push({path:filename,bytes:actual.bytes.length,sha256:actual.sha256,mode:actual.mode,oid});assert.equal(read(own+'frozen/'+filename.slice(filename.lastIndexOf('/')+1)).sha256,actual.sha256);}
  for(const [name,pin]of Object.entries(config.files)){const actual=read(author+name);assert.equal(actual.bytes.length,pin.bytes);assert.equal(actual.sha256,pin.sha256);}
  const delta=json(author+'DELTA.json');const comparison=[];
  for(const item of delta.otherFiles){const old=read(previous+item.path),fresh=read(author+item.path);assert.equal(old.sha256,item.before);assert.equal(fresh.sha256,item.after);const expected=item.kind==='byte-identical'?old.bytes.toString():old.bytes.toString().replaceAll(previous.slice(0,-1),author.slice(0,-1)).replaceAll('/private/tmp/safe-bash-b35-v3-lfyWzQ','/private/tmp/safe-bash-b35-v4-PLN3cC');assert.equal(fresh.bytes.toString(),expected);comparison.push({path:item.path,kind:item.kind,verified:true});}
  const current=read(author+'direct-child.mjs').bytes.toString();const old=read(previous+'direct-child.mjs').bytes.toString();
  const reverted=current.slice(0,current.indexOf('export function openCapturePair'))+current.slice(current.indexOf('export async function runDirect'));
  assert.equal(reverted.replace('  const {stdoutFd,stderrFd}=openCapturePair(spec,ledger,row,primary);',"  let stdoutFd, stderrFd;\n  try {stdoutFd = fs.openSync(spec.capture + '.stdout','wx+',384); stderrFd = fs.openSync(spec.capture + '.stderr','wx+',384);} catch(reason) {if(stdoutFd!==undefined)fs.closeSync(stdoutFd);throw reason;}"),old);
  for(const pin of [config.node,config.originalPackage]){const stat=fs.lstatSync(pin.path);assert(stat.isFile());assert.equal(stat.size,pin.bytes);assert.equal(stat.mode&4095,pin.mode);const fd=fs.openSync(pin.path,'r'),buffer=Buffer.alloc(65536),digest=crypto.createHash('sha256');let total=0;try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;assert(total<=pin.bytes);digest.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}assert.equal(total,pin.bytes);assert.equal(digest.digest('hex'),pin.sha256);}
  const controls=read(author+'controls.mjs').bytes.toString();const body=controls.slice(controls.indexOf('const rows=[];'),controls.indexOf('publish(seal.result'));
  const generated="import assert from 'node:assert/strict';\nimport {Primary,errorRecord} from './frozen/auth.mjs';\nimport {openCapturePair} from './frozen/direct-child.mjs';\n"+body+"\nexport const authorRows=rows;\n";
  fs.writeFileSync(own+'author-pure.mjs',generated,{flag:'wx',mode:384});
  const local={};for(const name of ['review.mjs','pure.mjs','author-pure.mjs']){const file=read(own+name);local[name]={bytes:file.bytes.length,sha256:file.sha256};}
  write('PRESEAL.json',{schema:'b35-v4-independent-pure-v1',utc:new Date().toISOString(),authorSource:'18e4c9a717809edd10230e3e5187111d9ed304b1',evidence:'1d961cedac4fbaf5a3d6380596c149075b049fc4',authorSeal:seal.sha256,bindings,comparison,reversePatch:true,local,authorGroups:8,novelGroups:['N01-first-undefined','N02-first-null','N03-first-false','N04-first-zero','N05-empty-string-double','N06-negative-zero-double','N07-row-publication-throws','N08-success-flags-fd-zero'],node:config.node,package:config.originalPackage,limits:{helpers:1,childMs:30000,capture:1048576,roles:28,peak:3,taskMs:600000},qualification:'Author assertion body unchanged; only stale author dispatch/deadline/publication replaced by independent sealed outer capture. No native fault injection.'});
  record({prepared:true,bindings:bindings.length,comparisons:comparison.length,reversePatch:true});
 }else if(phase==='run'){
  const seal=json(own+'PRESEAL.json');for(const [name,pin]of Object.entries(seal.local)){const file=read(own+name);assert.equal(file.sha256,pin.sha256);assert.equal(file.bytes.length,pin.bytes);}for(const pin of seal.bindings){const actual=read(pin.path);assert.equal(actual.sha256,pin.sha256);const frozen=read(own+'frozen/'+pin.path.slice(pin.path.lastIndexOf('/')+1));assert.equal(frozen.sha256,pin.sha256);}
  const child=spawnSync(node,[own+'pure.mjs'],{stdio:['ignore',output,error],timeout:30000,killSignal:'SIGKILL',env:{PATH:'',LANG:'C',LC_ALL:'C',TZ:'UTC'}});record({pid:child.pid,status:child.status,signal:child.signal,error:child.error?.message,returned:true});assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0);assert(fs.fstatSync(output).size+fs.fstatSync(error).size<=1048576);
  for(const pin of seal.bindings)assert.equal(read(pin.path).sha256,pin.sha256);record({postguards:seal.bindings.length,stdout:fs.fstatSync(output).size,stderr:fs.fstatSync(error).size});
 }else throw Error('phase');
}catch(reason){record({failed:true,message:String(reason)});fs.writeSync(error,String(reason.stack??reason)+'\n');process.exitCode=1;}
finally{for(const fd of [output,error,journal]){fs.fsyncSync(fd);fs.closeSync(fd);}}
