import type {LlmTemplate,LlmTemplateLoader} from 'safe-bash-command-llm';
import {toByteSource,type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';
import type {PythonLlmToolLoaderOptions} from './llm-functions-loader.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';

/** Execute an explicitly authorized native loader within the caller's remaining
 * template materialization allowance. Native JSON travels in bounded windows. */
export function createPythonLlmTemplateLoader(options:PythonLlmToolLoaderOptions,prefix:string):LlmTemplateLoader {
 if(!options.createExecutor)throw new TypeError('Python template loading requires an asynchronous executor');
 if(typeof prefix!=='string'||!prefix)throw new TypeError('Python template loader requires a prefix');
 if(options.plugins!==undefined&&(!Array.isArray(options.plugins)||options.plugins.some(name=>typeof name!=='string'||!name||name!==name.trim()||name.includes(','))))throw new TypeError('Python template plugins must be explicit distribution names');
 const plugins=Object.freeze([...(options.plugins??[])]),capabilities=new WeakMap<readonly string[],PythonHostCapability>();
 const command=createPythonExecutorCommands({...options,createCapabilities(context){
  const provided=options.createCapabilities?.(context)??{};
  if(provided.llm_templates)throw new Error('Python template capability is reserved');
  const capability=capabilities.get(context.args);
  if(!capability)throw new Error('Unknown Python template invocation');
  return {...provided,llm_templates:capability};
 }})[0]!;
 return async(value,signal,context)=>{
  if(!context)throw new TypeError('Python template loading requires caller context');
  if(typeof value!=='string')throw new TypeError('Python template input must be a string');
  const {maxBytes}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python template byte limit');
  signal.throwIfAborted();
  let size=0,done=false,failure:unknown;
  const chunks:string[]=[];
  const invocation:CommandContext={...context,command:'python',args:['-c',pythonLlmTemplateProgram],signal,stdin:toByteSource(''),stdout:context.stdout??{async write(){}},stderr:context.stderr??{async write(){}}};
  capabilities.set(invocation.args,{async call(input:PythonHostValue){
   try{
    signal.throwIfAborted();
    if(!input||typeof input!=='object'||Array.isArray(input)||done)throw new TypeError('Invalid Python template message');
    const message=input as Record<string,PythonHostValue>;
    if(message.op==='request')return {prefix,value,plugins};
    if(message.op==='error')throw new Error(String(message.message));
    if(message.op==='done'){done=true;return null;}
    if(message.op!=='text'||typeof message.text!=='string'||message.text.length>8192)throw new TypeError('Invalid Python template text window');
    const bytes=new TextEncoder().encode(message.text).length;
    if(bytes>16384)throw new TypeError('Invalid Python template text window');
    if(bytes>maxBytes-size)throw new RangeError('Python template byte limit exceeded');
    size+=bytes;if(bytes)chunks.push(message.text);return null;
   }catch(error){failure??=error;throw error;}
  }});
  try{
   const result=await command.execute(invocation);
   signal.throwIfAborted();
   if(failure)throw failure;
   if(result.exitCode)throw new Error(`Python template interpreter exited with status ${result.exitCode}`);
   if(!done)throw new Error('Python template interpreter returned no template');
   const template:unknown=JSON.parse(chunks.join(''));
   if(!template||typeof template!=='object'||Array.isArray(template)||typeof (template as LlmTemplate).name!=='string')throw new TypeError('Invalid native Python template');
   return template as LlmTemplate;
  }finally{capabilities.delete(invocation.args);}
 };
}

export const pythonLlmTemplateProgram=/* @__PURE__ */ (()=>String.raw`
import json, llm, safe_host

def send(op, **fields):
 return safe_host.call('llm_templates', dict(op=op, **fields))

def main():
 request = send('request')
 import llm.plugins as manager
 manager.load_plugins()
 if request['plugins']:
  original = (manager.DEFAULT_PLUGINS, manager.LLM_LOAD_PLUGINS, manager._loaded)
  try:
   manager.DEFAULT_PLUGINS = ()
   manager.LLM_LOAD_PLUGINS = ','.join(request['plugins'])
   manager._loaded = False
   manager.load_plugins()
  finally:
   manager.DEFAULT_PLUGINS, manager.LLM_LOAD_PLUGINS, manager._loaded = original
 loaders = llm.get_template_loaders()
 if request['prefix'] not in loaders: raise ValueError('Unknown template prefix: ' + request['prefix'])
 template = loaders[request['prefix']](request['value'])
 encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
 for part in encoder.iterencode(template.model_dump(exclude_none=True)):
  for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
 send('done')
try:
 main()
except Exception as error:
 send('error', message=str(error))
`)();
