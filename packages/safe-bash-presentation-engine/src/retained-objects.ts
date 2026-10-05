import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { OpaqueObjectKind } from './opaque-objects.js';
import { contentKinds, relationshipKinds } from './opaque-kinds.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { RetainedValues, literal, characters, equal, digest } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import { rawJson, stageRetainedOutput, streamJson } from './retained-output.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
type Archive = Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>;
/** Borrow the admitted archive; retain inventory, closure queues and arbitrary
 * strings in caller storage. Payloads are hashed incrementally, never parsed. */
export async function openRetainedObjects(archive: Archive, settings: RetainedPackageContext) {
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } }, signal = context.signal ?? new AbortController().signal;
  const graph = await openRetainedRelationshipGraph(archive, context);
  const pages = new PagedStorage({ fs: context.workingStorage.fs, cwd: context.workingStorage.directory, env: {}, signal }, (context.workingStorage.cacheBytes ?? 1024*1024)/16384);
  let types: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined, closed = false, closing: Promise<void> | undefined, head = 0, tail = 0, count = 0;
  const check = () => { if(closed) throw new OfficeError('invalid-handle','Opaque inventory is closed.','index'); if(signal.aborted) throw new OfficeError('cancelled','Operation cancelled.','index'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled':'io-failure','Opaque inventory storage operation failed.','index');
  const close = () => { closed=true; return closing ??= (async()=> { const results=await Promise.allSettled([types?.close(),graph.close(),pages.close()]); for(const result of results) if(result.status==='rejected') throw result.reason; })(); };
  const values = new RetainedValues(pages,check,signal), parts = new RetainedOrder(pages,values,check);
  async function text(range: XmlRange) { let result=''; const decoder=new TextDecoder(); for await(const bytes of values.read(range)) result+=decoder.decode(bytes,{stream:true}); return result+decoder.decode(); }
  async function write(pointer:number, row:number[]) { const bytes=new Uint8Array(row.length*8),view=new DataView(bytes.buffer); row.forEach((n,i)=>view.setFloat64(i*8,n,true)); await pages.write(pointer,bytes); }
  async function row(pointer:number,count:number) { check(); const bytes=await pages.read(pointer,count*8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); return Array.from({length:count},(_,i)=>view.getFloat64(i*8,true)); }
  async function* ordered(order:RetainedOrder) { for await(const value of order.entries()) yield ()=>values.read(value); }
  try {
    types=await openRetainedContentTypes(archive.read('/[Content_Types].xml'),context,{maxBytes:context.xmlLimits.maxBytes,maxEntries:context.relationshipLimits.maxParts});
    for await(const part of graph.parts()) { const name=await values.store(literal(part)); await parts.add(literal(part),name); await values.insert('present',name,name); }
    await parts.seal();
    for await(const name of parts.entries()) {
      check(); const part=await text(name), contentType=await values.store(await types.get(part));
      // The largest recognized MIME essence is fixed; parameters remain streamed.
      let essence='', overflow=false, pending=0;
      for await(const c of characters(values.read(contentType))) { if(c===';') break; if(c.trim()==='') { if(essence||overflow) pending++; continue; } if(pending) { if(essence.length+pending>128) overflow=true; else essence+=' '.repeat(pending); pending=0; } if(essence.length+c.length>128) overflow=true; else if(!overflow) essence+=c.toLowerCase(); }
      let kind:OpaqueObjectKind|undefined=!overflow?contentKinds[essence]:undefined;
      const header=new Uint8Array(8); let used=0;
      for await(const chunk of archive.read(part)) { check(); const n=Math.min(8-used,chunk.length); header.set(chunk.subarray(0,n),used); used+=n; if(used===8) break; }
      const activeReasons=[{bytes:[77,90],reason:'executable-header'},{bytes:[127,69,76,70],reason:'executable-header'},{bytes:[208,207,17,224,161,177,26,225],reason:'compound-container'}].filter(s=>used>=s.bytes.length&&s.bytes.every((b,i)=>header[i]===b)).map(s=>s.reason);
      if(!kind) for await(const edge of graph.incoming(part)) { for(const [type,value] of Object.entries(relationshipKinds)) if(await equal(edge.type(),literal(type))) {kind=value;break;} if(kind) break; }
      if(!kind) kind=essence.startsWith('font/')?'font':activeReasons.length?'active-payload':undefined;
      if(!kind) continue;
      if(['ole','package','control','web-extension','active-payload'].includes(kind)) activeReasons.push(`potentially-active-${kind}`);
      const owners=new RetainedOrder(pages,values,check), dependencies=new RetainedOrder(pages,values,check), missing=new RetainedOrder(pages,values,check), external=new RetainedOrder(pages,values,check);
      const namespace=`object${++count}`; let queueHead=0,queueTail=0,externalCount=0;
      async function enqueue(value:XmlRange) { if(!await values.insert(namespace+'seen',value,value)) return; const pointer=pages.allocate(24); await write(pointer,[0,value.start,value.length]); if(queueTail) await write(queueTail,[pointer]); else queueHead=pointer; queueTail=pointer; }
      await enqueue(name);
      for await(const edge of graph.incoming(part)) { const owner=await values.store(literal(edge.owner)); if(await values.insert(namespace+'owners',owner,owner)) await owners.add(values.read(owner),owner); }
      for(let pointer=queueHead;pointer;) {
        const current=await row(pointer,3),owner=await text({start:current[1]!,length:current[2]!});
        for await(const edge of graph.outgoing(owner)) {
          if(edge.external) {
            const value=await values.store(streamJson({id:edge.id,type:edge.type,target:edge.target,external:true,owner:edge.owner,targetPart:null}));
            await external.add(literal(String(externalCount++).padStart(16,'0')),value);
          } else if(edge.targetPart) {
            const present=await values.find('present',edge.targetPart);
            if(!present) { const target=await values.store(edge.targetPart()); if(await values.insert(namespace+'missing',target,target)) await missing.add(values.read(target),target); }
            else if(!await values.find(namespace+'seen',()=>values.read(present))) { await enqueue(present); await dependencies.add(values.read(present),present); }
          }
        }
        pointer=(await row(pointer,1))[0]!;
      }
      await owners.seal(); await dependencies.seal(); await missing.seal(); await external.seal();
      async function* edges() { for await(const value of external.entries()) yield {[rawJson]:()=>values.read(value)}; }
      const size=await archive.byteLength(part), hash=await digest(archive.read(part));
      const json=await values.store(streamJson({part,kind,contentType:()=>values.read(contentType),bytes:size,sha256:hash,activeContent:activeReasons.length>0,activeReasons,owners:ordered(owners),dependencies:ordered(dependencies),missing:ordered(missing),externalRelationships:edges()}));
      const metadata=await values.store(literal(JSON.stringify({part,kind,bytes:size,activeContent:activeReasons.length>0}))), pointer=pages.allocate(40);
      await write(pointer,[0,json.start,json.length,metadata.start,metadata.length]); if(tail) await write(tail,[pointer]); else head=pointer; tail=pointer;
    }
    await types.close(); types=undefined; await graph.close(); check();
    return Object.freeze({close,count, async *objects() { try { check(); for(let pointer=head;pointer;) { const item=await row(pointer,5); pointer=item[0]!; const value={start:item[1]!,length:item[2]!}; yield {[rawJson]:()=>values.read(value)}; } check(); } catch(error) {throw failure(error);} },
      async *summaries() { try { check(); for(let pointer=head;pointer;) {const item=await row(pointer,5);pointer=item[0]!;yield JSON.parse(await text({start:item[3]!,length:item[4]!})) as {part:string;kind:OpaqueObjectKind;bytes:number;activeContent:boolean};} check();} catch(error) {throw failure(error);} } });
  } catch(error) { await close().catch(()=>{}); throw failure(error); }
}
export async function stageRetainedObjects(archive:Archive, settings:RetainedPackageContext, output:{readonly json:boolean;readonly maxOutputBytes:number}) {
  const format={...output},reader=await openRetainedObjects(archive,settings); let staged:Awaited<ReturnType<typeof stageRetainedOutput>>|undefined;
  async function* render() { if(format.json) {yield* streamJson({version:1,operation:'objects.list',ok:true,affected:0,warnings:[],errors:[],locations:[],data:{objects:reader.objects(),activationPerformed:false,recursiveParsingPerformed:false}});yield* literal('\n');} else for await(const item of reader.summaries()) yield* literal(`${item.part} ${item.kind} ${item.bytes} bytes${item.activeContent?' active-content':''}\n`); }
  try {staged=await stageRetainedOutput(render(),settings,format.maxOutputBytes);await reader.close();return staged;} catch(error) {await Promise.allSettled([reader.close(),staged?.close()]);throw error;}
}
