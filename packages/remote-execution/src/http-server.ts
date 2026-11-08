import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type ServerOptions } from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
export interface MediaHttpOptions {
  /** Authenticated public HTTPS origin, including when behind a TLS proxy. */
  origin:string;maxConnections:number;fetch(request:Request):Promise<Response>;
}
/** Node boundary only. Request and response bodies remain streams; never route
 * media through JSON helpers, text logs, base64 or response.arrayBuffer(). */
export function createMediaHttpHandler(options:MediaHttpOptions){
 // Retain authority and admission ceilings before authenticated traffic starts.
 options={...options};
 const origin=new URL(options.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new TypeError('A public HTTPS origin is required');
 if(!Number.isSafeInteger(options.maxConnections)||options.maxConnections<1)throw new TypeError('Invalid HTTP connection bound');let active=0;
 return async (input:IncomingMessage,output:ServerResponse):Promise<void>=>{
  if(active>=options.maxConnections){output.writeHead(429,{'Content-Type':'application/json','Cache-Control':'no-store'});output.end(JSON.stringify({category:'protocol',code:'admissionBound',message:'HTTP admission bound',phase:'notAccepted'}));input.resume();return;}
  active++;const controller=new AbortController();const abort=()=>controller.abort(new Error('HTTP transport interrupted'));const closed=()=>{if(!output.writableFinished)abort();};input.once('aborted',abort);output.once('close',closed);
  let undeliveredBody:ReadableStream<Uint8Array>|null=null;
  try{
   // Node can discard duplicate Authorization fields or join protocol fields.
   // Reject ambiguous authority before constructing normalized Fetch headers.
   const singleHeaders=new Set(['authorization','idempotency-key','execution-epoch','execution-profile','execution-protocol','execution-cursor','execution-offset','content-type','content-length','content-digest','if-match','range','upload-offset','digest']);
   const seenHeaders=new Set<string>();let duplicateHeader=false;
   for(let index=0;index<(input.rawHeaders?.length??0);index+=2){
    const name=input.rawHeaders[index].toLowerCase();
    if(singleHeaders.has(name)&&seenHeaders.has(name)){duplicateHeader=true;break;}
    seenHeaders.add(name);
   }
   if(duplicateHeader){
    output.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});
    output.end(JSON.stringify({category:'protocol',code:'ambiguousRequestHeaders',message:'Duplicate authority or protocol header',phase:'notAccepted'}));
    input.resume();return;
   }
   // WHATWG URLs normalize dot segments, backslashes and control bytes. Do
   // not dispatch credentials under a different target from the received URI.
   let target:URL;
   try{
    if(!input.url?.startsWith('/'))throw new TypeError('Invalid HTTP request target');
    target=new URL(origin.origin+input.url);
    if(target.origin!==origin.origin||target.pathname+target.search!==input.url)throw new TypeError('Invalid HTTP request target');
   }catch{
    output.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});
    output.end(JSON.stringify({category:'protocol',code:'invalidRequestTarget',message:'Invalid HTTP request target',phase:'notAccepted'}));
    input.resume();return;
   }
   const headers=new Headers();for(const [key,value]of Object.entries(input.headers)){if(Array.isArray(value))for(const entry of value)headers.append(key,entry);else if(value!==undefined)headers.set(key,value);}
   const init:RequestInit & {duplex?:'half'}={method:input.method,headers,signal:controller.signal};
   if(input.method!=='GET'&&input.method!=='HEAD'){init.body=Readable.toWeb(input) as ReadableStream<Uint8Array>;init.duplex='half';}
   const response=await options.fetch(new Request(target.href,init));
   undeliveredBody=response.body;
   controller.signal.throwIfAborted();const responseHeaders:Record<string,string>={};response.headers.forEach((value,key)=>{responseHeaders[key]=value;});
   output.writeHead(response.status,responseHeaders);
   if(undeliveredBody){
    const stream=Readable.fromWeb(undeliveredBody as import('node:stream/web').ReadableStream<Uint8Array>);
    // The pipeline now owns cancellation; before this handoff the handler owns it.
    undeliveredBody=null;
    await pipeline(stream,output,{signal:controller.signal});
   }else output.end();
  }catch(error){
   controller.abort(error);
   if(undeliveredBody)await undeliveredBody.cancel(error).catch(()=>{});
   if(!output.headersSent&&!output.destroyed){output.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});output.end(JSON.stringify({category:'unknown',code:'transportUnavailable',message:'HTTP transport unavailable',phase:'unknown'}));}else if(!output.destroyed)output.destroy();
  }finally{input.removeListener('aborted',abort);output.removeListener('close',closed);active--;}
 };
}
/** Explicit operator construction. Does not listen, read TLS files or launch
 * processes; the returned HTTPS server is started and stopped by its owner. */
export function createMediaHttpsServer(options:MediaHttpOptions & {tls:ServerOptions}){
 return createServer(options.tls,createMediaHttpHandler(options));
}
