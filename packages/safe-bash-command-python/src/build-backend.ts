import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands, type PythonCommandsOptions, type PythonPackageEnvironment} from './executor.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';

export type PythonBuildHookRequest = {
 readonly source:string;
 readonly backend:string;
 readonly backendPath?:readonly string[];
 readonly configSettings?:Readonly<Record<string,string|readonly string[]>>;
} & ({readonly hook:'get_requires_for_build_wheel'}|{readonly hook:'build_wheel';readonly wheelDirectory:string;readonly metadataDirectory?:string});
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
 return async function run<T extends PythonBuildHookRequest>(input:T,context:PythonBuildHookContext):Promise<T extends {readonly hook:'build_wheel'}?string:string[]> {
  context.signal.throwIfAborted();
  const {maxBytes}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python build metadata limit');
  if(!input||!['get_requires_for_build_wheel','build_wheel'].includes(input.hook)||typeof input.source!=='string'||!input.source||typeof input.backend!=='string'||!input.backend
   ||input.backendPath!==undefined&&(!Array.isArray(input.backendPath)||input.backendPath.some(path=>typeof path!=='string'))
   ||input.hook==='build_wheel'&&(typeof input.wheelDirectory!=='string'||!input.wheelDirectory||input.metadataDirectory!==undefined&&typeof input.metadataDirectory!=='string'))throw new TypeError('Invalid Python build hook request');
  if(input.configSettings!==undefined&&(!input.configSettings||typeof input.configSettings!=='object'||Array.isArray(input.configSettings)||Object.values(input.configSettings).some(value=>typeof value!=='string'&&(!Array.isArray(value)||value.some(item=>typeof item!=='string')))))throw new TypeError('Invalid Python build configuration');
  const request=structuredClone(input);
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
   if(request.hook==='build_wheel'){
    if(typeof value!=='string'||!value.endsWith('.whl')||value.includes('/')||value.includes('\\')||value.includes('\0'))throw new TypeError('Invalid Python build wheel filename');
   }else if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw new TypeError('Invalid Python build requirements');
   return value as T extends {readonly hook:'build_wheel'}?string:string[];
  }finally{capabilities.delete(invocation.args);}
 };
}

export const pythonBuildBackendProgram=/* @__PURE__ */ (()=>String.raw`
import importlib, json, os, sys, safe_host

def send(op, **fields):
 return safe_host.call('python_build', dict(op=op, **fields))

def main():
 request = send('request')
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
 encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
 for part in encoder.iterencode(result):
  for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
 send('done')
try:
 main()
except Exception as error:
 send('error', type=type(error).__name__, message=str(error))
`)();
