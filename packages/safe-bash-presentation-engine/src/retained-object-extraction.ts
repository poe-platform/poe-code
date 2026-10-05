import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { partName } from './package-uri.js';
import { openRetainedObjects } from './retained-objects.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { RetainedValues, literal, digest } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import { rawJson, streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import type { XmlRange } from './retained-xml.js';
export interface RetainedExtractedObjectMember {
  readonly part: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  bytes(): ByteSource;
}
/** Admit the complete opaque inventory, then retain the selected closure and
 * original relationship parts. The archive and source remain caller-owned. */
export async function openRetainedObjectExtraction(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  options: { readonly part: string }, settings: RetainedPackageContext
) {
  if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).length !== 1 || !Object.hasOwn(options,'part') || !('value' in Object.getOwnPropertyDescriptor(options,'part')!) || typeof options.part !== 'string')
    throw new OfficeError('invalid-value','Object extraction requires an exact package part.','usage');
  const selected=partName(options.part,false),context={...resourceContext(settings),workingStorage:{...settings.workingStorage}},signal=context.signal??new AbortController().signal;
  const inventory=await openRetainedObjects(archive,context); let present=false,failed=false;
  try { for await(const object of inventory.summaries()) if(object.part===selected) present=true; }
  catch(error) {failed=true;throw error;}
  finally {try {await inventory.close();}catch(error){if(!failed)await Promise.reject(error);}}
  if(!present) throw new OfficeError('missing-binding','Opaque object part is absent.','index');
  const graph=await openRetainedRelationshipGraph(archive,context);
  const pages=new PagedStorage({fs:context.workingStorage.fs,cwd:context.workingStorage.directory,env:{},signal},(context.workingStorage.cacheBytes??1024*1024)/16384);
  let closed=false,closing:Promise<void>|undefined,count=0,edgeCount=0;
  const check=()=>{if(closed)throw new OfficeError('invalid-handle','Object extraction is closed.','index');if(signal.aborted)throw new OfficeError('cancelled','Operation cancelled.','index');};
  const failure=(error:unknown)=>error instanceof OfficeError?error:new OfficeError(signal.aborted?'cancelled':'io-failure','Object extraction storage operation failed.','index');
  const close=()=>{closed=true;return closing??=(async()=>{const results=await Promise.allSettled([graph.close(),pages.close()]);for(const result of results)if(result.status==='rejected')throw result.reason;})();};
  const values=new RetainedValues(pages,check,signal),dependencies=new RetainedOrder(pages,values,check),files=new RetainedOrder(pages,values,check),members=new RetainedOrder(pages,values,check),edges=new RetainedOrder(pages,values,check);
  async function text(range:XmlRange) {let result='';const decoder=new TextDecoder();for await(const bytes of values.read(range))result+=decoder.decode(bytes,{stream:true});return result+decoder.decode();}
  try {
    try {for await(const part of graph.closure([selected])) if(part!==selected){const value=await values.store(literal(part));await dependencies.add(literal(part),value);await files.add(literal(part),value);}}
    catch(error){if(error instanceof OfficeError&&error.code==='missing-binding')throw new OfficeError('missing-binding','Opaque object dependency is absent.','index');throw error;}
    await dependencies.seal();
    async function* parts(){yield selected;for await(const value of dependencies.entries())yield await text(value);}
    for await(const part of parts()) {
      for await(const edge of graph.outgoing(part)) {
        const value=await values.store(streamJson({id:edge.id,type:edge.type,target:edge.target,external:edge.external,owner:edge.owner,targetPart:edge.targetPart}));
        await edges.add(literal(String(edgeCount++).padStart(16,'0')),value);
      }
      const slash=part.lastIndexOf('/'),relationships=`${part.slice(0,slash+1)}_rels/${part.slice(slash+1)}.rels`;
      if(await archive.has(relationships)){const value=await values.store(literal(relationships));await files.add(literal(relationships),value);}
    }
    await files.seal();await edges.seal();
    async function* all(){yield selected;for await(const value of files.entries())yield await text(value);}
    for await(const part of all()) {
      check();const record={part,name:`opaque-${await digest(literal(part))}.bin`,size:await archive.byteLength(part),sha256:await digest(archive.read(part))};
      const value=await values.store(literal(JSON.stringify(record)));await members.add(literal(String(count++).padStart(16,'0')),value);
    }
    await members.seal();await graph.close();check();
    return Object.freeze({close,count,async *members():AsyncGenerator<RetainedExtractedObjectMember>{
      try {check();for await(const value of members.entries()){
        // Only ZIP-bounded names, fixed digests and numeric descriptors are decoded.
        const metadata=JSON.parse(await text(value)) as Omit<RetainedExtractedObjectMember,'bytes'>;
        yield Object.freeze({...metadata,async *bytes(){try{check();yield* archive.read(metadata.part);check();}catch(error){throw failure(error);}}});
      }check();}catch(error){throw failure(error);}
    },async *relationships(){try{check();for await(const value of edges.entries())yield {[rawJson]:()=>values.read(value)};check();}catch(error){throw failure(error);}}});
  }catch(error){await close().catch(()=>{});throw failure(error);}
}
