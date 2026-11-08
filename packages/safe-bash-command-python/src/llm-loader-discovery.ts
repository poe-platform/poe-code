import {pythonLlmExitHandlers} from './llm-exit-handlers.js';
import {pythonLlmPluginSetup} from './llm-plugin-setup.js';
import type {LlmFragmentLoader,LlmLoaderDiscoveryContext,LlmLoaderProvider,LlmTemplateLoader} from 'safe-bash-command-llm';
import type {PythonLlmToolLoaderOptions} from './llm-functions-loader.js';
import {createPythonLlmFragmentLoader} from './llm-fragment-loader.js';
import {createPythonLlmTemplateLoader} from './llm-template-loader.js';
import {createPythonLlmJsonLoader} from './llm-json-loader.js';

export interface PythonLlmDiscoveredLoaders {
 readonly fragmentLoaders:ReadonlyMap<string,LlmFragmentLoader>;
 readonly templateLoaders:ReadonlyMap<string,LlmTemplateLoader>;
}
export type PythonLlmLoaderDiscoveryContext = LlmLoaderDiscoveryContext;

/** Discover at listing time and resolve prefixes without an extra native hook pass. */
export function createPythonLlmLoaderProvider(options:PythonLlmToolLoaderOptions):LlmLoaderProvider {
 const discover=createPythonLlmLoaderDiscovery(options),configured={...options,plugins:Object.freeze([...(options.plugins??[])])};
 return {discover,fragments:createPythonLlmFragmentLoader.bind(null,configured),templates:createPythonLlmTemplateLoader.bind(null,configured)};
}

/** Discover native prefixes only from explicitly authorized installed plugins.
 * Invoke again after changing the environment; no ambient registry is retained. */
export function createPythonLlmLoaderDiscovery(options:PythonLlmToolLoaderOptions):(context:PythonLlmLoaderDiscoveryContext)=>Promise<PythonLlmDiscoveredLoaders> {
 const load=createPythonLlmJsonLoader(options,'llm_loaders',pythonLlmLoaderDiscoveryProgram,'loader discovery');
 const configured={...options,plugins:Object.freeze([...(options.plugins??[])])};
 return async context=>{
  if(context.kind!==undefined&&context.kind!=='fragments'&&context.kind!=='templates')throw new TypeError('Invalid native loader discovery kind');
  const result=await load(context.kind===undefined?{}:{kind:context.kind},context,context.admitBytes);
  if(!result||typeof result!=='object'||Array.isArray(result))throw new TypeError('Invalid native loader discovery');
  function loaders<T extends LlmFragmentLoader|LlmTemplateLoader>(entries:unknown,create:(options:PythonLlmToolLoaderOptions,prefix:string)=>T):ReadonlyMap<string,T>{
   if(!Array.isArray(entries))throw new TypeError('Invalid native loader discovery');
   const values=new Map<string,T>();
   for(const entry of entries){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!entry[0]||values.has(entry[0])||(entry[1]!==null&&typeof entry[1]!=='string'))throw new TypeError('Invalid native loader registration');
    const loader=create(configured,entry[0]);
    if(entry[1]!==null)Object.defineProperty(loader,'description',{value:entry[1],enumerable:true});
    values.set(entry[0],loader);
   }
   return values;
  }
  const data=result as Record<string,unknown>;
  return {fragmentLoaders:loaders(data.fragments,createPythonLlmFragmentLoader),templateLoaders:loaders(data.templates,createPythonLlmTemplateLoader)};
 };
}

export const pythonLlmLoaderDiscoveryProgram=/* @__PURE__ */ (()=>String.raw`
from click import Abort, ClickException, echo
import json, llm, safe_host

${pythonLlmPluginSetup}

def send(op, **fields):
 return safe_host.call('llm_loaders', dict(op=op, **fields))

def main():
 request = send('request')
 load_plugins(request)
 encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
 kind = request.get('kind')
 result = dict(fragments=[] if kind == 'templates' else [(prefix, loader.__doc__) for prefix, loader in llm.get_fragment_loaders().items()],
               templates=[] if kind == 'fragments' else [(prefix, loader.__doc__) for prefix, loader in llm.get_template_loaders().items()])
 for part in encoder.iterencode(result):
  for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
 send('done')
try:
 main()
${pythonLlmExitHandlers}
except ClickException as error:
 error.show()
 send('exit')
 raise SystemExit(error.exit_code)
except Exception as error:
 send('error', message=str(error))
`)();
