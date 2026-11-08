import type {CommandContext,FileSystem} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {waitForSource} from './request-source.js';
import type {LlmInputSource} from './types.js';
import type {LlmFragmentInputSource} from './fragments.js';
import {LlmLoaderLookupError,LlmPluginExit,type LlmLoaderProvider} from './loader-provider.js';

export type LlmLoadedFragment =
 | {readonly type:'text';readonly source:LlmFragmentInputSource}
 | {readonly type:'attachment';readonly source:LlmInputSource;readonly mimeType:string;readonly id?:string};
export interface LlmFragmentLoaderContext extends Partial<Omit<CommandContext, 'fs' | 'cwd' | 'signal'>> {
 readonly fs:FileSystem;
 readonly cwd:string;
 readonly signal:AbortSignal;
 /** Remaining command admission. The host must bound acquisition before yielding. */
 readonly maxBytes:number;
 readonly capabilities?:CommandContext['capabilities'];
}
/** Acquire lazily. A yielded source is borrowed until the next pull or return. */
export type LlmFragmentLoader = ((value:string,context:LlmFragmentLoaderContext)=>AsyncIterable<LlmLoadedFragment>) & {readonly description?:string};

export function getLlmFragmentPrefix(reference:string):string|undefined {
 const colon=reference.indexOf(':');if(colon<=0)return undefined;
 for(let i=0;i<colon;i++){
  const code=reference.charCodeAt(i);
  if(!(code>=48&&code<=57||code>=65&&code<=90||code>=97&&code<=122||code===45||code===95))return undefined;
 }
 return reference.slice(0,colon);
}

/** Preserve registration order and the reference's collision suffixes. */
export function createLlmFragmentLoaders(entries:Iterable<readonly [string,LlmFragmentLoader]>):ReadonlyMap<string,LlmFragmentLoader> {
 const loaders=new Map<string,LlmFragmentLoader>();
 for(const [prefix,loader]of entries){let name=prefix,suffix=0;while(loaders.has(name))name=`${prefix}_${++suffix}`;loaders.set(name,loader);}
 return loaders;
}

/** Resolve an injected loader without ambient plugin imports or history. */
export async function* loadLlmPluginFragments(reference:string,loaders:ReadonlyMap<string,LlmFragmentLoader>,context:LlmFragmentLoaderContext,allowAttachments=true,provider?:Pick<LlmLoaderProvider,'fragments'>):AsyncGenerator<LlmLoadedFragment> {
 context.signal.throwIfAborted();
 const prefix=getLlmFragmentPrefix(reference),loader=prefix===undefined?undefined:loaders.get(prefix)??provider?.fragments(prefix);
 if(!loader)throw new Error(`Unknown fragment prefix: ${prefix??reference}`);
 const {signal}=context;
 let iterator:AsyncIterator<LlmLoadedFragment>|undefined,ended=false;
 try{
  signal.throwIfAborted();
  iterator=loader(reference.slice(prefix!.length+1),context)[Symbol.asyncIterator]();
  while(true){
   await yieldTurn(signal);
   const pending=Promise.resolve().then(()=>{signal.throwIfAborted();return iterator!.next();});
   void pending.then(result=>{if(signal.aborted&&!result.done)void result.value.source.dispose().catch(()=>undefined);},()=>undefined);
   const result=await waitForSource(()=>pending,signal);
   if(result.done){ended=true;break;}
   const value=result.value;
   let closing:Promise<void>|undefined;
   const dispose=():Promise<void>=>closing??=Promise.resolve().then(()=>value.source.dispose());
   try{
    if(value.type!=='text'&&value.type!=='attachment')throw new TypeError('Invalid fragment loader result');
    if(value.type==='attachment'&&!allowAttachments)throw new Error(`Fragment loader ${prefix} returned a disallowed attachment`);
    const source={bytes:value.source.bytes,dispose,normalizeNewlines:false};
    yield {...value,source};
   }finally{await dispose();}
  }
 }catch(error){signal.throwIfAborted();if(error instanceof LlmLoaderLookupError||error instanceof LlmPluginExit)throw error;throw new Error(`Could not load fragment ${reference}: ${error instanceof Error?error.message:String(error)}`);}
 finally{
  if(iterator&&!ended){
   const retired=Promise.resolve().then(()=>iterator!.return?.());
   if(signal.aborted)void retired.catch(()=>undefined);else await waitForSource(()=>retired,signal);
  }
 }
}
