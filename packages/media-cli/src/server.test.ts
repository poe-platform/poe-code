import{expect,it,vi}from'vitest';
import {createHash} from 'node:crypto';
import {Volume,createFsFromVolume} from 'memfs';
import {createMediaBuildReceipt} from './build-receipt.js';
import{createMediaDeployment,mediaFrontendContract}from'./server.js';
import{mediaFrontendContract as portableFrontendContract}from'./frontend-contract.js';
function deployment(){
 const volume=Volume.fromJSON({'/assets/ffmpeg':'pinned executable'});
 const fs=createFsFromVolume(volume);
 const digest=createHash('sha256').update('pinned executable').digest('hex');
 const query={query:{executable:'/assets/ffmpeg',args:[]},outcome:{kind:'exited' as const,exitCode:0},stdout:'',stderr:''};
 const inventory={identity:{imageDigest:'sha256:'+digest,os:'linux',architecture:'x86_64',...mediaFrontendContract,launcherRevision:'fixture',bridgeRevision:'fixture',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['fixture only']},frontendContract:mediaFrontendContract,executablePaths:{ffmpeg:'/assets/ffmpeg'},expectedExecutableDigests:{ffmpeg:digest},files:[{path:'/assets/ffmpeg',type:'file' as const,sha256:digest}],records:{codecs:query,coders:query,delegates:query,fonts:query,policy:query,configure:query},maxFiles:4,maxRecordBytes:8192};
 const build=structuredClone(createMediaBuildReceipt(inventory).build);
 const limits={maxJobs:2,maxHandles:4,maxArgvBytes:64,maxManifestEntries:8,maxFrameBytes:4096,maxInflightBytes:8192,maxBlobBytes:8192,maxReplayBytes:65536,maxCallbacks:8,maxNativeMemoryBytes:8192,maxNativeProcesses:4,maxJobDurationMs:10000};
 const options={build,inventory,maxAssetBytes:64,executables:{ffmpeg:'/assets/ffmpeg'},maxExecutableBytes:64,server:{authenticate:vi.fn(async(request:Request)=>request.headers.get('Authorization')==='Bearer fixture'?{tenantId:'fixture',principalId:'owner',expiresAt:Number.MAX_SAFE_INTEGER}:null),driver:{features:[],inspectBuild:vi.fn(async()=>build),admitSession:vi.fn()},admissions:{record:vi.fn(async()=>{}),inspect:vi.fn(async()=>null)},storage:{append:vi.fn(),read:vi.fn(),remove:vi.fn()},limits,maxDocumentBytes:16384,maxRecords:32,leaseMs:10000,retentionMs:20000}};
 const open=vi.fn((path:string)=>fs.createReadStream(path));
 const type=vi.fn(async(path:string)=>{const stat=await fs.promises.lstat(path);return stat.isSymbolicLink()?'symlink':stat.isFile()?'file':'other';});
 return {volume,options,open,type};
}
it('verifies deployment assets through prototype methods with their original storage owner',async()=>{
 const f=deployment();
 class Storage {
  constructor(readonly selected:typeof f) {}
  open(path:string){return this.selected.open(path);}
  type(path:string){return this.selected.type(path);}
 }
 const assets=new Storage(f);
 const service=await createMediaDeployment(f.options,assets);
 try {
  expect(f.open).toHaveBeenCalledTimes(2);
  expect(f.type).toHaveBeenCalledWith('/assets/ffmpeg');
 } finally {await service.close();}
});
it('refuses changed executable bytes before creating the media service',async()=>{
 const f=deployment();f.volume.writeFileSync('/assets/ffmpeg','changed executable');
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toThrow('Executable digest mismatch: ffmpeg');
 expect(f.open).toHaveBeenCalledWith('/assets/ffmpeg');
 expect(f.options.server.authenticate).not.toHaveBeenCalled();expect(f.options.server.driver.admitSession).not.toHaveBeenCalled();
});
it('awaits streaming verification before exposing the authenticated service',async()=>{
 const f=deployment();let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const open=async function*(path:string){await ready;yield f.volume.readFileSync(path) as Buffer;};
 let exposed=false;const pending=Promise.resolve().then(()=>createMediaDeployment(f.options,{open,type:f.type})).then(service=>{exposed=true;return service;});
 await new Promise<void>(resolve=>setImmediate(resolve));const before=exposed;release();const service=await pending;
 expect(before).toBe(false);expect(service.fetch).toBeTypeOf('function');
 expect((await service.fetch(new Request('https://media.test/v1/capabilities'))).status).toBe(401);
});
it('snapshots the executable pins and build before asynchronous verification',async()=>{
 const f=deployment();let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const open=async function*(path:string){await ready;yield f.volume.readFileSync(path) as Buffer;};
 const pending=Promise.resolve().then(()=>createMediaDeployment(f.options,{open,type:f.type}));
 await new Promise<void>(resolve=>setImmediate(resolve));
 f.options.executables.ffmpeg='/unverified';f.options.build.executables.ffmpeg='b'.repeat(64);f.options.build.grammarRevision='other';release();
 const service=await pending;
 const response=await service.fetch(new Request('https://media.test/v1/capabilities',{headers:{Authorization:'Bearer fixture','Execution-Protocol':'1'}}));
 expect(response.status).toBe(200);
 expect((await response.json()).builds[0]).toMatchObject({...mediaFrontendContract,executables:{ffmpeg:createHash('sha256').update('pinned executable').digest('hex')}});
});
it('checks the same frontend build identity that is retained for deployment',async()=>{
 const f=deployment();let reads=0;
 const admitted=structuredClone(f.options.build);
 Object.defineProperty(f.options,'build',{get(){return ++reads<=2?admitted:{...admitted,grammarRevision:'unqualified'};}});
 const service=await createMediaDeployment(f.options,{open:f.open,type:f.type});
 const response=await service.fetch(new Request('https://media.test/v1/capabilities',{headers:{Authorization:'Bearer fixture','Execution-Protocol':'1'}}));
 expect(response.status).toBe(200);
 expect((await response.json()).builds[0]).toMatchObject(mediaFrontendContract);
 expect(reads).toBe(1);
});
it('retains admission ceilings and the selected isolation owner while assets are verified',async()=>{
 const f=deployment();let release!:()=>void;
 const ready=new Promise<void>(resolve=>{release=resolve;});
 const open=async function*(path:string){await ready;yield f.volume.readFileSync(path) as Buffer;};
 const originalLimit=f.options.server.limits.maxJobs;
 const inspect=f.options.server.driver.inspectBuild;
 const admit=f.options.server.driver.admitSession;
 admit.mockResolvedValue({async close(){},async prepare(){throw new Error('No invocation in startup test');}});
 const replacement=vi.fn(async()=>({...f.options.build,policyDigest:'b'.repeat(64)}));
 const replacementAdmit=vi.fn();
 const pending=createMediaDeployment(f.options,{open,type:f.type});
 f.options.server.limits.maxJobs=99;
 f.options.server.driver.features.push({name:'live-files',evidence:['unverified replacement']} as never);
 f.options.server.driver.inspectBuild=replacement;
 f.options.server.driver.admitSession=replacementAdmit;
 release();const service=await pending;
 try{
  const headers={Authorization:'Bearer fixture','Execution-Protocol':'1'};
  const capabilities=await(await service.fetch(new Request('https://media.test/v1/capabilities',{headers}))).json();
  expect(capabilities.limits.maxJobs).toBe(originalLimit);expect(capabilities.features).not.toContain('live-files');
  const request={buildDigest:f.options.build.digest,bindings:[],limits:capabilities.limits};
  const response=await service.fetch(new Request('https://media.test/v1/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'selected-owner'},body:JSON.stringify(request)}));
  expect(response.status).toBe(200);expect(admit).toHaveBeenCalledOnce();expect(replacementAdmit).not.toHaveBeenCalled();
  expect(inspect).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();
 }finally{await service.close();}
});
it.each([0,-1,Infinity,1.5])('refuses an invalid executable size bound %s before reading assets',async maxExecutableBytes=>{
 const f=deployment();f.options.maxExecutableBytes=maxExecutableBytes;
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toThrow('Invalid executable byte bound');
 expect(f.open).not.toHaveBeenCalled();
});
it('refuses a missing installed executable instead of admitting its declared digest',async()=>{
 const f=deployment();f.volume.unlinkSync('/assets/ffmpeg');
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toMatchObject({code:'ENOENT'});
});
it('checks every configured output-capable tool before exposing a deployment',async()=>{
 const f=deployment();f.volume.writeFileSync('/assets/magick','different executable');
 const inventory={...f.options.inventory,executablePaths:{...f.options.inventory.executablePaths,magick:'/assets/magick'},expectedExecutableDigests:{...f.options.inventory.expectedExecutableDigests,magick:f.options.build.executables.ffmpeg},files:[...f.options.inventory.files,{path:'/assets/magick',type:'file' as const,sha256:f.options.build.executables.ffmpeg}]};
 const options={...f.options,inventory,executables:{...f.options.executables,magick:'/assets/magick'},build:createMediaBuildReceipt(inventory).build};
 await expect(Promise.resolve().then(()=>createMediaDeployment(options,{open:f.open,type:f.type}))).rejects.toThrow('Executable digest mismatch: magick');
 expect(f.open.mock.calls.map(([path])=>path)).toEqual(['/assets/ffmpeg','/assets/magick']);
});
it('rejects a deployment whose native build is not bound to this JS frontend before creating server resources',()=>{
 expect(()=>createMediaDeployment({build:{grammarRevision:'wrong',sourceRevision:'wrong'}as never,executables:{},server:{}as never})).toThrow('frontend');
 expect(mediaFrontendContract.grammarRevision).toContain('ffmpeg');expect(mediaFrontendContract.grammarRevision).toContain('imagemagick');
});
it('uses the same immutable frontend identity for the portable SDK and native deployment',()=>{
 expect(portableFrontendContract).toBe(mediaFrontendContract);
 expect(Object.isFrozen(portableFrontendContract)).toBe(true);
});
it('keeps the shipped frontend identity immutable so callers cannot authorize another native baseline',()=>{
 const original={...mediaFrontendContract};
 expect(Reflect.set(mediaFrontendContract,'grammarRevision','other-native-grammar')).toBe(false);
 expect(Reflect.set(mediaFrontendContract,'sourceRevision','other-native-source')).toBe(false);
 expect(mediaFrontendContract).toEqual(original);
});
it('refuses missing deployment inventory before exposing a service',async()=>{
 const f=deployment();
 await expect(Promise.resolve().then(()=>createMediaDeployment({...f.options,inventory:undefined} as never,{open:f.open,type:f.type}))).rejects.toThrow('Pinned deployment inventory required');
 expect(f.options.server.authenticate).not.toHaveBeenCalled();
});
it('rejects a forged build inventory before opening any executable',async()=>{
 const f=deployment();f.options.build.policyDigest='b'.repeat(64);
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toThrow('Build inventory mismatch');
 expect(f.open).not.toHaveBeenCalled();expect(f.type).not.toHaveBeenCalled();
});
it('rejects invalid asset capacity before opening any executable',async()=>{
 const f=deployment();f.options.maxAssetBytes=0;
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toThrow('Invalid asset byte bound');
 expect(f.open).not.toHaveBeenCalled();
});
it('rejects executable paths outside the recorded deployment even when bytes match',async()=>{
 const f=deployment();f.volume.writeFileSync('/unrecorded','pinned executable');f.options.executables.ffmpeg='/unrecorded';
 await expect(Promise.resolve().then(()=>createMediaDeployment(f.options,{open:f.open,type:f.type}))).rejects.toThrow('Executable paths do not match deployment inventory');
 expect(f.open).not.toHaveBeenCalled();
});
