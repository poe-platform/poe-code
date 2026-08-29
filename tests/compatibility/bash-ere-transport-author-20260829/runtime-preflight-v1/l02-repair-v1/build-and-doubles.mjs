import { ownChild } from "../preparation-r3/owned-process.mjs";
import { openSync, closeSync, writeSync, readSync, lstatSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const own=fileURLToPath(new URL('.',import.meta.url));
const capture=[];
let primary={present:false};
let result={schema:1,role:'strict-private12-build-and-package-DATA-only',children:[],workers:0,matchingCalls:0};
let captureBytes=0;
const begun=Date.now();
const deadline=begun+240000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function output(fd,bytes){captureBytes+=bytes.length;if(captureBytes>16*1024*1024)throw Error('capture cap');let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(count<=0)throw Error('capture write failure');offset+=count;}}
function read(path,maximum=8*1024*1024){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('regular bounded read '+path);const bytes=readFileSync(path);if(bytes.length!==stat.size)throw Error('read drift');return bytes;}
async function info(path,maximum=128*1024*1024){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('regular bounded hash '+path);const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){bytes+=chunk.length;if(bytes>stat.size)throw Error('hash drift');digest.update(chunk);}if(bytes!==stat.size)throw Error('hash short');return {path,size:bytes,mode:stat.mode&511,sha256:digest.digest('hex')};}
async function verify(row){const actual=await info(row.path);if(actual.size!==row.size||actual.sha256!==row.sha256||actual.mode!==row.mode)throw Error('input binding '+row.path);}
async function copyBounded(row,target){
  await verify(row);
  const descriptors=[];let copyPrimary={present:false};
  try{
    descriptors.push(openSync(row.path,'r'));descriptors.push(openSync(target,'wx'));
    const buffer=Buffer.alloc(65536);let offset=0;
    while(offset<row.size){const count=readSync(descriptors[0],buffer,0,Math.min(buffer.length,row.size-offset),offset);if(count<=0)throw Error('short sealed tool read');let written=0;while(written<count){const amount=writeSync(descriptors[1],buffer,written,count-written);if(amount<=0)throw Error('short sealed tool write');written+=amount;}offset+=count;}
  }catch(reason){copyPrimary={present:true,value:reason};throw reason;}
  finally{let cleanup={present:false};for(const fd of descriptors){try{closeSync(fd);}catch(reason){if(!cleanup.present)cleanup={present:true,value:reason};}}if(cleanup.present&&!copyPrimary.present)throw cleanup.value;}
  const actual=await info(target);if(actual.size!==row.size||actual.sha256!==row.sha256)throw Error('tool copy binding');
}
async function census(dir){const rows=[];async function visit(current){for(const name of readdirSync(current).sort()){const path=join(current,name);const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('linked output');if(stat.isDirectory())await visit(path);else rows.push(await info(path));if(rows.length>1024)throw Error('census cap');}}await visit(dir);if(rows.reduce((sum,row)=>sum+row.size,0)>256*1024*1024)throw Error('work cap');return rows;}
async function child(node,args,cwd,name,timeout){
 if(result.children.length>=2)throw Error('child count');
 const owned=await ownChild({node,args,cwd,role:name,env:{PATH:dirname(node),LANG:'C',LC_ALL:'C',HOME:cwd,TMPDIR:cwd},stdout:join(own,'BUILD',name+'.stdout'),stderr:join(own,'BUILD',name+'.stderr'),deadline:performance.now()+180000,reserveMilliseconds:10000,timeoutMilliseconds:timeout,channelBytes:4*1024*1024});
 const row=owned.record;result.children.push({...row,primary:row.primary.present?{present:true,kind:typeof row.primary.value}:{present:false}});if(row.state!=='RETIRED'||!row.captureComplete||row.primary.present||row.secondary.length){result.emergency=owned.emergency;throw Error('owned process stop');}return {code:row.code,text:read(join(own,'BUILD',name+'.stderr'),4*1024*1024).toString()+read(join(own,'BUILD',name+'.stdout'),4*1024*1024).toString()};
}

