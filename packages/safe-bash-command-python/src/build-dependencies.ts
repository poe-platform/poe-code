import {toByteSource} from 'safe-bash-contracts';
import {createPythonExecutorCommands,type PythonCommandsOptions,type PythonPackageEnvironment} from './executor.js';
import {createPythonBuildBackend,type PythonBuildHookContext,type PythonBuildSystemDetails} from './build-backend.js';

export interface PythonBuildDependenciesRequest {
 readonly source:string;
 readonly name?:string;
 /** null selects native legacy setuptools requirement discovery. */
 readonly buildSystem:PythonBuildSystemDetails|null;
 readonly configSettings?:Readonly<Record<string,string|readonly string[]>>;
}

/** Install declared then missing backend requirements in an explicit build environment. */
export function createPythonBuildDependencies(options:Omit<PythonCommandsOptions,'packages'|'requirements'|'packageProfile'|'provisioning'> & {readonly environment:PythonPackageEnvironment}) {
 const isolated:PythonCommandsOptions & {environment:PythonPackageEnvironment}={...options};
 for(const key of ['packages','requirements','packageProfile','provisioning'])Reflect.deleteProperty(isolated,key);
 const hook=createPythonBuildBackend(isolated),command=createPythonExecutorCommands(isolated)[0]!;
 return async(input:PythonBuildDependenciesRequest,caller:PythonBuildHookContext):Promise<void>=>{
  const context={...caller};
  context.signal.throwIfAborted();
  const request=structuredClone(input),{source,buildSystem,configSettings}=request;
  if(typeof source!=='string'||!source||request.name!==undefined&&typeof request.name!=='string'||buildSystem!==null&&(!buildSystem||typeof buildSystem.backend!=='string'||!buildSystem.backend||[buildSystem.requires,buildSystem.check,buildSystem.backendPath].some(values=>!Array.isArray(values)||values.some(value=>typeof value!=='string'))))throw new TypeError('Invalid Python build dependency request');
  if(configSettings!==undefined&&(!configSettings||typeof configSettings!=='object'||Array.isArray(configSettings)||Object.values(configSettings).some(value=>typeof value!=='string'&&(!Array.isArray(value)||value.some(item=>typeof item!=='string')))))throw new TypeError('Invalid Python build configuration');
  if(context.maxBytes!==Infinity&&(!Number.isSafeInteger(context.maxBytes)||context.maxBytes<0))throw new RangeError('Invalid Python build metadata limit');
  const install=async(requirements:readonly string[])=>{
   if(!requirements.length)return;
   const result=await command.execute({...context,command:'python',args:['-m','pip','install','--',...requirements],stdin:toByteSource('')});
   context.signal.throwIfAborted();
   if(result.exitCode)throw new Error('Python build dependency installation exited with status '+result.exitCode);
  };
  const check=async(requirements:readonly string[],against:string)=>{
   if(!requirements.length)return [];
   const receipt=await isolated.environment.prepare(context);
   let installed:readonly string[];
   try{
    if(!receipt.records&&receipt.restore?.length)throw new Error('Python build dependency checks require an installed metadata manifest');
    installed=receipt.records?.map(record=>record[0])??[];
   }finally{await isolated.environment.finish(receipt);}
   const status=await hook({hook:'check_build_requirements',source,requirements,installed},context);
   if(status.conflicting.length)throw Object.assign(new Error('Some build dependencies for '+(request.name??source)+' conflict with '+against+': '+[...status.conflicting].sort(([a,b],[c,d])=>a<c?-1:a>c?1:b<d?-1:b>d?1:0).map(([installed,wanted])=>installed+' is incompatible with '+wanted).join(', ')+'.'),{name:'InstallationError'});
   return status.missing;
  };
  if(buildSystem){
  await install(buildSystem.requires);
  const missing=await check(buildSystem.check,'PEP 517/518 supported requirements');
  if(missing.length)await context.stderr.write(new TextEncoder().encode('Missing build requirements in pyproject.toml for '+(request.name??source)+'.\nThe project does not specify a build backend, and pip cannot fall back to setuptools without '+missing.map(value=>"'"+value+"'").join(' and ')+'.\n'));
  }
  const requirements=await hook(buildSystem?{hook:'get_requires_for_build_wheel',source,backend:buildSystem.backend,backendPath:buildSystem.backendPath,...configSettings===undefined?{}:{configSettings}}:{hook:'get_requires_for_legacy_wheel',source},context);
  await install(await check(requirements,'the backend dependencies'));
 };
}
