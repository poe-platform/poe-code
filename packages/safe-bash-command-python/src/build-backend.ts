import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands, type PythonCommandsOptions, type PythonPackageEnvironment} from './executor.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';

export type PythonBuildHookRequest = {
 readonly source:string;
 readonly backend:string;
 readonly backendPath?:readonly string[];
 readonly configSettings?:Readonly<Record<string,string|readonly string[]>>;
} & ({readonly hook:'get_requires_for_build_wheel'}|{readonly hook:'build_wheel';readonly wheelDirectory:string;readonly metadataDirectory?:string});
export interface PythonBuildSystemRequest {
 readonly hook:'read_build_system';
 readonly source:string;
 readonly name?:string;
 readonly usePep517?:boolean;
}
export interface PythonBuildSystemDetails {
 readonly requires:readonly string[];
 readonly backend:string;
 readonly check:readonly string[];
 readonly backendPath:readonly string[];
}
type BuildRequest=PythonBuildHookRequest|PythonBuildSystemRequest;
type BuildResult<T extends BuildRequest>=T extends PythonBuildSystemRequest?PythonBuildSystemDetails|null:T extends {readonly hook:'build_wheel'}?string:string[];
export interface PythonBuildHookContext extends Pick<CommandContext,'fs'|'cwd'|'env'|'signal'|'stdout'|'stderr'> {
 /** Total UTF-8 result metadata allowance; wheel bytes stay in caller storage. */
 readonly maxBytes:number;
}

/** Run PEP 517 hooks against a caller-prepared source tree and package environment. */
export function createPythonBuildBackend(options:PythonCommandsOptions & {readonly environment:PythonPackageEnvironment}) {
 if(!options.createExecutor||!options.environment||options.provisioning)throw new TypeError('Python build hooks require an asynchronous executor and explicit environment');
 const capabilities=new WeakMap<readonly string[],PythonHostCapability>();
 const command=createPythonExecutorCommands({...options,createCapabilities(context){
  const provided=options.createCapabilities?.(context)??{};
  if(provided.python_build)throw new Error('Python build capability is reserved');
  const capability=capabilities.get(context.args);
  if(!capability)throw new Error('Unknown Python build invocation');
  return {...provided,python_build:capability};
 }})[0]!;
 return async function run<T extends BuildRequest>(input:T,context:PythonBuildHookContext):Promise<BuildResult<T>> {
  context.signal.throwIfAborted();
  const {maxBytes}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python build metadata limit');
  if(!input||!['read_build_system','get_requires_for_build_wheel','build_wheel'].includes(input.hook)||typeof input.source!=='string'||!input.source)throw new TypeError('Invalid Python build hook request');
  if(input.hook==='read_build_system'){
   if(input.name!==undefined&&typeof input.name!=='string'||input.usePep517!==undefined&&typeof input.usePep517!=='boolean')throw new TypeError('Invalid Python build system request');
  }else{
  if(typeof input.backend!=='string'||!input.backend
   ||input.backendPath!==undefined&&(!Array.isArray(input.backendPath)||input.backendPath.some(path=>typeof path!=='string'))
   ||input.hook==='build_wheel'&&(typeof input.wheelDirectory!=='string'||!input.wheelDirectory||input.metadataDirectory!==undefined&&typeof input.metadataDirectory!=='string'))throw new TypeError('Invalid Python build hook request');
  if(input.configSettings!==undefined&&(!input.configSettings||typeof input.configSettings!=='object'||Array.isArray(input.configSettings)||Object.values(input.configSettings).some(value=>typeof value!=='string'&&(!Array.isArray(value)||value.some(item=>typeof item!=='string')))))throw new TypeError('Invalid Python build configuration');
  }
  const request=structuredClone(input.hook==='read_build_system'?{...input,maxBytes:maxBytes===Infinity?null:maxBytes}:input);
  let done=false,size=0,failure:unknown;
  const chunks:string[]=[];
  const invocation:CommandContext={...context,command:'python',args:['-c',pythonBuildBackendProgram],stdin:toByteSource('')};
  capabilities.set(invocation.args,{async call(value){
   try{
    context.signal.throwIfAborted();
    if(!value||typeof value!=='object'||Array.isArray(value)||done)throw new TypeError('Invalid Python build message');
    const message=value as Record<string,PythonHostValue>;
    if(message.op==='request')return request as unknown as PythonHostValue;
    if(message.op==='error'){
     if(typeof message.type!=='string'||typeof message.message!=='string')throw new TypeError('Invalid Python build failure');
     failure??=Object.assign(new Error(message.message),{name:message.type});done=true;return null;
    }
    if(message.op==='done'){done=true;return null;}
    if(message.op!=='text'||typeof message.text!=='string'||message.text.length>8192)throw new TypeError('Invalid Python build metadata window');
    const bytes=new TextEncoder().encode(message.text).length;
    if(bytes>16384||bytes>maxBytes-size)throw new RangeError('Python build metadata limit exceeded');
    size+=bytes;if(bytes)chunks.push(message.text);return null;
   }catch(error){failure??=error;throw error;}
  }});
  try{
   const result=await command.execute(invocation);
   context.signal.throwIfAborted();
   if(failure)throw failure;
   if(result.exitCode)throw new Error(`Python build interpreter exited with status ${result.exitCode}`);
   if(!done)throw new Error('Python build interpreter returned no result');
   const value:unknown=JSON.parse(chunks.join(''));
   if(request.hook==='read_build_system'){
    if(value!==null){
     if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid Python build system');
     const details=value as Record<string,unknown>;
     if(typeof details.backend!=='string'||!details.backend||['requires','check','backendPath'].some(key=>!Array.isArray(details[key])||(details[key] as unknown[]).some(item=>typeof item!=='string')))throw new TypeError('Invalid Python build system');
    }
   }else if(request.hook==='build_wheel'){
    if(typeof value!=='string'||!value.endsWith('.whl')||value.includes('/')||value.includes('\\')||value.includes('\0'))throw new TypeError('Invalid Python build wheel filename');
   }else if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw new TypeError('Invalid Python build requirements');
   return value as BuildResult<T>;
  }finally{capabilities.delete(invocation.args);}
 };
}

