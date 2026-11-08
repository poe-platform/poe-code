import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createHash} from 'node:crypto';
import {Volume, createFsFromVolume} from 'memfs';
import {expect, it, vi} from 'vitest';
import {verifyMediaDeploymentAssets} from './deployment-assets.js';
import {createMediaBuildReceipt} from './build-receipt.js';
import {mediaFrontendContract} from './frontend-contract.js';

function fixture() {
 const volume=Volume.fromJSON({'/assets/ffmpeg':'tool','/assets/policy.xml':'policy','/assets/font.ttf':'font','/assets/profile.icc':'profile','/assets/lib.so':'library'});
 volume.symlinkSync('lib.so','/assets/library');
 const fs=createFsFromVolume(volume);
 const files=Object.keys(volume.toJSON()).filter(path=>path!=='/assets/library').map(path=>({path,type:'file' as const,sha256:createHash('sha256').update(volume.readFileSync(path) as Buffer).digest('hex')}));
 const query={query:{executable:'/assets/ffmpeg',args:[]},outcome:{kind:'exited' as const,exitCode:0},stdout:'fixture',stderr:''};
 const inventory={identity:{imageDigest:'sha256:'+'a'.repeat(64),os:'linux',architecture:'x86_64',...mediaFrontendContract,launcherRevision:'fixture',bridgeRevision:'fixture',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['fixture only']},frontendContract:mediaFrontendContract,executablePaths:{ffmpeg:'/assets/ffmpeg'},expectedExecutableDigests:{ffmpeg:files.find(file=>file.path==='/assets/ffmpeg')!.sha256},files:[...files,{path:'/assets/library',type:'symlink' as const,target:'lib.so'}],records:{codecs:query,coders:query,delegates:query,fonts:query,policy:query,configure:query},maxFiles:16,maxRecordBytes:16384};
 const build=createMediaBuildReceipt(inventory).build;
 const assets={open:vi.fn((path:string)=>fs.createReadStream(path)),type:vi.fn(async(path:string)=>{const stat=await fs.promises.lstat(path);return stat.isSymbolicLink()?'symlink':stat.isFile()?'file':'other';}),readlink:vi.fn(async(path:string)=>String(await fs.promises.readlink(path)))};
 return {volume,inventory,build,assets,maxAssetBytes:64};
}

