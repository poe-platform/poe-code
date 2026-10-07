import {withPythonSourceOrigins} from './source-origin.js';
import {compareIdentity} from '@poe-code/safe-fs/core';
import {FsError,toByteSource,type CommandContext,type FileStat} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import {createPythonPackageEnvironment,type PythonPackageOptions,type PythonPackagePrepareContext} from './provisioning.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {createPythonBuildBackend,type PythonSourceRequirement} from './build-backend.js';
import {createPythonBuildDependencies} from './build-dependencies.js';
import {pythonPackageUrlHash} from './package-url-hash.js';
import {downloadPythonSourceArchive,snapshotPythonSourceArchive} from './source-download.js';
import {createPythonSourceSnapshot} from './source-snapshot.js';
import type {extractPythonSourceZip,PythonSourceArchiveMetadata} from './source-zip.js';
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
const archiveSuffix=(path:string)=>['.zip','.tar','.tar.gz','.tgz','.tar.bz2','.tbz','.tar.xz','.txz'].find(suffix=>path.toLowerCase().endsWith(suffix));
const wheelLink=(url:URL)=>{
 let path=url.pathname;while(path.endsWith('/'))path=path.slice(0,-1);
 const parts=(path.slice(path.lastIndexOf('/')+1)||url.host).split('%');
 let name=parts.shift()!;
 for(const part of parts){
  const hex=part.slice(0,2).toLowerCase();
  name+=hex.length===2&&[...hex].every(value=>'0123456789abcdef'.includes(value))?String.fromCharCode(Number.parseInt(hex,16))+part.slice(2):'%'+part;
 }
 name=name.slice(name.lastIndexOf('/')+1);
 return name.endsWith('.whl')&&name.slice(0,-4).split('.').some(Boolean);
};

