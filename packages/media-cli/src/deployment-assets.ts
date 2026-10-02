import {digestAsset} from './asset-digest.js';
import type {FileSystem} from '@poe-code/safe-fs/core';
import {equalInventory} from './inventory-equality.js';
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
 fs?:FileSystem;
 assets?:Partial<MediaDeploymentAssetStorage>;
}):Promise<void> {
 const maxAssetBytes=input.maxAssetBytes;
 if(!Number.isSafeInteger(maxAssetBytes)||maxAssetBytes<1)throw new TypeError('Invalid asset byte bound');
 if(!input.inventory)throw new TypeError('Pinned deployment inventory required');
 // Receipt construction admits the complete metadata budget before retaining a
 // snapshot. Compare every build field, including raw inventories and policy.
 const receipt=createMediaBuildReceipt(input.inventory);
 if(!equalInventory(receipt.build,input.build))throw new TypeError('Build inventory mismatch');
 const storage=input.assets;
 const fs=input.fs;
 const open=storage?.open?.bind(storage)??fs?.readStream?.bind(fs);
 const stat=fs?.lstat.bind(fs);
 const kind=storage?.type?.bind(storage)??(stat?async(path:string)=>(await stat(path)).type:undefined);
 const link=storage?.readlink?.bind(storage)??fs?.readlink?.bind(fs);
 if(!open||!kind)throw new TypeError('Streaming asset filesystem required');
 for(const file of receipt.fileDigests) {
  if(await kind(file.path)!==file.type)throw new TypeError('Asset type mismatch: '+file.path);
  if(file.type==='symlink') {
   if(!link)throw new TypeError('Asset filesystem readlink required');
   if(await link(file.path)!==file.target)throw new TypeError('Asset symlink mismatch: '+file.path);
  } else {
   if(await digestAsset(open(file.path),maxAssetBytes,'Asset byte bound: '+file.path)!==file.sha256)throw new TypeError('Asset digest mismatch: '+file.path);
  }
 }
}
