import type {LlmFragmentLoader,LlmFragmentLoaderContext} from './fragment-loaders.js';
import type {LlmTemplateLoader} from './templates.js';
import {waitForSource} from './request-source.js';

export interface LlmDiscoveredLoaders {
 readonly fragmentLoaders:ReadonlyMap<string,LlmFragmentLoader>;
 readonly templateLoaders:ReadonlyMap<string,LlmTemplateLoader>;
}
export interface LlmLoaderDiscoveryContext extends LlmFragmentLoaderContext {
 readonly kind?: 'fragments'|'templates';
 /** Charge metadata before retention, in addition to maxBytes admission. */
 readonly admitBytes?: ((size:number)=>void)|undefined;
}
export interface LlmLoaderProvider {
 discover(context:LlmLoaderDiscoveryContext):Promise<LlmDiscoveredLoaders>;
 /** Resolve lazily; discovery must not run again before executing a loader. */
 fragments(prefix:string):LlmFragmentLoader|undefined;
 templates(prefix:string):LlmTemplateLoader|undefined;
}
/** Lookup failures precede loader execution and retain their native diagnostic. */
export class LlmLoaderLookupError extends Error {}

/** An explicitly requested plugin process exit, after its diagnostics are emitted. */
export class LlmPluginExit extends Error {
 constructor(readonly exitCode:number) {
  super();
 }
}

export async function discoverLlmLoaders(loaders:ReadonlyMap<string,{readonly description?:string}>|undefined,context:LlmLoaderDiscoveryContext,provider?:LlmLoaderProvider):Promise<ReadonlyMap<string,{readonly description?:string}>> {
 if(!provider)return loaders??new Map();
 const result=await waitForSource(()=>provider.discover(context),context.signal);
 return new Map([...result[context.kind==='fragments'?'fragmentLoaders':'templateLoaders'],...loaders??[]]);
}
