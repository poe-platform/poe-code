import {pythonLlmExitHandlers,pythonLlmLookupErrors} from './llm-exit-handlers.js';
import {pythonLlmPluginSetup} from './llm-plugin-setup.js';
import type {LlmTemplate,LlmTemplateLoader} from 'safe-bash-command-llm';
import type {PythonLlmToolLoaderOptions} from './llm-functions-loader.js';
import {createPythonLlmJsonLoader} from './llm-json-loader.js';

/** Execute an explicitly authorized native loader within the caller's remaining
 * template materialization allowance. Native JSON travels in bounded windows. */
export function createPythonLlmTemplateLoader(options:PythonLlmToolLoaderOptions,prefix:string):LlmTemplateLoader {
 if(typeof prefix!=='string'||!prefix)throw new TypeError('Python template loader requires a prefix');
 const load=createPythonLlmJsonLoader(options,'llm_templates',pythonLlmTemplateProgram,'template');
 return async(value,signal,context)=>{
  if(!context)throw new TypeError('Python template loading requires caller context');
  if(typeof value!=='string')throw new TypeError('Python template input must be a string');
  const template=await load({prefix,value},{...context,signal});
  if(!template||typeof template!=='object'||Array.isArray(template)||typeof (template as LlmTemplate).name!=='string')throw new TypeError('Invalid native Python template');
  return template as LlmTemplate;
 };
}

export const pythonLlmTemplateProgram=/* @__PURE__ */ (()=>String.raw`
from click import Abort, ClickException, echo
import json, llm, safe_host

${pythonLlmPluginSetup}

def send(op, **fields):
 return safe_host.call('llm_templates', dict(op=op, **fields))

def main():
 request = send('request')
 try:
  load_plugins(request)
  loaders = llm.get_template_loaders()
${pythonLlmLookupErrors}
 if request['prefix'] not in loaders:
  send('missing', message='Unknown template prefix: ' + request['prefix'])
  return
 try:
  template = loaders[request['prefix']](request['value'])
  encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
  for part in encoder.iterencode(template.model_dump(exclude_none=True)):
   for offset in range(0, len(part), 4096): send('text', text=part[offset:offset + 4096])
  send('done')
 except Exception as error:
  send('error', message=str(error))
try:
 main()
${pythonLlmExitHandlers}
except Exception as error:
 send('error', message=str(error))
`)();
