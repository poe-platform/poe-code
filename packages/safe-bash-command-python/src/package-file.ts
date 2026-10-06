import {yieldTurn} from 'safe-bash-contracts/yield';
import {sha256} from '@noble/hashes/sha2.js';
import {compareIdentity,compareFileVersion} from '@poe-code/safe-fs/runtime-core';
import type {PythonPackageContext} from './provisioning.js';

/** Retain canonical identity and authenticate without materializing the artifact. */
export async function openPythonPackageFile({fs,signal}:PythonPackageContext,path:string,maxBytes:number) {
 const settings={signal};
 const capabilities=await fs.capabilitiesFor?.(path,settings)??fs.capabilities;
 if(!capabilities.retainedRead||!fs.openReadFile)return undefined;
 const file=await fs.openReadFile(path,settings);
 try {
  signal.throwIfAborted();
  const state={...await file.stat(settings)};
  if(state.type!=='file'||!Number.isSafeInteger(state.size)||state.size<0)throw new Error('Invalid canonical Python wheel');
  if(state.size>maxBytes)throw new Error('Canonical package exceeds maxDownloadBytes');
  const check=async()=>{
   signal.throwIfAborted();
   const current=await file.stat(settings);
   if(compareIdentity(state,current)!=='same'||!compareFileVersion(state,current))throw new Error('Canonical Python wheel changed');
  };
  const read=async(offset:number,length:number)=>{
   await check();
   const count=Math.min(length,Math.max(0,state.size-offset));
   if(!count)return new Uint8Array(0);
   const bytes=Uint8Array.from(await file.read(offset,count,settings));
   if(!bytes.length||bytes.length>count)throw new Error('Invalid canonical package read');
   await check();
   return bytes;
  };
  const hash=sha256.create();
  for(let offset=0,pulls=0;offset<state.size;){if(++pulls%16===0)await yieldTurn(signal);const bytes=await read(offset,65536);hash.update(bytes);offset+=bytes.length;}
  await check();
  return {key:Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join(''),size:state.size,read,close:()=>file.close()};
 }catch(error){await file.close();throw error;}
}
