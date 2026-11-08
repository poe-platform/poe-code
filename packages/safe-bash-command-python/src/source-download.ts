import {bytesToHex} from 'safe-bash-io-engine/byte-encoding';
import type {CommandContext} from 'safe-bash-contracts';
import {dirname,resolvePath} from 'safe-bash-contracts/path';
import {createPythonBuildEnvironment} from './build-environment.js';
import type {PythonPackageOptions} from './provisioning.js';
import {sha224,sha256,sha384,sha512} from '@noble/hashes/sha2.js';
import {sha1,md5} from '@noble/hashes/legacy.js';
import {pythonPackageUrlHash} from './package-url-hash.js';
import {openPythonPackageFile} from './package-file.js';
import type {HttpTransport} from 'safe-bash-network-engine/types';

async function* verifiedBytes(source:AsyncIterable<Uint8Array>,expected:ReturnType<typeof pythonPackageUrlHash>,maxBytes:number,signal:AbortSignal):AsyncGenerator<Uint8Array>{
 const checksum=expected?{sha1,sha224,sha384,sha256,sha512,md5}[expected[0]].create():undefined;
 let count=0;
 try{
  for await(const bytes of source){
   signal.throwIfAborted();
   if(!(bytes instanceof Uint8Array))throw new TypeError('Python package body must yield bytes');
   if(bytes.length>maxBytes-count)throw new Error('Package download exceeds maxDownloadBytes');
   count+=bytes.length;
   for(let offset=0;offset<bytes.length;offset+=65536){
    signal.throwIfAborted();const chunk=bytes.subarray(offset,offset+65536);
    checksum?.update(chunk);yield chunk;
   }
  }
  if(checksum&&bytesToHex(checksum.digest())!==expected![1])throw new Error('Python source archive integrity mismatch: '+expected![0]);
 }finally{checksum?.destroy();}
}

/** Reuse package authorization, integrity and caller-backed acquisition for source archives. */
export async function downloadPythonSourceArchive(url:URL,path:string,options:PythonPackageOptions,context:CommandContext):Promise<{readonly url:string;readonly headers:readonly (readonly [string,string])[]}>{
 const {fs,signal}=context,cacheDirectory=resolvePath(context.cwd,options.cacheDirectory??dirname(path));
 const caps=await fs.capabilitiesFor?.(cacheDirectory,{signal})??fs.capabilities;
 if(!caps.retainedStagingWrite||!caps.retainedStagingCleanup||!caps.retainedRead||!caps.atomicFileStaging||!fs.createStagedFile||!fs.openReadFile||!fs.publishStagedFile||!fs.confineExtraction)throw new Error('Remote Python sources require retained caller storage');
 const output=await fs.confineExtraction([dirname(path)],{signal});
 if(!output.writeStream)throw new Error('Remote Python sources require streaming writes');
 const expected=pythonPackageUrlHash(url.href),supplied=options.transport,maxBytes=options.maxDownloadBytes??Infinity;
 // Reject a new response before the package cache publishes its staged bytes.
 // Cached responses are independently verified again during the source copy.
 const transport=supplied&&expected?Object.assign(async(request:Parameters<HttpTransport>[0])=>{
  const response=await supplied(request);
  return response.status>=200&&response.status<300?{
   status:response.status,statusText:response.statusText,headers:response.headers,
   ...response.httpVersion===undefined?{}:{httpVersion:response.httpVersion},
   ...response.contentDecoded===undefined?{}:{contentDecoded:response.contentDecoded},
   body:verifiedBytes(response.body,expected,maxBytes,signal),dispose:response.dispose.bind(response),
  }:response;
 },supplied.supportsPrivateNetworkDeny?{supportsPrivateNetworkDeny:true as const}:{}):supplied;
 const environment=createPythonBuildEnvironment({...options,...transport?{transport}:{},cacheDirectory});
 try{
  const start=await environment.prepare({...context,requirements:[],requirementFiles:[]});
  try{
   const address=new URL(url);address.hash='';
   const receipt=await environment.dispatch('package-open',[start.session,address.href],context) as {key:string;size:number;url:string;headers:readonly (readonly [string,string])[]};
   let consumed=false;
   const bytes=verifiedBytes((async function*(){
    for(let offset=0;offset<receipt.size;){
     const chunk=await environment.dispatch('package-read',[start.session,receipt.key,offset,Math.min(65536,receipt.size-offset)],context) as number[];
     if(!chunk.length)throw new Error('Remote Python source ended early');
     offset+=chunk.length;yield Uint8Array.from(chunk);
    }
    consumed=true;
   })(),expected,maxBytes,signal);
   try{await output.writeStream(path,bytes,{flag:'wx',mode:0o600,signal});if(!consumed)throw new Error('Remote Python source write ended early');}
   finally{await bytes.return(undefined);}
   return {url:receipt.url,headers:receipt.headers};
  }finally{await environment.finish(start);}
 }finally{await environment.dispose();}
}

/** Authenticate local archives while copying into the owned extraction staging tree. */
export async function snapshotPythonSourceArchive(source:string,path:string,url:string,maxBytes:number,context:CommandContext):Promise<void>{
 const {fs,signal}=context;
 if(!fs.writeStream)throw new Error('Local Python sources require streaming writes');
 const file=await openPythonPackageFile(context,source,maxBytes);
 if(!file)throw new Error('Local Python sources require retained reads');
 const bytes=verifiedBytes((async function*(){
  for(let offset=0;offset<file.size;){
   const chunk=await file.read(offset,Math.min(65536,file.size-offset));
   offset+=chunk.length;yield chunk;
  }
 })(),pythonPackageUrlHash(url),maxBytes,signal);
 let complete=false;
 try{
  await fs.writeStream(path,(async function*(){yield* bytes;complete=true;})(),{flag:'wx',mode:0o600,signal});
  if(!complete)throw new Error('Local Python source write ended early');
 }finally{try{await bytes.return(undefined);}finally{await file.close();}}
}
