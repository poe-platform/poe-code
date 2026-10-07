import {pythonLlmPluginSetup} from './llm-plugin-setup.js';
import {createLlmSpool,createLlmUrlSource,LlmLoaderLookupError,LlmPluginExit,type LlmFragmentLoader,type LlmInputSource,type LlmLoadedFragment} from 'safe-bash-command-llm';
import {toByteSource,type CommandContext} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';
import type {PythonLlmToolLoaderOptions} from './llm-functions-loader.js';
import type {PythonHostCapability,PythonHostValue} from './host-capabilities.js';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});return {promise,resolve,reject};}

/** Each explicitly authorized native loader invocation owns its interpreter.
 * Results are staged one at a time in caller storage and borrowed until next(). */
export function createPythonLlmFragmentLoader(options:PythonLlmToolLoaderOptions,prefix:string):LlmFragmentLoader {
 if(!options.createExecutor)throw new TypeError('Python fragment loading requires an asynchronous executor');
 if(typeof prefix!=='string'||!prefix)throw new TypeError('Python fragment loader requires a prefix');
 if(options.plugins!==undefined&&(!Array.isArray(options.plugins)||options.plugins.some(name=>typeof name!=='string'||!name||name!==name.trim()||name.includes(','))))throw new TypeError('Python fragment plugins must be explicit distribution names');
 const plugins=Object.freeze([...(options.plugins??[])]),capabilities=new WeakMap<readonly string[],PythonHostCapability>();
 const command=createPythonExecutorCommands({...options,createCapabilities(context){
  const provided=options.createCapabilities?.(context)??{};
  if(provided.llm_fragments)throw new Error('Python fragment capability is reserved');
  const capability=capabilities.get(context.args);
  if(!capability)throw new Error('Unknown Python fragment invocation');
  return {...provided,llm_fragments:capability};
 }})[0]!;
 return async function*(value,context){
  if(typeof value!=='string')throw new TypeError('Python fragment input must be a string');
  const {fs,cwd,maxBytes}=context;
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python fragment byte limit');
  const controller=new AbortController(),signal=AbortSignal.any([context.signal,controller.signal]);
  signal.throwIfAborted();
  let ready=deferred<LlmLoadedFragment|undefined>(),resume:ReturnType<typeof deferred<boolean>>|undefined;
  let current:LlmLoadedFragment|undefined,spool:Awaited<ReturnType<typeof createLlmSpool>>|undefined,closed=false,exited=false,bytes=0;
  const sources=new Set<LlmInputSource>();
  const admit=(size:number)=>{if(size>maxBytes-bytes)throw new RangeError('Python fragment byte limit exceeded');bytes+=size;};
  const fail=(error:unknown)=>{ready.reject(error);resume?.resolve(false);controller.abort(error);};
  const aborted=()=>{ready.reject(signal.reason);resume?.resolve(false);};
  signal.addEventListener('abort',aborted,{once:true});
  const retire=async(source:LlmInputSource)=>{try{await source.dispose();}finally{sources.delete(source);}};
  const dispatch=async(input:PythonHostValue):Promise<PythonHostValue>=>{
   signal.throwIfAborted();
   if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid Python fragment message');
   const message=input as Record<string,PythonHostValue>;
   if(message.op==='request')return {prefix,value,plugins};
   if(message.op==='exit'){exited=true;return null;}
   if(message.op==='missing'||message.op==='lookup')throw new LlmLoaderLookupError(String(message.message));
   if(message.op==='error')throw new Error(String(message.message));
   if(message.op==='begin'){
    if(current||resume)throw new Error('Python fragment already active');
    if(message.type!=='text'&&message.type!=='attachment')throw new TypeError('Invalid Python fragment type');
    if(message.type==='attachment'&&(typeof message.mimeType!=='string'||typeof message.id!=='string'))throw new TypeError('Invalid Python fragment metadata');
    let source:LlmInputSource;
    if(message.url!==undefined){
     if(message.type!=='attachment'||typeof message.url!=='string'||!context.capabilities?.fetch)throw new TypeError('Attachment URL loading is not configured');
     source=createLlmUrlSource({url:message.url,fetch:context.capabilities.fetch,signal,maxBytes:maxBytes-bytes,admitBytes:admit});
    }else{
     const owned=await createLlmSpool(fs,cwd,signal,'input');spool=owned;
     source={bytes:owned.replay(),dispose:()=>owned.close()};
    }
    sources.add(source);
    current=message.type==='text'?{type:'text',source:{...source,normalizeNewlines:false}}:{type:'attachment',source,mimeType:message.mimeType as string,id:message.id as string};
    // Keep the same owned lease identity for normal and exceptional retirement.
    sources.delete(source);sources.add(current.source);
    return null;
   }
   if(!current)throw new Error('No active Python fragment');
   if(message.op==='text'||message.op==='bytes'){
    if(!spool)throw new Error('Remote Python fragments cannot accept inline bytes');
    let chunk:Uint8Array;
    if(message.op==='text'){
     if(current.type!=='text'||typeof message.text!=='string'||message.text.length>8192)throw new TypeError('Invalid Python fragment text window');
     chunk=new TextEncoder().encode(message.text);
     if(chunk.length>16384)throw new TypeError('Invalid Python fragment text window');
    }else{
     if(current.type!=='attachment'||!Array.isArray(message.bytes)||message.bytes.length>4096||message.bytes.some(byte=>typeof byte!=='number'||!Number.isInteger(byte)||byte<0||byte>255))throw new TypeError('Invalid Python fragment byte window');
     chunk=Uint8Array.from(message.bytes as number[]);
    }
    admit(chunk.length);await spool.write(chunk);return null;
   }
   if(message.op==='end'){
    const continuation=resume=deferred<boolean>();ready.resolve(current);
    return continuation.promise;
   }
   throw new TypeError('Invalid Python fragment operation');
  };
  const invocation:CommandContext={...context,command:'python',args:['-c',pythonLlmFragmentProgram],fs,cwd,signal,env:context.env??{},stdin:toByteSource(''),stdout:context.stdout??{async write(){}},stderr:context.stderr??{async write(){}}};
  capabilities.set(invocation.args,{async call(input){try{return await dispatch(input);}catch(error){fail(error);throw error;}}});
  const running=Promise.resolve().then(()=>command.execute(invocation)).then(result=>{
   if(closed)return;
   if(exited)fail(new LlmPluginExit(result.exitCode));
   else if(result.exitCode)fail(new Error(`Python fragment interpreter exited with status ${result.exitCode}`));else ready.resolve(undefined);
  },error=>{if(!closed)fail(error);});
  let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{
   closed=true;resume?.resolve(false);controller.abort(new Error('Python fragment session closed'));
   await running;capabilities.delete(invocation.args);signal.removeEventListener('abort',aborted);
   await Promise.all([...sources].map(retire));
  })();
  context.registerCleanup?.(close);
  try{
   while(true){
    const fragment=await ready.promise;
    if(!fragment)break;
    let advance=false;
    try{yield fragment;advance=true;}
    finally{
     await retire(fragment.source);
     current=undefined;spool=undefined;
     ready=deferred<LlmLoadedFragment|undefined>();
     const continuation=resume;resume=undefined;continuation?.resolve(advance);
    }
   }
  }finally{await close();}
 };
}

