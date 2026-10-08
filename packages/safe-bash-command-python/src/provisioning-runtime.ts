import { PythonFailure } from './diagnostics.js';
import {loadPythonPackageProgram} from './package-program.js';
import { loadPythonNativeWheel } from './native-wheel.js';
import {pythonPackageUrlHash} from './package-url-hash.js';
import type { PythonWorkerRuntime } from './worker.js';
import type {PythonPackageRecord} from './manifest.js';
import type { PythonPackageStart } from './provisioning.js';

interface NativePackage { normalizedName:string;channel:string;packageData?:NativePackageData }
interface NativePackageData {file_name:string;sha256:string;install_dir?:string}
interface PackageSource {url:string;expected?:string}
interface WheelReceipt {token:string;key:string;size:number}

interface InstallerRuntime extends PythonWorkerRuntime {
 readonly _api: {
  readonly lockfile_packages: Record<string,NativePackageData>;
  loadDynlib(path:string):Promise<unknown>;
  importlib?:{invalidate_caches():unknown};
  readonly packageManager: {
   readonly defaultChannel:string;
   downloadPackage(metadata:NativePackage):Promise<PackageSource>;
   installPackage(metadata:NativePackage,source:PackageSource|Uint8Array):Promise<unknown>;
  };
 };
 loadPackage(names:string[], options:{messageCallback:(message:string)=>void;errorCallback:(message:string)=>void}):Promise<unknown>;
 runPythonAsync(source:string):Promise<unknown>;
}

