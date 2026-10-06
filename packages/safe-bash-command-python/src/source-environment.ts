import {compareIdentity} from '@poe-code/safe-fs/core';
import {FsError,toByteSource,type CommandContext,type FileStat} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import {createPythonPackageEnvironment,type PythonPackageOptions,type PythonPackagePrepareContext} from './provisioning.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {createPythonBuildBackend,type PythonSourceRequirement} from './build-backend.js';
import {createPythonBuildDependencies} from './build-dependencies.js';
import {createPythonSourceSnapshot} from './source-snapshot.js';
import type {extractPythonSourceZip} from './source-zip.js';
import {publishPythonBuildWheel} from './build-wheel.js';
import type {PythonCommandsOptions} from './executor.js';

export interface PythonSourceBuildOptions {
 /** Existing caller-owned directory for build staging and durable wheels. */
 readonly directory:string;
 /** Optional caller-selected archive implementation; omitted hosts support source directories. */
 readonly extractArchive?:typeof extractPythonSourceZip;
 readonly python:Omit<PythonCommandsOptions,'packages'|'requirements'|'packageProfile'|'provisioning'|'environment'>;
}
let serial=0;

/** Package environment that builds local PEP 517 and legacy setup projects before normal installation. */
export function createPythonSourcePackageEnvironment(options:PythonPackageOptions,build:PythonSourceBuildOptions){
 if(options.prepareRequirements||!build.python.createExecutor||!build.directory)throw new TypeError('Source packages require an asynchronous build executor and caller storage');
 const prepareRequirement=async(requirement:string,context:PythonPackagePrepareContext):Promise<string>=>{
  const {fs,signal}=context,settings={signal};
  let source=requirement,named:PythonSourceRequirement|null=null;
  const at=requirement.indexOf('@');
  if(at>=0&&!requirement.startsWith('file:')&&requirement.slice(at+1).trimStart().startsWith('file:')){
   if(!context.stdout||!context.stderr||!context.env)throw new TypeError('Source requirement parsing requires command output and environment context');
   const environment=createPythonBuildEnvironment(options);
   try{named=await createPythonBuildBackend({...build.python,environment})({hook:'read_source_requirement',source:requirement},{...context,env:context.env,stdout:context.stdout,stderr:context.stderr,maxBytes:options.maxMetadataBytes??Infinity});}
   finally{await environment.dispose();}
   if(named){if(!named.active)return requirement;source=named.url;}
  }
  if(source.startsWith('file:')){
   const url=new URL(source);
   if(url.host&&url.host!=='localhost')return requirement;
   source=decodeURIComponent(url.pathname);
  }else if(source.includes('://'))return requirement;
  source=resolvePath(context.cwd,source);
  let archived=false;
  try{const stat=await fs.stat(source,settings);archived=stat.type==='file'&&['.zip','.tar','.tar.gz','.tgz','.tar.bz2','.tbz','.tar.xz','.txz'].some(suffix=>source.toLowerCase().endsWith(suffix));if(stat.type!=='directory'&&!archived)return requirement;}
  catch(error){if(error instanceof FsError&&error.code==='ENOENT')return requirement;throw error;}
  if(!context.stdout||!context.stderr||!context.env)throw new TypeError('Source package preparation requires command output and environment context');
  if(!fs.prepareDirectory||!fs.removeTreeConditional||!fs.confineExtraction)throw new Error('Source packages require conditional caller storage');
  const root=await fs.realpath(resolvePath(context.cwd,build.directory),settings),parent=await fs.stat(root,settings);
  const caps=await fs.capabilitiesFor?.(root,settings)??fs.capabilities;
  if(!caps.atomicTreeRemoval)throw new Error('Source packages require conditional tree cleanup');
  let path='',owned:FileStat|undefined;
  for(let attempt=0;attempt<16;attempt++){
   path=resolvePath(root,'.python-build-'+ ++serial);
   try{owned=await fs.prepareDirectory(path,{parent,expected:null,mode:0o700,signal});break;}
   catch(error){if(!(error instanceof FsError)||!['EEXIST','EAGAIN'].includes(error.code))throw error;signal.throwIfAborted();}
  }
  if(!owned)throw new Error('Python build directory names exhausted');
  const environment=createPythonBuildEnvironment(options);
  let cleaning:Promise<void>|undefined;
  const remove=async()=>{
   const current=await fs.lstat(path);
   if(compareIdentity(owned,current)!=='same')throw new Error('Python build directory identity changed');
   await fs.removeTreeConditional!(path,{parent,expected:current});
  };
  const cleanup=()=>cleaning??=(async()=>{try{await environment.dispose();}finally{await remove();}})();
  try{
   const confined=await fs.confineExtraction([path],settings);
   if(compareIdentity(owned,await fs.lstat(path,settings))!=='same')throw new Error('Python build directory identity changed');
   const staging=new Proxy(confined,{get(target,key){
    const owner=['stat','lstat','realpath','openReadFile','iterateDirectory','readlink','confineExtraction','removeTreeConditional'].includes(String(key))?fs:target,value=Reflect.get(owner,key);
    return typeof value==='function'?value.bind(owner):value;
   }});
   const command:CommandContext={...context,env:context.env,stdout:context.stdout,stderr:context.stderr,command:'python',args:[],stdin:toByteSource('')};
   let prepared:string;
   if(archived){prepared=resolvePath(path,'source');await confined.mkdir(prepared,settings);if(!build.extractArchive)throw new Error('Source archives require an extraction capability');await build.extractArchive(source,prepared,options.maxDownloadBytes??Infinity,{...command,fs:staging});}
   else prepared=(await createPythonSourceSnapshot(source,path,{...command,fs:staging})).path;
   const wheelDirectory=resolvePath(path,'wheels');
   await confined.mkdir(wheelDirectory,settings);
   const configuration={...build.python,environment},hook=createPythonBuildBackend(configuration),hookContext={...command,maxBytes:options.maxMetadataBytes??Infinity};
   const buildSystem=await hook({hook:'read_build_system',source:prepared},hookContext);
   if(buildSystem)await createPythonBuildDependencies(configuration)({source:prepared,buildSystem},hookContext);
   const filename=await hook(buildSystem?{hook:'build_wheel',source:prepared,backend:buildSystem.backend,backendPath:buildSystem.backendPath,wheelDirectory}:{hook:'build_legacy_wheel',source:prepared,wheelDirectory},hookContext);
   const published=await publishPythonBuildWheel(resolvePath(wheelDirectory,filename),root,options.maxDownloadBytes??Infinity,context);
   await cleanup();return named?named.name+(named.extras.length?'['+named.extras.join(',')+']':'')+' @ '+published.url+(named.marker?' ; '+named.marker:''):published.url;
  }catch(error){
   try{await cleanup();}catch(retirement){if(retirement===error)throw error;throw new AggregateError([error,retirement],'Python source build cleanup failed');}
   throw error;
  }
 };
 return createPythonPackageEnvironment({...options,async prepareRequirements(requirements,context){
  const resolved:string[]=[];
  for(const requirement of new Set(requirements))resolved.push(await prepareRequirement(requirement,context));
  return resolved;
 }});
}
