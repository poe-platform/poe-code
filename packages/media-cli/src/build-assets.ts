/** Node-only verification before native asset admission or inventory execution. */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

export interface MediaExecutableAssets {
 executablePaths:Readonly<Record<string,string>>;
 expectedExecutableDigests:Readonly<Record<string,string>>;
 maxExecutableBytes:number;
 /** Injectable streaming storage for in-memory tests; never collects a file. */
 open?:(path:string)=>AsyncIterable<Uint8Array>;
}
export async function verifyMediaExecutableAssets(input:MediaExecutableAssets):Promise<void>{
 const maxBytes=input.maxExecutableBytes;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new TypeError('Invalid executable byte bound');
 const paths=Object.entries(input.executablePaths);
 if(!paths.length||paths.length!==Object.keys(input.expectedExecutableDigests).length)throw new TypeError('Executable pins must match configured paths');
 // Validate the complete configuration before opening any native asset.
 const entries=paths.map(([name,path])=>{
  const expected=input.expectedExecutableDigests[name];
  if(!Object.hasOwn(input.expectedExecutableDigests,name)||typeof expected!=='string'||expected.length!==64||Array.from(expected).some(c=>!'0123456789abcdef'.includes(c)))throw new TypeError('Invalid executable digest: '+name);
  if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0')||path.slice(1).split('/').some(part=>!part||part==='.'||part==='..')||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new TextEncoder().encode(path))!==path)throw new TypeError('Invalid executable path: '+name);
  return {name,path,expected};
 });
 const open=input.open?.bind(input)??createReadStream;
 for(const {name,path,expected} of entries){
  const hash=createHash('sha256');let size=0;
  for await(const bytes of open(path)){
   if(!(bytes instanceof Uint8Array))throw new TypeError('Executable byte bound: '+name);
   const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(bytes) as number;
   if(length>maxBytes-size)throw new TypeError('Executable byte bound: '+name);
   size+=length;hash.update(bytes);
  }
  if(hash.digest('hex')!==expected)throw new TypeError('Executable digest mismatch: '+name);
 }
}
