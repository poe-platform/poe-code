/** Node-only media deployment owner. No portable export imports this module. */
import {isDeepStrictEqual} from 'node:util';
import{createMediaServer,type MediaServerOptions,type MediaTool}from'@poe-code/remote-execution/server';
import type{Build}from'@poe-code/remote-execution/wire';
import{nativeReference}from'./options.generated.js';
import{imageMagickReference}from'./imagemagick.generated.js';
import{mediaFrontendContract}from'./frontend-contract.js';
import {verifyMediaExecutableAssets,type MediaExecutableAssets} from './build-assets.js';
import {createMediaBuildReceipt,type MediaBuildReceiptInput} from './build-receipt.js';
import {verifyMediaDeploymentAssets,type MediaDeploymentAssetStorage} from './deployment-assets.js';
export {verifyMediaDeploymentAssets,type MediaDeploymentAssetStorage} from './deployment-assets.js';
export {createMediaBuildReceipt,type MediaBuildReceiptInput,type MediaAssetDigest,type MediaInventoryRecord} from './build-receipt.js';
export {verifyMediaExecutableAssets,type MediaExecutableAssets} from './build-assets.js';
/** Source/native reference binding of the shipped JS grammars. A new production
 * baseline must qualify and regenerate these references; no host-path fallback. */
export {mediaFrontendContract};
export interface MediaDeploymentOptions {
 build:Build;
 /** Explicit paths inside the qualified remote build. Only known frontend tools
  * with pinned executable entries can be registered; clients cannot supply paths. */
 executables:Readonly<Record<string,string>>;
 /** Streaming verification bound for each installed executable, before service startup. */
 maxExecutableBytes:number;
 /** Complete pinned library, inventory, font/profile and policy/config receipt. */
 inventory:MediaBuildReceiptInput;
 /** Independent streaming bound for each declared regular asset. */
 maxAssetBytes:number;
 server:Omit<MediaServerOptions,'builds'|'tools'>;
}
export function createMediaDeployment(options:MediaDeploymentOptions,assets:Pick<MediaExecutableAssets,'open'> & Partial<MediaDeploymentAssetStorage>={}){
 // Retain the admitted build and paths before asynchronous storage access. A
 // mutable operator configuration cannot swap the checked executable afterward.
 const build=structuredClone(options.build);
 if(build.grammarRevision!==mediaFrontendContract.grammarRevision||build.sourceRevision!==mediaFrontendContract.sourceRevision)throw new TypeError('Native build does not match the shipped JS frontend contract');
 const executables={...options.executables};
 const suppliedServer=options.server;
 const driver=suppliedServer.driver;
 const server={...suppliedServer,limits:{...suppliedServer.limits},driver:{
  limits:{...driver.limits},features:structuredClone(driver.features),
  inspectBuild:driver.inspectBuild.bind(driver),admitSession:driver.admitSession.bind(driver),
 }};
 const maxExecutableBytes=options.maxExecutableBytes;
 const suppliedInventory=options.inventory;
 if(!suppliedInventory)throw new TypeError('Pinned deployment inventory required');
 // Admit receipt size before cloning operator metadata or yielding to storage.
 if(!isDeepStrictEqual(createMediaBuildReceipt(suppliedInventory).build,build))throw new TypeError('Build inventory mismatch');
 const inventory=structuredClone(suppliedInventory);
 if(Object.entries(executables).some(([name,path])=>!Object.hasOwn(inventory.executablePaths,name)||inventory.executablePaths[name]!==path))throw new TypeError('Executable paths do not match deployment inventory');
 const maxAssetBytes=options.maxAssetBytes;
 if(!Number.isSafeInteger(maxAssetBytes)||maxAssetBytes<1)throw new TypeError('Invalid asset byte bound');
 // Storage adapters may keep authority in their receiver or prototype. Retain
 // selected methods before yielding without discarding either ownership facet.
 const assetStorage={open:assets.open?.bind(assets),type:assets.type?.bind(assets),readlink:assets.readlink?.bind(assets)};
 const supported=new Set([...Object.keys(nativeReference.executables),...Object.entries(imageMagickReference.executables).filter(([,entry])=>entry.kind==='media').map(([name])=>name)]);
 const tools:MediaTool[]=Object.entries(executables).map(([id,executable])=>{
  if(!supported.has(id)||!Object.hasOwn(build.executables,id)||!executable.startsWith('/')||executable.includes('\0'))throw new TypeError('Media executable is not registered and pinned');
  return {id,executable,buildDigest:build.digest,requiredFeatures:['live-files'],requiresFrontendContract:true};
 });
 if(!tools.length)throw new TypeError('No configured media tools');
 return verifyMediaExecutableAssets({executablePaths:executables,expectedExecutableDigests:Object.fromEntries(tools.map(tool=>[tool.id,build.executables[tool.id]])),maxExecutableBytes,open:assetStorage.open})
  .then(()=>verifyMediaDeploymentAssets({build,inventory,maxAssetBytes,assets:assetStorage}))
  .then(()=>createMediaServer({...server,builds:[build],tools}));
}
