import {dataSnapshot} from './data.js';
export class TemplateParseError extends Error{
 constructor(description,{line,column}){super(`${description} at line ${line}, column ${column}`);this.name='TemplateParseError';this.description=description;this.line=line;this.column=column;}
}
export function createTemplateEngine(native){
function unwrap(result){if(result.error){const{description,line,column}=result.error;throw line===null?new Error(description):new TemplateParseError(description,{line,column});}return result.value;}
function replies(){return {hit:false,truthy:false,nullish:true,kind:0,handle:0,empty:false,done:false,text:''};}
function partialCallback(partials){return function(op,handle,context,name){const reply=replies();if(op===6)reply.hit=Object.hasOwn(partials,name);else if(op===7)reply.text=partials[name];return reply;};}
function getTemplatePartialNames(template){return unwrap(native.templatePartialNames(template));}
function resolveTemplatePartials(template,partials){return unwrap(native.templateExpand(template,partialCallback(partials)));}
function renderTemplate(template,view,options={}){
 const data=template.includes('{{')?dataSnapshot(view,options):null;
 if(data){const partial=partialCallback(options.partials??{});return unwrap(native.templateRenderData(template,data.buffer,(op,handle,context,name)=>{
   if(op===6||op===7)return partial(op,handle,context,name);const reply=replies();reply.text=String(data.values[handle]);return reply;
  },{context:0,escapeNone:options.escape==='none',validate:options.validate===true,yieldText:options.yield,inContext:false,stack:[]}));}
 const contexts=[{view,parent:null}],values=[],iterators=[],partial=partialCallback(options.partials??{});
 function store(value){const handle=values.length;values.push(value);return handle;}
 function lookup(context,name){
  if(name==='.')return {hit:true,value:call(context.view,context.view)};
  while(context){let value=context.view;let hit=true;const parts=name.includes('.')?name.split('.'):[name];
   for(const part of parts){if(!((typeof value==='object'&&value!==null)||typeof value==='function')||!Object.prototype.hasOwnProperty.call(value,part)){hit=false;break;}value=Object(value)[part];}
   if(hit)return {hit:true,value:call(value,context.view)};context=context.parent===null?null:contexts[context.parent];
  }
  return {hit:false,value:undefined};
 }
 function call(value,view){return typeof value==='function'?value.call(view):value;}
 function invoke(template,context,inContext,stack){return unwrap(native.templateRender(template,callback,{context,escapeNone:options.escape==='none',validate:options.validate===true,yieldText:options.yield,inContext,stack}));}
 function callback(op,handle,context,name,stack){
  if(op===6||op===7)return partial(op,handle,context,name);
  const reply=replies();
  if(op===0){const result=lookup(contexts[context],name),value=result.value;reply.hit=result.hit;reply.truthy=!!value;reply.nullish=value==null;reply.kind=Array.isArray(value)?4:typeof value==='object'&&value!==null?1:typeof value==='string'?2:typeof value==='number'?3:typeof value==='function'?5:0;reply.empty=Array.isArray(value)&&value.length===0;reply.handle=store(value);}
  else if(op===1)reply.text=String(values[handle]);
  else if(op===2){reply.handle=contexts.length;contexts.push({view:values[handle],parent:context});}
  else if(op===3){reply.handle=iterators.length;iterators.push(values[handle][Symbol.iterator]());}
  else if(op===4){const next=iterators[handle].next();reply.done=!!next.done;if(!next.done)reply.handle=store(next.value);}
  else if(op===5){const iterator=iterators[handle];if(typeof iterator.return==='function')iterator.return();}
  else if(op===8){const value=values[handle].call(contexts[context].view,name,next=>invoke(next,context,true,stack));reply.text=value==null?'':String(value);}
  return reply;
 }
 return invoke(template,0,false,[]);
}
return {renderTemplate,getTemplatePartialNames,resolveTemplatePartials,TemplateParseError};
}