/** Package environment that builds local PEP 517 and legacy setup projects before normal installation. */
export function createPythonSourcePackageEnvironment(options:PythonPackageOptions,build:PythonSourceBuildOptions){
 if(options.prepareRequirements||!build.python.createExecutor||!build.directory)throw new TypeError('Source packages require an asynchronous build executor and caller storage');
 const prepareRequirement=async(requirement:string,context:PythonPackagePrepareContext,editable=false):Promise<string>=>{
  const {fs,signal}=context,settings={signal},requirementLine=requirement.startsWith('-');
  editable||=requirementLine;
  let source=requirement,named:PythonSourceRequirement|null=null;
  let remote:URL|undefined;
  const at=requirement.indexOf('@');
  let namedSource=false;
  if(at>=0&&!requirement.startsWith('file:')){
   const tail=requirement.slice(at+1).trimStart();let end=0;
   while(end<tail.length&&![' ','\t','\r','\n'].includes(tail[end]!))end++;
   try{const url=new URL(tail.slice(0,end));namedSource=url.protocol==='file:'||['http:','https:'].includes(url.protocol)&&!wheelLink(url);}
   catch{/* Native requirement validation retains invalid-input diagnostics. */}
  }
  const editableExtras=editable&&requirement.endsWith(']')&&requirement.lastIndexOf('[')>0;
  if(namedSource||editableExtras||requirementLine){
   if(!context.stdout||!context.stderr||!context.env)throw new TypeError('Source requirement parsing requires command output and environment context');
   const environment=createPythonBuildEnvironment(options);
   const parsing={...context,env:context.env,stdout:context.stdout,stderr:context.stderr,maxBytes:options.maxMetadataBytes??Infinity};
   Reflect.deleteProperty(parsing,'editable');
   try{named=await createPythonBuildBackend({...build.python,environment})({hook:editableExtras||requirementLine?'read_editable_requirement':'read_source_requirement',source:requirement,...requirementLine?{requirementLine}: {}},parsing);}
   finally{await environment.dispose();}
   if(named){if(!named.active)return requirement;source=named.url;}
  }
  const originalLink=source.slice(0,5).toLowerCase()==='file:'||source.startsWith('https://')||source.startsWith('http://')?source:undefined;
  let subdirectory:string|undefined;
  if(source.startsWith('file:')||source.startsWith('https://')||source.startsWith('http://')){
   for(let index=0;index<source.length;index++)if((source[index]==='#'||source[index]==='&')&&source.startsWith('subdirectory=',index+1)){
    const start=index+1+'subdirectory='.length,end=source.indexOf('&',start);
    subdirectory=source.slice(start,end<0?undefined:end);break;
   }
  }
  if(source.slice(0,5).toLowerCase()==='file:'){
   const url=new URL(source);
   if(url.host&&url.host!=='localhost'){if(editable)throw new Error('Editable source requires a local directory');return requirement;}
   source=decodeURIComponent(url.pathname);
  }else if(source.startsWith('https://')||source.startsWith('http://'))remote=new URL(source);
  else if(source.includes('://')){if(editable)throw new Error('Editable source requires a local directory');return requirement;}
  if(editable&&remote)throw new Error('Editable source requires a local directory');
  const suffix=archiveSuffix(remote?.pathname??source);
  let archived=!!remote&&!wheelLink(remote);
  if(remote){if(!archived)return requirement;}
  else{
   source=resolvePath(context.cwd,source);
   try{const stat=await fs.stat(source,settings);archived=stat.type==='file'&&!!suffix;if(editable&&stat.type!=='directory')throw new Error('Editable source requires a local directory');if(stat.type!=='directory'&&!archived)return requirement;}
   catch(error){if(error instanceof FsError&&error.code==='ENOENT'){if(editable)throw new Error('Editable source requires an existing local directory');return requirement;}throw error;}
  }
  const originSource=originalLink??source;
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
   Reflect.deleteProperty(command,'editable');
   const configuration={...build.python,environment},hook=createPythonBuildBackend(configuration),hookContext={...command,maxBytes:options.maxMetadataBytes??Infinity};
   let prepared:string;
   if(archived){
    prepared=resolvePath(path,'source');await confined.mkdir(prepared,settings);
    if(!build.extractArchive)throw new Error('Source archives require an extraction capability');
    let metadata:PythonSourceArchiveMetadata|undefined;
    if(remote){
     source=resolvePath(path,'archive');
     const response=await downloadPythonSourceArchive(remote,source,options,command);
     const filename=await hook({hook:'read_download_filename',source:remote.href,responseUrl:response.url,headers:response.headers},hookContext);
     const headers=new Map(response.headers.map(([key,value])=>[key.toLowerCase(),value]));
     metadata={filename,...headers.has('content-type')?{contentType:headers.get('content-type')!}:{}};
    }
    if(!remote&&originalLink&&pythonPackageUrlHash(originalLink)){
     const snapshot=resolvePath(path,'archive'+suffix);
     await snapshotPythonSourceArchive(source,snapshot,originalLink,options.maxDownloadBytes??Infinity,{...command,fs:staging});
     source=snapshot;
    }
    await build.extractArchive(source,prepared,options.maxDownloadBytes??Infinity,{...command,fs:staging},metadata);
   }
   else prepared=editable?await fs.realpath(source,settings):(await createPythonSourceSnapshot(source,path,{...command,fs:staging})).path;
   if(subdirectory){
    const selected=resolvePath(prepared,subdirectory);
    if(selected!==prepared&&!selected.startsWith(prepared+'/'))throw new Error('Source subdirectory escapes the build tree');
    const root=await fs.realpath(prepared,settings),actual=await fs.realpath(selected,settings);
    if(actual!==root&&!actual.startsWith(root+'/'))throw new Error('Source subdirectory escapes the build tree');
    prepared=actual;
   }
   const wheelDirectory=resolvePath(path,'wheels');
   await confined.mkdir(wheelDirectory,settings);
   const buildSystem=await hook({hook:'read_build_system',source:prepared,name:requirement,installation:archived?'archive':'directory'},hookContext);
   await createPythonBuildDependencies(configuration)({source:prepared,buildSystem},hookContext);
   const filename=await hook(editable?{hook:'build_legacy_wheel',source:prepared,wheelDirectory,editable:true}:buildSystem?{hook:'build_wheel',source:prepared,backend:buildSystem.backend,backendPath:buildSystem.backendPath,wheelDirectory}:{hook:'build_legacy_wheel',source:prepared,wheelDirectory},hookContext);
   const published=await publishPythonBuildWheel(resolvePath(wheelDirectory,filename),root,options.maxDownloadBytes??Infinity,context);
   const origin=buildSystem&&!editable?await hook({hook:'read_source_origin',source:originSource,directory:!archived},hookContext):undefined;
   const url=published.url+(origin===undefined?'':'#python-source='+encodeURIComponent(origin));
   await cleanup();return named?(named.name||filename.slice(0,filename.indexOf('-')))+(named.extras.length?'['+named.extras.join(',')+']':'')+' @ '+url+(named.marker?' ; '+named.marker:''):url;
  }catch(error){
   try{await cleanup();}catch(retirement){if(retirement===error)throw error;throw new AggregateError([error,retirement],'Python source build cleanup failed');}
   throw error;
  }
 };
 return withPythonSourceOrigins(createPythonPackageEnvironment({...options,async prepareRequirements(requirements,context){
  const resolved:string[]=[];
  for(const requirement of new Set([...options.editable??[],...context.editable??[]]))resolved.push(await prepareRequirement(requirement,context,true));
  for(const requirement of new Set(requirements))resolved.push(await prepareRequirement(requirement,context));
  return resolved;
 }}),build.directory,options.maxMetadataBytes??Infinity);
}
