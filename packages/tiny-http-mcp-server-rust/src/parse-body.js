import {createRequire} from 'node:module';
const {classifyHttpBody,NativeHttpBodyBudget}=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export class JsonRpcMessageError extends Error{
 constructor(id,code,message){super(message);this.id=id;this.code=code;}
}
export async function readAndClassifyBody(request,preParsed,options={}){
 const body=preParsed!==undefined?preParsed:request.body;
 const budget=new NativeHttpBodyBudget(options.maxBytes);
 let text;
 if(body!==undefined){
  text=JSON.stringify(body);
  if(text===undefined)throw new Error('Invalid Request');
  if(options.maxBytes!==undefined&&!budget.admit(Buffer.byteLength(text,'utf8')))throw new Error('Payload too large');
 }else{
  const decoder=new TextDecoder('utf-8',{fatal:true});text='';let malformed=false;
  for await(const chunk of request){
   const bytes=typeof chunk==='string'?Buffer.from(chunk):chunk instanceof Uint8Array?chunk:Buffer.from(String(chunk));
   if(!budget.admit(bytes.byteLength))throw new Error('Payload too large');
   if(!malformed)try{text+=decoder.decode(bytes,{stream:true});}catch{malformed=true;}
  }
  if(malformed)throw new Error('Parse error');
  try{text+=decoder.decode();}catch{throw new Error('Parse error');}
 }
 const result=classifyHttpBody(text,options.maxBatchSize);
 if(Object.hasOwn(result,'error')){
  const error=result.error;
  if(Object.hasOwn(error,'id'))throw new JsonRpcMessageError(error.id,error.code,error.message);
  throw new Error(error.message);
 }
 const plan=result.value,lists=[undefined,[],[],[]],messages=[];
 for(let index=0;index<plan.entries.length;index++){
  const kind=plan.kinds[index],message=plan.entries[index];
  if(kind===0)continue;
  if(kind!==3&&!Object.hasOwn(message,'params'))message.params=undefined;
  lists[kind].push(message);messages.push(message);
 }
 return {isBatch:plan.isBatch,entries:plan.entries,messages,hasRequests:plan.hasRequests,hasNotifications:plan.hasNotifications,hasResponses:plan.hasResponses,requests:lists[1],notifications:lists[2],responses:lists[3]};
}
