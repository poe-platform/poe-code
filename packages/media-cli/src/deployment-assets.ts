import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, readlink} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import type {Build} from '@poe-code/remote-execution/wire';
import {createMediaBuildReceipt, type MediaBuildReceiptInput} from './build-receipt.js';

export interface MediaDeploymentAssetStorage {
 open(path:string):AsyncIterable<Uint8Array>;
 type(path:string):Promise<string>;
 readlink(path:string):Promise<string>;
}
/** Verifies the declared installed assets of an authenticated immutable deployment.
 * This does not qualify native mediation or authenticate the container runtime. */
export async function verifyMediaDeploymentAssets(input:{
 build:Build; inventory:MediaBuildReceiptInput; maxAssetBytes:number;
 assets?:Partial<MediaDeploymentAssetStorage>;
}):Promise<void> {
 const maxAssetBytes=input.maxAssetBytes;
 if(!Number.isSafeInteger(maxAssetBytes)||maxAssetBytes<1)throw new TypeError('Invalid asset byte bound');
 if(!input.inventory)throw new TypeError('Pinned deployment inventory required');
 // Receipt construction admits the complete metadata budget before retaining a
 // snapshot. Compare every build field, including raw inventories and policy.
 const receipt=createMediaBuildReceipt(input.inventory);
 if(!isDeepStrictEqual(receipt.build,input.build))throw new TypeError('Build inventory mismatch');
 const storage=input.assets;
 const open=storage?.open?.bind(storage)??createReadStream;
 const kind=storage?.type?.bind(storage)??(async(path:string)=>{const stat=await lstat(path);return stat.isSymbolicLink()?'symlink':stat.isFile()?'file':'other';});
 const link=storage?.readlink?.bind(storage)??readlink;
 for(const file of receipt.fileDigests) {
  if(await kind(file.path)!==file.type)throw new TypeError('Asset type mismatch: '+file.path);
  if(file.type==='symlink') {
   if(await link(file.path)!==file.target)throw new TypeError('Asset symlink mismatch: '+file.path);
  } else {
   const hash=createHash('sha256');let size=0;
   for await(const bytes of open(file.path)) {
    if(!(bytes instanceof Uint8Array))throw new TypeError('Asset byte bound: '+file.path);
    const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(bytes) as number;
    if(length>maxAssetBytes-size)throw new TypeError('Asset byte bound: '+file.path);
    size+=length;hash.update(bytes);
   }
   if(hash.digest('hex')!==file.sha256)throw new TypeError('Asset digest mismatch: '+file.path);
  }
 }
}