try{
  capture.push(openSync(join(own,'BUILD','owner.stdout'),'wx'));
  capture.push(openSync(join(own,'BUILD','owner.stderr'),'wx'));
  const sealBytes=read(join(own,'BUILD-PRESEAL.json'),1024*1024);
  if(hash(sealBytes)!==process.argv[2])throw Error('build preseal binding');
  const seal=JSON.parse(sealBytes);
  if(process.execPath!==seal.node.path)throw Error('Node path identity');
  for(const row of [seal.node,...seal.tools,...seal.fixtures])await verify(row);
  const inputs=JSON.parse(read(join(own,'SOURCES.json'),1024*1024));
  const work=join(own,'BUILD','work');mkdirSync(work);writeFileSync(join(work,'package.json'),JSON.stringify({type:'module'})+'\n',{flag:'wx'});
  const source=join(work,'source');mkdirSync(source);
  const packageText=JSON.stringify({type:'module'})+'\n';writeFileSync(join(source,'package.json'),packageText,{flag:'wx'});
  const files=[];
  for(const row of inputs.modules){if(!/^(?:transport\/)?[a-z-]+\.ts$/.test(row.name)||row.size>32768)throw Error('source row');const bytes=Buffer.from(row.base64,'base64');if(bytes.length!==row.size||hash(bytes)!==row.sha256)throw Error('source byte binding');const target=join(source,row.name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});files.push(target);}
  if(files.length!==12)throw Error('twelve source inputs');
  const toolRoot=join(work,'node_modules');for(const row of seal.tools){const target=join(toolRoot,row.relative);mkdirSync(dirname(target),{recursive:true});await copyBounded(row,target);}
  const before=await census(work);const emitted=join(own,'BUILD','emitted');const compiler=join(toolRoot,'typescript/lib/tsc.js');
  const build=await child(seal.node.path,[compiler,...seal.flags,'--typeRoots',join(toolRoot,'@types'),'--declaration','--outDir',emitted,'--rootDir',source,...files],work,'compiler',120000);
  result.compiler={code:build.code,diagnostics:build.text};if(build.code!==0)throw Error('strict build failure');
  const emittedRows=await census(emitted);if(emittedRows.length!==24)throw Error('unexpected emit census');result.emitted=emittedRows;
  const assets=emittedRows.map(row=>({name:'ere/'+relative(emitted,row.path),size:row.size,mode:420,sha256:row.sha256,bytes:read(row.path,65536)}));
  const metadata=Buffer.from(JSON.stringify({name:'@safe-bash-internal/ere-transport-review',version:'0.0.0-l02-repair-v1',private:true,type:'module',description:'Private reviewed ERE artifact; no public export or runtime dependency claim'},null,2)+'\n');assets.push({name:'package.json',size:metadata.length,mode:420,sha256:hash(metadata),bytes:metadata});assets.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const chunks=[];let tarBytes=1024;
  for(const asset of assets){const name='package/'+asset.name;if(Buffer.byteLength(name)>99||!/^[a-zA-Z0-9@/._-]+$/.test(name))throw Error('tar name');const header=Buffer.alloc(512);header.write(name,0,100,'ascii');function octal(value,start,width){const text=value.toString(8).padStart(width-1,'0')+'\0';header.write(text,start,width,'ascii');}octal(420,100,8);octal(0,108,8);octal(0,116,8);octal(asset.size,124,12);octal(0,136,12);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');let sum=0;for(const value of header)sum+=value;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');const padding=(512-asset.size%512)%512;tarBytes+=512+asset.size+padding;if(tarBytes>2*1024*1024)throw Error('tar cap');chunks.push(header,asset.bytes,Buffer.alloc(padding));}
  chunks.push(Buffer.alloc(1024));const tar=Buffer.concat(chunks,tarBytes);const {gzipSync}=await import('node:zlib');const gz=gzipSync(tar,{level:9,mtime:0});const text=Buffer.from(gz.toString('base64')+'\n');
  const producer={schema:1,role:'strict emitted internal USTAR package producer, not npm/full public package',presealSha256:hash(sealBytes),sourceManifestSha256:hash(read(join(own,'SOURCES.json'))),sourceModules:12,emissions:24,entries:assets.map(({bytes,...row})=>row),tarBytes:tar.length,tarSha256:hash(tar),compressedBytes:gz.length,compressedSha256:hash(gz),textBytes:text.length,textSha256:hash(text),format:'gzip USTAR; ASCII names, lexical byte order, all regular0644, uid/gid/mtime0; package/ prefix'};
  writeFileSync(join(own,'PACKAGE.tgz.base64.data'),text,{flag:'wx'});writeFileSync(join(own,'PRODUCER.json'),JSON.stringify(producer,null,2)+'\n',{flag:'wx'});
  for(const row of before)await verify(row);for(const row of [seal.node,...seal.tools,...seal.fixtures])await verify(row);
  result.archive=producer;const doubles=await child(seal.node.path,[join(own,'host-doubles.mjs')],own,'host-doubles',15000);result.doubles=doubles;if(doubles.code!==0)throw Error('host doubles failure');result.outputs=await census(join(own,'BUILD'));result.pass=true;
}catch(reason){primary={present:true,value:reason};result.failure={present:true,type:typeof reason,message:reason instanceof Error?reason.message.slice(0,4096):'non-Error primary'};process.exitCode=1;}
finally{result.elapsedMs=Date.now()-begun;result.captureBytes=captureBytes;result.knownChildren=result.children.length;result.closedChildren=result.children.filter(row=>row.closed).length;try{writeFileSync(join(own,'BUILD','RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}catch(reason){if(!primary.present)primary={present:true,value:reason};process.exitCode=1;}for(const fd of capture){try{closeSync(fd);}catch(reason){if(!primary.present)primary={present:true,value:reason};process.exitCode=1;}}console.log(JSON.stringify({pass:result.pass??false,children:result.knownChildren,closed:result.closedChildren,compiler:result.compiler?.code,emissions:result.emitted?.length,primaryPresent:primary.present}));}
