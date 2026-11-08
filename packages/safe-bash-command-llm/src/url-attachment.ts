import type { CommandContext } from 'safe-bash-contracts';

/** Keep credentials and non-HTTP schemes out of provider-side attachment fetching. */
export function validateAttachmentUrl(value:string):void{
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Attachment URL must use HTTP(S) without credentials');
}
/** Resolve metadata through the caller transport; never download an image payload. */
export async function resolveUrlAttachment(context:Pick<CommandContext,'signal'|'capabilities'>&{readonly fetch?:typeof globalThis.fetch},url:string,mimeType?:string):Promise<{mimeType:string;url:string}>{
 validateAttachmentUrl(url);context.signal.throwIfAborted();
 if(mimeType!==undefined)return {url,mimeType};
 const fetch=context.fetch??context.capabilities?.fetch;
 if(!fetch)throw new Error('Attachment URL loading is not configured');
 const response=await new Promise<Response>((resolve,reject)=>{
  const abort=()=>{context.signal.removeEventListener('abort',abort);reject(context.signal.reason);};
  context.signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{context.signal.throwIfAborted();return fetch(url,{method:'HEAD',redirect:'manual',signal:context.signal});}).then(response=>{
   context.signal.removeEventListener('abort',abort);
   if(context.signal.aborted){void response.body?.cancel().catch(()=>{});reject(context.signal.reason);}else resolve(response);
  },error=>{context.signal.removeEventListener('abort',abort);reject(context.signal.aborted?context.signal.reason:error);});
 });
 let failed=false;
 try{
  context.signal.throwIfAborted();
  if(!response.ok)throw new Error(`Attachment URL returned HTTP ${response.status}`);
  const type=response.headers.get('content-type');
  if(!type)throw new Error('Attachment URL response has no Content-Type');
  return {url,mimeType:type};
 }catch(error){failed=true;throw error;}
 finally{await response.body?.cancel().catch(error=>{if(!failed)throw error;});}
}
