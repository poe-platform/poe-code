import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {ByteSource} from '@poe-code/safe-fs/core';

/** Authenticate intrinsic bytes, never caller-overridden view properties. */
export async function digestAsset(source:ByteSource,maxBytes:number,boundError:string):Promise<string> {
 const prototype=Object.getPrototypeOf(Uint8Array.prototype);
 const lengthOf=Object.getOwnPropertyDescriptor(prototype,'byteLength')!.get!;
 const offsetOf=Object.getOwnPropertyDescriptor(prototype,'byteOffset')!.get!;
 const bufferOf=Object.getOwnPropertyDescriptor(prototype,'buffer')!.get!;
 const hash=sha256.create();let size=0;
 try {
  for await(const bytes of source){
   if(!(bytes instanceof Uint8Array))throw new TypeError(boundError);
   const length=lengthOf.call(bytes) as number;
   if(length>maxBytes-size)throw new TypeError(boundError);
   size+=length;
   hash.update(new Uint8Array(bufferOf.call(bytes),offsetOf.call(bytes),length));
  }
  return bytesToHex(hash.digest());
 }finally{hash.destroy();}
}