/** Pinned installer ABI; all package transport is serviced by the host, before user execution. */
export async function installPythonPackages(
 supplied: PythonWorkerRuntime,
 start: PythonPackageStart,
 request:(operation:string,...args:any[])=>any,
 maxTransferBytes:number,
 installationRoot?:string,
):Promise<void> {
 if(!start.requirements.length&&!start.uninstall&&!start.bootstrap)return;
 const runtime=supplied as InstallerRuntime;
 if(runtime.version!=='314.0.6'||!runtime._api?.packageManager||!runtime._api.lockfile_packages||typeof runtime._api.packageManager.installPackage!=='function'||typeof runtime.loadPackage!=='function'||typeof runtime.runPythonAsync!=='function')throw new PythonFailure('runtime-abi', {cause:new Error('Python package installer ABI requires Pyodide 314.0.6')});
 let transportFailure:{error:unknown}|undefined;
 let accepting=true;
 let pending=Promise.resolve();
 let installing:Promise<unknown>=Promise.resolve();
 const manager=runtime._api.packageManager;

 // A host session owns one open artifact. Serialize entire transfers, including
 // closure, even when micropip or the native loader requests dependencies together.
 const transfer=<T>(consume:()=>Promise<T>):Promise<T>=>{
  if(!accepting)return Promise.reject(new Error('Python package transport is only available during installation'));
  const work=pending.then(async()=>{
   if(transportFailure)throw transportFailure.error;
   try{return await consume();}catch(error){transportFailure??={error};throw error;}
  });
  pending=work.then(()=>{},()=>{});
  return work;
 };
 const readArtifact=(operation:string,key:string,offset:number,length:number)=>{
  const failed=(error:unknown):never=>{transportFailure??={error};throw error;};
  try {
   const result=request(operation,start.session,key,offset,Math.min(length,maxTransferBytes,65536));
   // Keep the worker callback synchronous; JSPI awaits the asynchronous host.
   return result instanceof Promise?result.catch(failed):result;
  }catch(error){return failed(error);}
 };
 const withArtifact=<T>(url:string,expected:string|undefined,metadata:'metadata'|undefined,consume:(opened:{key:string;size:number;headers:readonly(readonly[string,string])[]},read:(offset:number,length:number)=>any)=>Promise<T>):Promise<T>=>transfer(async()=>{
  const opened=await request('package-open',start.session,url,expected,...metadata?[metadata]:[]) as {key:string;size:number;headers:readonly(readonly[string,string])[]};
  try{return await consume(opened,(offset,length)=>readArtifact('package-read',opened.key,offset,length));}
  finally{await request('package-close',start.session,opened.key);}
 });
 const wheel=async(size:number,read:(offset:number,length:number)=>any,configuration:Record<string,unknown>)=>{
  const globals=['_safe_native_wheel_read','_safe_native_wheel_config','_safe_extract_native_wheel','_safe_native_wheel_index','_safe_native_wheel_dynlib'];
  let indexed=false;
  try {
   runtime.globals.set(globals[0]!,read);
   runtime.globals.set(globals[4]!,async(path:string)=>{
    // Never unwind a rejected native JS call through a suspended Python frame.
    try{await runtime._api.loadDynlib(path);return '';}
    catch(error){return String(error);}
   });
   runtime.globals.set(globals[3]!, (operation:string,...args:unknown[])=>{
    if(operation==='start')indexed=true;
    const failed=(error:unknown):never=>{transportFailure??={error};throw error;};
    try{
     const result=request('package-index',start.session,operation,...args);
     return result instanceof Promise?result.catch(failed):result;
    }catch(error){return failed(error);}
   });
   runtime.globals.set(globals[1]!,JSON.stringify({...configuration,size}));
   const result=JSON.parse(await runtime.runPythonAsync(await loadPythonNativeWheel()) as string) as string|string[]|{dynlibError:string};
   if(result && typeof result==='object' && 'dynlibError' in result)throw new Error(result.dynlibError);
   return result;
  }finally{
   try{if(indexed)await request('package-index',start.session,'close');}
   finally{for(const name of globals)runtime.globals.delete(name);}
  }
 };
 const fetch=(url:string,expected?:string,metadata?:'metadata')=>withArtifact(url,expected,metadata,async(opened,read)=>{
  const bytes=new Uint8Array(opened.size);
  for(let offset=0;offset<bytes.length;){
   const chunk=await read(offset,bytes.length-offset) as number[];
   if(!Array.isArray(chunk)||chunk.length===0||offset+chunk.length>bytes.length)throw new Error('Invalid Python package chunk');
   bytes.set(chunk,offset);offset+=chunk.length;
  }
  return {bytes,headers:opened.headers};
 });
 // Native dependency ordering retains source descriptors, not complete wheel buffers.
 // The pinned installer still owns extraction and dynamic linking. Serialize the
 // entire fetch/install lifetime so dependency downloads cannot accumulate payloads.
 manager.downloadPackage=async metadata=>{
  if(!accepting)throw new Error('Python package transport is only available during installation');
  if(metadata.channel===manager.defaultChannel){
   const pkg=runtime._api.lockfile_packages[metadata.normalizedName];
   if(!pkg)throw new Error(`Missing matching Pyodide package: ${metadata.normalizedName}`);
   return {url:new URL(pkg.file_name,'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/').href,expected:pkg.sha256};
  }
  return {url:metadata.channel};
 };
 manager.installPackage=(metadata,source)=>{
  if(!accepting)return Promise.reject(new Error('Python package transport is only available during installation'));
  const work=installing.then(async()=>{
   if(source instanceof Uint8Array)throw new Error('Expected retained Python package source');
   const pkg=runtime._api.lockfile_packages[metadata.normalizedName]??metadata.packageData;
   if(!pkg)throw new Error(`Missing matching Pyodide package: ${metadata.normalizedName}`);
   return withArtifact(source.url,source.expected,undefined,(opened,read)=>wheel(opened.size,read,{filename:pkg.file_name,target:pkg.install_dir??null,
    metadata:{INSTALLER:'pyodide.loadPackage',PYODIDE_SOURCE:metadata.channel===manager.defaultChannel?'pyodide':metadata.channel}}));
  });
  installing=work.then(()=>{},()=>{});
  return work;
 };
 const loadPackages=async(names:string[])=>{
  const errors:string[]=[];
  const importlib=runtime._api.importlib;
  let invalidate=false;
  if(installationRoot&&importlib)runtime._api.importlib={invalidate_caches(){invalidate=true;}};
  try{await runtime.loadPackage(names,{messageCallback(){},errorCallback(message){errors.push(message);}});}
  finally{if(installationRoot&&importlib)runtime._api.importlib=importlib;}
  if(invalidate)await runtime.runPythonAsync('import importlib; importlib.invalidate_caches()');
  if(errors.length)throw new Error(errors.join('\n'));
 };
 const installedGlobals:string[]=[];
 const bind=(name:string,value:unknown)=>{runtime.globals.set(name,value);installedGlobals.push(name);};
 try {
  if(installationRoot){
   bind('_safe_installation_root',installationRoot);
   await runtime.runPythonAsync(`
import sys, site, sysconfig
from pathlib import Path
from pyodide import _package_loader
sys.prefix = sys.exec_prefix = _safe_installation_root
site.PREFIXES = [sys.prefix, sys.exec_prefix]
sysconfig._CONFIG_VARS = None
_package_loader.SITE_PACKAGES = Path(site.getsitepackages()[0])
_package_loader.DSO_DIR = _package_loader.SITE_PACKAGES.parents[1]
_package_loader.TARGETS.update(site=_package_loader.SITE_PACKAGES, dynlib=_package_loader.DSO_DIR)
_package_loader.SITE_PACKAGES.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(_package_loader.SITE_PACKAGES))
`);
  }
  await loadPackages(['micropip',...start.bootstrapPackages??[]]);
  bind('_safe_package_native',loadPackages);
  bind('_safe_package_preloaded',(operation:string,name?:string)=>transfer(async()=>request('package-index',start.session,'names-'+operation,...name===undefined?[]:[name])));
  bind('_safe_package_bytes',async(url:string,hash?:string)=>(await fetch(url,hash)).bytes);
  bind('_safe_package_metadata',async(url:string)=>{
   const result=await fetch(url,undefined,'metadata');return JSON.stringify({text:new TextDecoder().decode(result.bytes),headers:Object.fromEntries(result.headers.map(([name,value])=>[name.toLowerCase(),value]))});
  });
  bind('_safe_package_wheel_download',async(url:string,expected:string|undefined)=>withArtifact(url,expected,undefined,async(opened,read)=>{
   const hash=pythonPackageUrlHash(url);
   if(hash)await wheel(opened.size,read,{integrity:hash});
   return JSON.stringify(await request('package-retain',start.session,opened.key));
  }));
  bind('_safe_package_wheel_metadata',async(serialized:string)=>transfer(async()=>{
   const {source,name}=JSON.parse(serialized) as {source:WheelReceipt;name:string};
   return wheel(source.size,(offset,length)=>readArtifact('package-read-retained',source.token,offset,length),{metadata_name:name});
  }));
  bind('_safe_package_wheel_install',async(serialized:string)=>transfer(async()=>{
   const {source,...configuration}=JSON.parse(serialized) as {source:WheelReceipt;filename:string;extract_dir:string;metadata:Record<string,string>};
   await wheel(source.size,(offset,length)=>readArtifact('package-read-retained',source.token,offset,length),configuration);
  }));
  bind('_safe_package_indexes_json',JSON.stringify(start.indexUrls??null));
  bind('_safe_package_constraints_json',JSON.stringify(start.constraints??[]));
  bind('_safe_package_requirements_json',JSON.stringify(start.requested ?? start.requirements));
  for(const key of ['pre','upgrade','forceReinstall','legacy','noDeps'] as const){
   bind('_safe_package_'+key,!!start[key]);
  }
  bind('_safe_package_restore_json',JSON.stringify(start.restore ?? []));
  const inputRecords=start.recordCount===undefined?start.records?.map((row):PythonPackageRecord=>[row[0],row[1],row[2],[...row[3]],[...row[4]],row[5]??null]):undefined;
  const recordCount=start.recordCount??inputRecords?.length??-1;
  const outputRecords:unknown[]=[],pinned:string[]=[];
  bind('_safe_package_record',(operation:string,key?:unknown,value?:unknown)=>transfer(async()=>{
   if(operation==='pin'){
    if(typeof key!=='string')throw new Error('Invalid Python package pin');
    const pin=JSON.parse(key);
    if(typeof pin!=='string')throw new Error('Invalid Python package pin');
    pinned.push(pin);return null;
   }
   if(operation==='start'){await request('package-index',start.session,'records-start');return recordCount;}
   if(operation==='append'){
    if(typeof key!=='string')throw new Error('Invalid Python package record');
    if(start.restore!==undefined)outputRecords.push(JSON.parse(key));
    return null;
   }
   if(operation==='read'||operation==='get'){
    const offset=value??0;
    if(!Number.isSafeInteger(offset)||(offset as number)<0)throw new Error('Invalid Python package record offset');
    const ordinal=operation==='get'?await request('package-index',start.session,'records-get',key):key;
    if(ordinal===null)return (offset as number)===0?'null':'';
    if(!Number.isSafeInteger(ordinal)||(ordinal as number)<0||(ordinal as number)>=recordCount)throw new Error('Invalid Python package record ordinal');
    const chunk=start.recordCount===undefined?JSON.stringify(inputRecords![ordinal as number]).slice(offset as number,(offset as number)+8192):await request('package-record-read',start.session,ordinal,offset);
    if(typeof chunk!=='string'||chunk.length>8192)throw new Error('Invalid Python package record chunk');
    // The native string bridge must never receive half a UTF-16 pair.
    const last=chunk.charCodeAt(chunk.length-1);
    return last>=0xd800&&last<=0xdbff?chunk.slice(0,-1):chunk;
   }
   return request('package-index',start.session,'records-'+operation,...key===undefined?[]:[key],...value===undefined?[]:[value]);
  }));
  bind('_safe_package_uninstall_json',JSON.stringify(start.uninstall ?? null));
  bind('_safe_package_emit',async(stream:string,message:string)=>{
   if(stream!=='stdout'&&stream!=='stderr')throw new Error('Invalid package output stream');
   const bytes=new TextEncoder().encode(message);
   for(let offset=0;offset<bytes.length;offset+=maxTransferBytes)await request(stream,Array.from(bytes.subarray(offset,offset+maxTransferBytes)));
  });
  bind('_safe_package_line',async()=>{
   const bytes:number[]=[];
   while(true){
    const chunk=await request('stdin',1) as number[];
    if(!chunk.length){if(!bytes.length)throw new Error('EOF when reading package confirmation');break;}
    if(chunk[0]===10)break;
    bytes.push(chunk[0]!);
   }
   return new TextDecoder().decode(Uint8Array.from(bytes));
  });
  // The pinned installer owns candidate selection, dependency traversal and wheel
  // extraction. Its scoped transaction adapter changes only installed satisfaction:
  // upgrade targets roots; force-reinstall targets the selected dependency graph.
  // Preloaded/transaction-locked versions stay protected, and the original class
  // is restored before guest execution, including when resolution fails.
  // Validate exact restoration before replacement and requested pins afterward.
  // Preserve wheel origins, extra contexts and unrelated installed distributions;
  // publish the resulting inventory only after successful resolution/removal.
  // Native metadata discovery holds bootstrap ZIPs; invalidate and collect them
  // before relocation and canonical filesystem syscall admission.
  // Format guest failures while a suspendable Python frame still owns traceback I/O.
  const program=await loadPythonPackageProgram();
  const installerFailure=await runtime.runPythonAsync(`
import sys as _safe_install_sys
from micropip.logging import setup_logging as _safe_install_logging
_safe_install_handlers = [handler for handler in _safe_install_logging().logger.handlers if getattr(handler, 'stream', None) is _safe_install_sys.stdout]
_safe_installer_failure = None
try:
 for handler in _safe_install_handlers: handler.setStream(_safe_install_sys.stderr)
${program.split('\n').map(line=>' '+line).join('\n')}
except BaseException:
 import traceback
 _safe_installer_failure = traceback.format_exc()
finally:
 for handler in _safe_install_handlers: handler.setStream(_safe_install_sys.stdout)
_safe_installer_failure
`);
  if(typeof installerFailure==='string'&&installerFailure)throw new Error(installerFailure);
  await installing;
  accepting=false;
  await pending;
  if(transportFailure)throw transportFailure.error;
  await request('package-commit',start.session,start.restore === undefined ? pinned : {version:3,installed:pinned,records:outputRecords});
  if(start.uninstall)await runtime.runPythonAsync('await _safe_publish_uninstalled()');
 }catch(error){
  await installing;
  accepting=false;
  await pending;
  throw transportFailure ? transportFailure.error : error;
 }finally{
  await installing;
  accepting=false;
  await pending;
  manager.downloadPackage=manager.installPackage=async()=>{throw new Error('Python package transport is only available during installation');};
  // These bridge callbacks are not an application Python networking capability.
  for(const name of installedGlobals)runtime.globals.delete(name);
 }
}