export const pythonBuildBackendProgram=/* @__PURE__ */ (()=>String.raw`
import importlib, json, os, sys, safe_host

def send(op, **fields):
 return safe_host.call('python_build', dict(op=op, **fields))

def read_build_system(request):
 import tomllib
 from urllib.parse import urlparse, urlunparse
 from micropip._vendored.packaging.src.packaging.requirements import Requirement, InvalidRequirement
 class InstallationError(Exception): pass
 source = request['source']
 filename = os.path.join(source, 'pyproject.toml')
 has_project, has_setup = os.path.isfile(filename), os.path.isfile(os.path.join(source, 'setup.py'))
 system = None
 if has_project:
  limit = request['maxBytes']
  with open(filename, 'rb') as stream: raw = stream.read() if limit is None else stream.read(limit + 1)
  if limit is not None and len(raw) > limit: raise ValueError('Python build configuration limit exceeded')
  system = tomllib.loads(raw.decode('utf-8')).get('build-system')
 selected = request.get('usePep517')
 if has_project and not has_setup:
  if selected is False: raise InstallationError('Disabling PEP 517 processing is invalid: project does not have a setup.py')
  selected = True
 elif system and 'build-backend' in system:
  if selected is False: raise InstallationError('Disabling PEP 517 processing is invalid: project specifies a build backend of {} in pyproject.toml'.format(system['build-backend']))
  selected = True
 elif selected is None: selected = has_project
 if not selected: return None
 defaults = ['setuptools>=40.8.0', 'wheel']
 if system is None: system = {'requires': defaults, 'build-backend': 'setuptools.build_meta:__legacy__'}
 def invalid(reason):
  raise InstallationError('{} has a pyproject.toml file that does not comply with PEP 518: {}'.format(request.get('name', source), reason))
 if 'requires' not in system: invalid("it has a 'build-system' table but not 'build-system.requires' which is mandatory in the table")
 requirements = system['requires']
 if not isinstance(requirements, list) or not all(isinstance(value, str) for value in requirements): invalid("'build-system.requires' is not a list of strings.")
 for value in requirements:
  try:
   requirement = Requirement(value)
   if requirement.url:
    url = urlparse(requirement.url)
    if (url.scheme == 'file' and urlunparse(url) != requirement.url) or (url.scheme != 'file' and not (url.scheme and url.netloc)): raise InvalidRequirement(value)
  except InvalidRequirement: invalid("'build-system.requires' contains an invalid requirement: {!r}".format(value))
 backend = system.get('build-backend')
 return dict(requires=requirements, backend=backend if backend is not None else 'setuptools.build_meta:__legacy__', check=defaults if backend is None else [], backendPath=system.get('backend-path', []))

def main():
 request = send('request')
 if request['hook'] == 'read_build_system': return read_build_system(request)
 source = os.path.realpath(request['source'])
 wheel_directory = os.path.abspath(request['wheelDirectory']) if request['hook'] == 'build_wheel' else None
 metadata_directory = os.path.abspath(request['metadataDirectory']) if request.get('metadataDirectory') is not None else None
 os.chdir(source)
 paths = []
 for entry in request.get('backendPath', []):
  if os.path.isabs(entry): raise ValueError('paths must be relative')
  path = os.path.realpath(os.path.join(source, entry))
  if os.path.commonpath([source, path]) != source: raise ValueError('paths must be inside source tree')
  paths.append(path)
 sys.path[:0] = paths
 module, _, attributes = request['backend'].partition(':')
 backend = importlib.import_module(module)
 if paths and not any(os.path.commonpath([os.path.realpath(backend.__file__), path]) == path for path in paths):
  raise ValueError('Backend was not loaded from backend-path')
 if attributes:
  for name in attributes.split('.'): backend = getattr(backend, name)
 settings = request.get('configSettings')
 if request['hook'] == 'get_requires_for_build_wheel':
  try: hook = backend.get_requires_for_build_wheel
  except AttributeError: result = []
  else: result = hook(settings)
 else:
  result = backend.build_wheel(wheel_directory, settings, metadata_directory)
 return result

try:
 result = main()
 encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
 for part in encoder.iterencode(result):
  for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
 send('done')
except Exception as error:
 send('error', type=type(error).__name__, message=str(error))
`)();
