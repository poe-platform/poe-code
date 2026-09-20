import {createRequire} from 'node:module';
import {createTemplateEngine} from './design/engine.js';
import {jsonFormat} from './json.js';
import {tomlFormat} from './toml.js';
import {configRequests} from './config.js';
import {writeAtomically} from './io.js';
import {isNotFound} from './fs-utils.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node'),engine=createTemplateEngine(native);
/** Configuration-facing templates deliberately disable HTML escaping. */
export function renderTemplate(template,variables){return engine.renderTemplate(template,variables,{escape:'none'});}
export async function applyTemplate(mutation,context,options,prepareTarget){
 const machine=new native.ConfigTemplateMachine(mutation.kind);let request=machine.start(),prepared,template,view,rendered,interpret;
 const format=mutation.kind==='templateMergeJson'?jsonFormat:tomlFormat;
 try{while(true){
  if(request.error)throw Error(request.error);
  if(request.kind==='done')return {outcome:request.outcome,details:prepared.details};
  let response;
  if(request.phase==='config')response={kind:'config',config:await interpret(request)};
  else switch(request.kind){
   case 'loader':response={kind:'supported',flag:!!context.templates};break;
   case 'resolve':prepared=prepareTarget();response={kind:'unit'};break;
   case 'load':template=await context.templates(mutation.templateId);response={kind:'unit'};break;
   case 'context':{if(mutation.context){const value=mutation.context;view=typeof value==='function'?value(options):value;}else view={};response={kind:'unit'};break;}
   // Execution uses the design engine's HTML default, matching the current SDK.
   case 'render':rendered=engine.renderTemplate(template,view);response={kind:'rendered',content:rendered};break;
   case 'parseRendered':{let patch;try{patch=format.parse(rendered);}catch(error){const failure=machine.respond({kind:'invalidTemplate',id:`${mutation.templateId}`,error:`${error}`});throw Error(failure.error,{cause:error});}interpret=configRequests(mutation,context,options,prepared.raw,prepared.target,{format,patch});response={kind:'unit'};break;}
   case 'readFile':{try{response={kind:'content',content:await context.fs.readFile(prepared.target,'utf8')};}catch(error){if(!isNotFound(error))throw error;response={kind:'missing'};}break;}
   case 'dryRun':response={kind:'dryRun',flag:!!context.dryRun};break;
   case 'writeAtomically':await writeAtomically(context,prepared.target,request.content);response={kind:'unit'};break;
   default:throw Error(`Unknown template mutation request: ${request.kind}`);
  }
  request=machine.respond(response);
 }}finally{machine.discard();}
}
