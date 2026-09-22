import {expect, it} from 'vitest';
import {createMediaBuildReceipt} from './build-receipt.js';
const hash = 'a'.repeat(64);
it('pins admitted asset slots rather than an operator-supplied iterator',()=>{
 const value=input();
 const original=createMediaBuildReceipt(value);
 value.files[Symbol.iterator]=function*(){yield {path:'/unchecked/tool',type:'file' as const,sha256:hash};};
 expect(createMediaBuildReceipt(value)).toEqual(original);
});
it('cannot skip a malformed pinned policy asset through custom iteration',()=>{
 const value=input();value.files[1].sha256='invalid';
 value.files[Symbol.iterator]=function*(){yield value.files[0];};
 expect(()=>createMediaBuildReceipt(value)).toThrow('Invalid asset identity');
});
it('captures asset identity once before validation and digest construction',()=>{
 const value=input();let reads=0;
 Object.defineProperty(value.files[0],'path',{enumerable:true,get(){return ++reads===1?'/assets/tool':'/unchecked/tool';}});
 expect(createMediaBuildReceipt(value).build.executables).toEqual({tool:hash});
 expect(reads).toBe(1);
});
it('digests the same query record that passed native outcome admission',()=>{
 const value=input();let reads=0;
 Object.defineProperty(value.records,'codecs',{enumerable:true,get(){return ++reads===1?query:{...query,outcome:{kind:'exited',exitCode:999}};}});
 const receipt=createMediaBuildReceipt(value);
 expect(receipt.inventoryRecords.codecs.outcome).toEqual({kind:'exited',exitCode:0});
 expect(reads).toBe(1);
});
it('does not replace admitted query argv through an overridden iterator',()=>{
 const value=input();const args=['-codecs'];
 args[Symbol.iterator]=function*(){yield 'bad\0arg';};
 value.records.codecs={...query,query:{...query.query,args}};
 expect(createMediaBuildReceipt(value).inventoryRecords.codecs.query.args).toEqual(['-codecs']);
});
it.each([false,true])('refuses missing asset slots before inspecting asset records (inherited: %s)',inherited=>{
 const value=input();delete value.files[1];
 if(inherited)Object.setPrototypeOf(value.files,Object.assign(Object.create(Array.prototype),{1:input().files[1]}));
 Object.defineProperty(value.files[0],'path',{get(){throw new Error('Asset inspected before slot admission');}});
 expect(()=>createMediaBuildReceipt(value)).toThrow('Invalid inventory asset slots');
});
const query = {query:{executable:'/assets/tool',args:['-list','coder']},outcome:{kind:'exited' as const,exitCode:0},stdout:'PNG\nJPEG\n',stderr:''};
function input() {
  return {
    identity:{imageDigest:'sha256:'+hash,os:'linux',architecture:'x86_64',grammarRevision:'native-g',sourceRevision:'native-s',launcherRevision:'l',bridgeRevision:'unqualified',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['network denied']},
    frontendContract:{grammarRevision:'js-g',sourceRevision:'js-s'},
    executablePaths:{tool:'/assets/tool'},expectedExecutableDigests:{tool:hash},
    files:[{path:'/assets/tool',type:'file' as const,sha256:hash},{path:'/assets/policy.xml',type:'file' as const,sha256:hash},{path:'/assets/display.icc',type:'file' as const,sha256:hash}],
    records:{codecs:query,coders:query,delegates:query,fonts:query,policy:query,configure:query},
    maxFiles:10,maxRecordBytes:4096,
  };
}
it('refuses missing or drifted executable pins instead of producing a trusted build',()=>{
  const value=input();value.expectedExecutableDigests.tool='b'.repeat(64);
  expect(()=>createMediaBuildReceipt(value)).toThrow('Executable digest mismatch');
  expect(()=>createMediaBuildReceipt({...input(),files:[]})).toThrow('Executable digest mismatch');
});
it('refuses inventory observations produced by an executable outside the pinned tool set',()=>{
  const value=input();
  value.records.codecs={...query,query:{executable:'/host/unpinned-ffmpeg',args:['-codecs']}};
  expect(()=>createMediaBuildReceipt(value)).toThrow('Inventory query executable is not pinned');
});
it('binds the complete inventory and policy/config/assets to deterministic digests and reports frontend mismatch',()=>{
  const value=input();const receipt=createMediaBuildReceipt(value);
  expect(receipt.build.executables).toEqual({tool:hash});
  expect(receipt.build.inventory.coders).toEqual(['PNG','JPEG']);
  expect(receipt.build.inventory.profiles).toEqual(['/assets/display.icc']);
  expect(receipt.build.policyDifferences).toContain('JS frontend/native contract mismatch; this inventory cannot qualify the shipped frontend.');
  expect(receipt.qualification).toEqual([]);
  expect(createMediaBuildReceipt({...value,files:[...value.files].reverse()})).toEqual(receipt);
  const changed=createMediaBuildReceipt({...value,files:value.files.map(file=>file.path.endsWith('.xml')?{...file,sha256:'b'.repeat(64)}:file)});
  expect(changed.build.policyDigest).not.toBe(receipt.build.policyDigest);
  expect(changed.build.configDigest).not.toBe(receipt.build.configDigest);
  expect(changed.build.assetsDigest).not.toBe(receipt.build.assetsDigest);
  expect(changed.build.digest).not.toBe(receipt.build.digest);
});
it('includes mixed-case ICC and ICM assets in the pinned profile inventory without changing their paths',()=>{
 const value=input();
 const paths=['/assets/Display.ICC','/assets/proof.IcM','/assets/lower.icm'];
 value.files.push(...paths.map(path=>({path,type:'file' as const,sha256:hash})));
 const receipt=createMediaBuildReceipt(value);
 expect(receipt.build.inventory.profiles).toEqual(['/assets/Display.ICC','/assets/display.icc','/assets/lower.icm','/assets/proof.IcM']);
 const changed=createMediaBuildReceipt({...value,files:value.files.map(file=>file.path===paths[0]?{...file,sha256:'b'.repeat(64)}:file)});
 expect(changed.build.assetsDigest).not.toBe(receipt.build.assetsDigest);
 expect(changed.build.digest).not.toBe(receipt.build.digest);
});
it('records failed inventory queries explicitly rather than advertising successful native coverage',()=>{
  const value=input();value.records.delegates={...query,outcome:{kind:'exited',exitCode:1},stderr:'missing delegate'};
  const receipt=createMediaBuildReceipt(value);
  expect(receipt.build.policyDifferences).toContain('Native inventory query failed: delegates');
  expect(receipt.build.inventoryDigest).not.toBe(createMediaBuildReceipt(input()).build.inventoryDigest);
});
it('binds native configure observations to config identity even when packaged files are unchanged',()=>{
  const value=input();const original=createMediaBuildReceipt(value);
  value.records.configure={...query,stdout:'CONFIGURE_PATH /different/native/config\n'};
  const changed=createMediaBuildReceipt(value);
  expect(changed.build.configDigest).not.toBe(original.build.configDigest);
  expect(changed.build.assetsDigest).toBe(original.build.assetsDigest);
});
it('bounds records and rejects ambiguous duplicate asset paths before allocating the receipt',()=>{
  expect(()=>createMediaBuildReceipt({...input(),maxFiles:1})).toThrow('bound');
  expect(()=>createMediaBuildReceipt({...input(),maxRecordBytes:1})).toThrow('bound');
  const value=input();expect(()=>createMediaBuildReceipt({...value,files:[...value.files,value.files[0]]})).toThrow('Duplicate');
});
it('rejects ambiguous asset types, lossy Unicode and noncanonical inventory paths',()=>{
 const invalid=[
  {path:'/assets/unknown',type:'directory'},
  {path:'/assets/tool',type:'file',sha256:hash,target:'other'},
  {path:'/assets/link',type:'symlink',target:'tool',sha256:hash},
  {path:'/assets/link',type:'symlink',target:'bad\0target'},
  {path:'/assets/link',type:'symlink',target:'\ud800'},
  {path:'/assets/\ud800',type:'file',sha256:hash},
  {path:'/assets/../tool',type:'file',sha256:hash},
  {path:'/assets//tool',type:'file',sha256:hash},
 ];
 for(const file of invalid)expect(()=>createMediaBuildReceipt({...input(),files:[input().files[0],file] as never})).toThrow('asset');
});
it('bounds asset record bytes before retaining the file inventory',()=>{
 const value=input();
 expect(()=>createMediaBuildReceipt({...value,files:[...value.files,{path:'/assets/'+ 'x'.repeat(4096),type:'file',sha256:hash}]})).toThrow('byte bound');
});
it('rejects malformed native query observations rather than minting a build identity',()=>{
 for(const record of [
  {...query,outcome:{kind:'exited',exitCode:256}},
  {...query,query:{executable:'tool',args:[]}},
  {...query,query:{executable:'/assets/tool',args:['bad\0arg']}},
  {...query,stdout:'\ud800'},
 ])expect(()=>createMediaBuildReceipt({...input(),records:{...input().records,codecs:record} as never})).toThrow();
});
it('rejects extra inventory queries and oversized argv before inspecting their contents',()=>{
 const value=input();
 expect(()=>createMediaBuildReceipt({...value,records:{...value.records,unexpected:query} as never})).toThrow('Inventory query set');
 const args=new Array(value.maxRecordBytes+1).fill('');
 Object.defineProperty(args,0,{get(){throw new Error('argv contents accessed before admission');}});
 expect(()=>createMediaBuildReceipt({...value,records:{...value.records,codecs:{...query,query:{...query.query,args}}}})).toThrow('Inventory query argv bound');
});