it.each(['/assets/policy.xml','/assets/font.ttf','/assets/profile.icc','/assets/lib.so'])('refuses changed installed asset %s',async path=>{
 const f=fixture();f.volume.writeFileSync(path,'changed');
 await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Asset digest mismatch: '+path);
});
it('verifies regular asset streams and symlink identities without following symlinks',async()=>{
 const f=fixture();await verifyMediaDeploymentAssets(f);
 expect(f.assets.readlink).toHaveBeenCalledWith('/assets/library');
 expect(f.assets.open.mock.calls.map(([path])=>path)).not.toContain('/assets/library');
});
it.each([undefined,Infinity])('verifies deployment assets with an unlimited byte bound %s',async maxAssetBytes=>{
 const f=fixture();
 await expect(verifyMediaDeploymentAssets({...f,maxAssetBytes})).resolves.toBeUndefined();
 f.volume.writeFileSync('/assets/font.ttf','changed');
 await expect(verifyMediaDeploymentAssets({...f,maxAssetBytes})).rejects.toThrow('Asset digest mismatch');
});
it.each([0,-1,-Infinity,NaN,1.5,Number.MAX_SAFE_INTEGER+1,null])('rejects invalid asset byte bound %s before storage access',async maxAssetBytes=>{
 const f=fixture();
 await expect(verifyMediaDeploymentAssets({...f,maxAssetBytes:maxAssetBytes as number})).rejects.toThrow('Invalid asset byte bound');
 expect(f.assets.type).not.toHaveBeenCalled();expect(f.assets.open).not.toHaveBeenCalled();
});
it('rejects changed link targets and file types',async()=>{
 for(const target of ['/assets/lib.so','/assets/font.ttf']) {
  const f=fixture();f.volume.unlinkSync('/assets/library');f.volume.symlinkSync(target,'/assets/library');
  await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Asset symlink mismatch');
 }
 const f=fixture();f.volume.unlinkSync('/assets/font.ttf');f.volume.symlinkSync('ffmpeg','/assets/font.ttf');
 await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Asset type mismatch');
});
it.each(['inventoryDigest','librariesDigest','assetsDigest','policyDigest','configDigest','digest'] as const)('rejects a forged %s before storage access',async key=>{
 const f=fixture();f.build[key]='b'.repeat(64);
 await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Build inventory mismatch');
 expect(f.assets.type).not.toHaveBeenCalled();expect(f.assets.open).not.toHaveBeenCalled();
});
it('bounds and retires installed asset streams',async()=>{
 const f=fixture();let retired=false;
 f.assets.open=vi.fn(async function*(){try{yield new Uint8Array(65);throw new Error('read beyond bound');}finally{retired=true;}}) as never;
 await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Asset byte bound');
 expect(retired).toBe(true);
});
it('rejects the actual installed-asset span before hashing and ignores shadowed size properties',async()=>{
 const f=fixture();const length=vi.fn(()=>1);let retired=false;
 const bytes=new Uint8Array(65);Object.defineProperty(bytes,'byteLength',{get:length});
 f.assets.open=vi.fn(async function*(){try{yield bytes;}finally{retired=true;}}) as never;
 await expect(verifyMediaDeploymentAssets(f)).rejects.toThrow('Asset byte bound');
 expect(length).not.toHaveBeenCalled();expect(retired).toBe(true);
});
it('retains checked asset identities before asynchronous storage access',async()=>{
 const f=fixture();const first=f.assets.type.getMockImplementation()!;
 f.assets.type.mockImplementation(async path=>{f.inventory.files[1].sha256='b'.repeat(64);return first(path);});
 await expect(verifyMediaDeploymentAssets(f)).resolves.toBeUndefined();
});
it('retains the storage receiver and selected methods across asynchronous verification',async()=>{
 const f=fixture();const original=f.assets;
 const replacement=vi.fn(()=>{throw new Error('replacement storage must not run');});
 class Storage {
  constructor(readonly selected:typeof original) {}
  open(path:string){return this.selected.open(path);}
  async type(path:string){this.open=replacement;return this.selected.type(path);}
  readlink(path:string){return this.selected.readlink(path);}
 }
 const assets=new Storage(original);
 await expect(verifyMediaDeploymentAssets({...f,assets})).resolves.toBeUndefined();
 expect(replacement).not.toHaveBeenCalled();
 expect(original.readlink).toHaveBeenCalledWith('/assets/library');
});

it('verifies injected safe-fs files and symlinks without Node globals',async()=>{
 const f=fixture();const fs=new MemoryFileSystem();
 await fs.mkdir('/assets',{recursive:true});
 for(const file of f.inventory.files){
  if(file.type==='file')await fs.writeFile(file.path,new Uint8Array(f.volume.readFileSync(file.path) as Uint8Array));
  else await fs.symlink(file.target!,file.path);
 }
 vi.stubGlobal('Buffer',undefined);
 try {await verifyMediaDeploymentAssets({...f,assets:undefined,fs});}
 finally {vi.unstubAllGlobals();}
});

it('hashes intrinsic asset bytes despite overridden typed-array properties',async()=>{
 const f=fixture();const open=f.assets.open.getMockImplementation()!;
 const poisoned=vi.fn(()=>{throw new Error('Overridden byte view accessed');});
 f.assets.open.mockImplementation(async function*(path:string){
  for await(const chunk of open(path)){
   const bytes=new Uint8Array(chunk);
   for(const key of ['length','byteOffset','buffer','subarray'])Object.defineProperty(bytes,key,{get:poisoned});
   yield bytes;
  }
 } as never);
 await verifyMediaDeploymentAssets(f);
 expect(poisoned).not.toHaveBeenCalled();
});
