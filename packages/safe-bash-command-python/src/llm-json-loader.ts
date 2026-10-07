import {LlmLoaderLookupError,LlmPluginExit,type LlmFragmentLoaderContext} from 'safe-bash-command-llm';
import {toByteSource,type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';
import type {PythonLlmToolLoaderOptions} from './llm-functions-loader.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';

/** Bounded native metadata transport with caller-owned interpreter retirement. */
export function createPythonLlmJsonLoader(options:PythonLlmToolLoaderOptions,capabilityName:string,program:string,label:string){
 if(!options.createExecutor)throw new TypeError(`Python ${label} loading requires an asynchronous executor`);
 if(options.plugins!==undefined&&(!Array.isArray(options.plugins)||options.plugins.some(name=>typeof name!=='string'||!name||name!==name.trim()||name.includes(','))))throw new TypeError(`Python ${label} plugins must be explicit distribution names`);
 const plugins=Object.freeze([...(options.plugins??[])]),capabilities=new WeakMap<readonly string[],PythonHostCapability>();
 const command=createPythonExecutorCommands({...options,createCapabilities(context){
  const provided=options.createCapabilities?.(context)??{};
  if(provided[capabilityName])throw new Error(`Python ${label} capability is reserved`);
  const capability=capabilities.get(context.args);
  if(!capability)throw new Error(`Unknown Python ${label} invocation`);
  return {...provided,[capabilityName]:capability};
 }})[0]!;
 return async(request:Record<string,PythonHostValue>,context:LlmFragmentLoaderContext,admitBytes?:(size:number)=>void):Promise<unknown>=>{
  if(!context)throw new TypeError(`Python ${label} loading requires caller context`);
  const {maxBytes,signal}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError(`Invalid Python ${label} byte limit`);
  signal.throwIfAborted();
  let size=0,done=false,exited=false,failure:unknown;
  const chunks:string[]=[];
  const invocation:CommandContext={...context,command:'python',args:['-c',program],signal,env:context.env??{},stdin:toByteSource(''),stdout:context.stdout??{async write(){}},stderr:context.stderr??{async write(){}}};
  capabilities.set(invocation.args,{async call(input:PythonHostValue){
   try{
    signal.throwIfAborted();
    if(!input||typeof input!=='object'||Array.isArray(input)||done)throw new TypeError(`Invalid Python ${label} message`);
    const message=input as Record<string,PythonHostValue>;
    if(message.op==='request')return {...request,plugins};
    if(message.op==='missing'||message.op==='lookup'||message.op==='error'){
     failure??=message.op==='error'?new Error(String(message.message)):new LlmLoaderLookupError(String(message.message));done=true;return null;
    }
    if(message.op==='exit'){done=true;exited=true;return null;}
    if(message.op==='done'){done=true;return null;}
    if(message.op!=='text'||typeof message.text!=='string'||message.text.length>8192)throw new TypeError(`Invalid Python ${label} text window`);
    const bytes=new TextEncoder().encode(message.text).length;
    if(bytes>16384)throw new TypeError(`Invalid Python ${label} text window`);
    if(bytes>maxBytes-size)throw new RangeError(`Python ${label} byte limit exceeded`);
    admitBytes?.(bytes);size+=bytes;if(bytes)chunks.push(message.text);return null;
   }catch(error){failure??=error;throw error;}
  }});
  try{
   const result=await command.execute(invocation);
   signal.throwIfAborted();
   if(failure)throw failure;
   if(exited)throw new LlmPluginExit(result.exitCode);
   if(result.exitCode)throw new Error(`Python ${label} interpreter exited with status ${result.exitCode}`);
   if(!done)throw new Error(`Python ${label} interpreter returned no result`);
   return JSON.parse(chunks.join(''));
  }finally{capabilities.delete(invocation.args);}
 };
}