export const pythonLlmFragmentProgram=/* @__PURE__ */ (()=>String.raw`
import hashlib, llm, safe_host
from llm_safe_host import _attachment_type

${pythonLlmPluginSetup}

def send(op, **fields):
 return safe_host.call('llm_fragments', dict(op=op, **fields))

def emit_attachment(value):
 mime = _attachment_type(value)
 if not value.content and value.path:
  with open(value.path, 'rb') as source:
   if value._id is None:
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(4096), b''): digest.update(chunk)
    value._id = digest.hexdigest()
    source.seek(0)
   send('begin', type='attachment', mimeType=mime, id=value.id())
   for chunk in iter(lambda: source.read(4096), b''): send('bytes', bytes=list(chunk))
 elif not value.content and value.url:
  send('begin', type='attachment', mimeType=mime, id=value.id(), url=value.url)
 else:
  send('begin', type='attachment', mimeType=mime, id=value.id())
  content = memoryview(value.content or b'')
  for offset in range(0, len(content), 4096): send('bytes', bytes=list(content[offset:offset + 4096]))

def main():
 request = send('request')
 try:
  load_plugins(request)
  loaders = llm.get_fragment_loaders()
 except Exception as error:
  send('lookup', message=str(error))
  return
 if request['prefix'] not in loaders:
  send('missing', message='Unknown fragment prefix: ' + request['prefix'])
  return
 result = loaders[request['prefix']](request['value'])
 if not isinstance(result, list): result = [result]
 for value in result:
  if isinstance(value, llm.Attachment): emit_attachment(value)
  elif isinstance(value, str):
   send('begin', type='text')
   for offset in range(0, len(value), 4096): send('text', text=value[offset:offset + 4096])
  else: raise TypeError('Fragment loader must return text or attachments')
  if not send('end'): return
try:
 main()
except SystemExit:
 send('exit')
 raise
except Exception as error:
 send('error', message=str(error))
`)();
