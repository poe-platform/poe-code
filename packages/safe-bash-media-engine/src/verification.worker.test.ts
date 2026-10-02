import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

it('verifies receipts, streamed files and symlinks in workerd without Node compatibility',async()=>{
 const bundle=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,contents:`
  import {MemoryFileSystem} from '@poe-code/safe-fs/core';
  import {createMediaBuildReceipt,verifyMediaExecutableAssets,verifyMediaDeploymentAssets} from 'safe-bash-media-engine/verification';
  export default {async fetch(){
   if(typeof Buffer!=='undefined'||typeof process!=='undefined')throw new Error('Node globals must be absent');
   const fs=new MemoryFileSystem();
   await fs.mkdir('/assets');await fs.writeFile('/assets/tool',new TextEncoder().encode('abc'));
   await fs.symlink('tool','/assets/link');
   const hash='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
   const executablePaths={tool:'/assets/tool'},expectedExecutableDigests={tool:hash};
   const query={query:{executable:'/assets/tool',args:[]},outcome:{kind:'exited',exitCode:0},stdout:'unicode: é 😀',stderr:''};
   const inventory={identity:{imageDigest:'sha256:'+hash,os:'linux',architecture:'x86_64',grammarRevision:'g',sourceRevision:'s',launcherRevision:'l',bridgeRevision:'b',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:[]},frontendContract:{grammarRevision:'g',sourceRevision:'s'},executablePaths,expectedExecutableDigests,
    files:[{path:'/assets/tool',type:'file',sha256:hash},{path:'/assets/link',type:'symlink',target:'tool'}],records:{codecs:query,coders:query,delegates:query,fonts:query,policy:query,configure:query}};
   const receipt=createMediaBuildReceipt(inventory);
   const unlimited=createMediaBuildReceipt({...inventory,maxFiles:Infinity,maxRecordBytes:Infinity});
   if(unlimited.build.digest!==receipt.build.digest)throw new Error('Limit-dependent receipt');
   for(const bound of [undefined,Infinity,3]){
    await verifyMediaExecutableAssets({fs,executablePaths,expectedExecutableDigests,maxExecutableBytes:bound});
    await verifyMediaDeploymentAssets({fs,build:receipt.build,inventory,maxAssetBytes:bound});
   }
   await fs.writeFile('/assets/tool',new TextEncoder().encode('abd'));
   let drift=false;try{await verifyMediaDeploymentAssets({fs,build:receipt.build,inventory,maxAssetBytes:3});}catch(error){drift=error.message.includes('digest mismatch');}
   return Response.json({drift,digest:receipt.build.digest});
  }};
 `},platform:'browser',conditions:['workerd'],format:'esm',bundle:true,write:false});
 const worker=new Miniflare({modules:true,script:bundle.outputFiles[0]!.text,compatibilityDate:'2026-07-01'});
 try {
  const response=await worker.dispatchFetch('https://verification.test');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({drift:true,digest:expect.stringMatching(/^[a-f0-9]{64}$/)});
 }finally{await worker.dispose();}
});
