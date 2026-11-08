/** Portable verification before native asset admission or inventory execution. */
import {digestAsset} from './asset-digest.js';
import type {FileSystem} from '@poe-code/safe-fs/core';

export interface MediaExecutableAssets {
 executablePaths:Readonly<Record<string,string>>;
 expectedExecutableDigests:Readonly<Record<string,string>>;
 /** Per-executable byte bound; defaults to Infinity. */
 maxExecutableBytes?:number;
 /** Explicit filesystem authority; streaming reads are required. */
 fs?:FileSystem;
 /** Injectable streaming storage for in-memory tests; never collects a file. */
 open?:(path:string)=>AsyncIterable<Uint8Array>;
}
export async function verifyMediaExecutableAssets(input:MediaExecutableAssets):Promise<void>{
 const {maxExecutableBytes:maxBytes=Infinity}=input;
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<1))throw new TypeError('Invalid executable byte bound');
 const paths=Object.entries(input.executablePaths);
 if(!paths.length||paths.length!==Object.keys(input.expectedExecutableDigests).length)throw new TypeError('Executable pins must match configured paths');
 // Validate the complete configuration before opening any native asset.
 const entries=paths.map(([name,path])=>{
  const expected=input.expectedExecutableDigests[name];
  if(!Object.hasOwn(input.expectedExecutableDigests,name)||typeof expected!=='string'||expected.length!==64||Array.from(expected).some(c=>!'0123456789abcdef'.includes(c)))throw new TypeError('Invalid executable digest: '+name);
  if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0')||path.slice(1).split('/').some(part=>!part||part==='.'||part==='..')||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new TextEncoder().encode(path))!==path)throw new TypeError('Invalid executable path: '+name);
  return {name,path,expected};
 });
 const fs=input.fs;
 const open=input.open?.bind(input)??fs?.readStream?.bind(fs);
 if(!open)throw new TypeError('Streaming asset filesystem required');
 for(const {name,path,expected} of entries){
  if(await digestAsset(open(path),maxBytes,'Executable byte bound: '+name)!==expected)throw new TypeError('Executable digest mismatch: '+name);
 }
}
