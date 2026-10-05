import { PagedStorage } from '@poe-code/safe-fs/storage';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedObjects } from './retained-objects.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { relationships } from './opaque-kinds.js';
import { RetainedValues, literal, equal } from './retained-values.js';
import { rawJson, streamJson, stageRetainedOutput } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
type Archive=Pick<RetainedPackageArchive,'parts'|'has'|'read'|'byteLength'>;
/** Font declarations and variant strings remain caller-backed; opaque font bytes
 * are inventoried without installing, decoding or interpreting them. */
export async function openRetainedFonts(archive:Archive,settings:RetainedPackageContext){
  const context={...resourceContext(settings),workingStorage:{...settings.workingStorage}},signal=context.signal??new AbortController().signal;
  const inventory=await openRetainedObjects(archive,context);
  const pages=new PagedStorage({fs:context.workingStorage.fs,cwd:context.workingStorage.directory,env:{},signal},(context.workingStorage.cacheBytes??1024*1024)/16384);
  let graph:Awaited<ReturnType<typeof openRetainedRelationshipGraph>>|undefined,closed=false,closing:Promise<void>|undefined,head=0,tail=0;
  const check=()=>{if(closed)throw new OfficeError('invalid-handle','Font inventory is closed.','index');if(signal.aborted)throw new OfficeError('cancelled','Operation cancelled.','index');};
  const failure=(error:unknown)=>error instanceof OfficeError?error:new OfficeError(signal.aborted?'cancelled':'io-failure','Font inventory storage operation failed.','index');
  const close=()=>{closed=true;return closing??=(async()=>{const results=await Promise.allSettled([graph?.close(),inventory.close(),pages.close()]);for(const result of results)if(result.status==='rejected')throw result.reason;})();};
  const values=new RetainedValues(pages,check,signal);
  async function write(pointer:number,data:number[]){const bytes=new Uint8Array(data.length*8),view=new DataView(bytes.buffer);data.forEach((n,i)=>view.setFloat64(i*8,n,true));await pages.write(pointer,bytes);}
  try {
    graph=await openRetainedRelationshipGraph(archive,context);
    for await(const part of archive.parts()){const value=await values.store(literal(part));await values.insert('present',value,value);}
    for await(const main of graph.outgoing('/')) {
      if(main.external)continue;
      let recognized=false;for(const namespace of relationships)if(await equal(main.type(),literal(`${namespace}/officeDocument`)))recognized=true;if(!recognized)continue;
      const name=main.targetPart?await values.find('present',main.targetPart):undefined;
      if(!name)throw new OfficeError('missing-binding','Presentation part is absent.','index');
      let part='';const decoder=new TextDecoder();for await(const bytes of values.read(name))part+=decoder.decode(bytes,{stream:true});part+=decoder.decode();
      const doc=await openRetainedXmlDocument(archive.read(part),context);let failed=false;
      try {
        let native=false;for(const ns of ['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main'])if(await equal(doc.namespace(doc.root),literal(ns)))native=true;
        if(!native)continue;
        async function named(node:RetainedXmlNode,name:string){return node.kind==='element'&&await equal(doc.namespace(node),doc.namespace(doc.root))&&await equal(doc.raw(node.localName),literal(name));}
        async function attr(node:RetainedXmlNode|undefined,name:string){if(node)for await(const value of doc.attributes(node))if(await equal(doc.namespace(value),literal(''))&&await equal(doc.raw(value.localName),literal(name)))return ()=>doc.text(value);return null;}
        for await(const list of doc.children(doc.root))if(await named(list,'embeddedFontLst'))for await(const node of doc.children(list))if(await named(node,'embeddedFont')){
          let font:RetainedXmlNode|undefined;for await(const child of doc.children(node))if(await named(child,'font')){font=child;break;}
          async function* variants(){
            for await(const child of doc.children(node)){
              let variant:string|undefined;for(const name of ['regular','bold','italic','boldItalic'])if(await named(child,name))variant=name;if(!variant)continue;
              let id:RetainedXmlNode|undefined;
              for await(const attribute of doc.attributes(child)){
                if(!await equal(doc.raw(attribute.localName),literal('id')))continue;
                for(const namespace of relationships)if(await equal(doc.namespace(attribute),literal(namespace)))id=attribute;
                if(id)break;
              }
              const edge=id?await graph!.get(part,()=>doc.text(id!)):undefined;let fontEdge=false;
              if(edge&&!edge.external)for(const namespace of relationships)if(await equal(edge.type(),literal(`${namespace}/font`)))fontEdge=true;
              const target=fontEdge?edge!.targetPart:null;
              yield {variant,relationshipId:id?()=>doc.text(id!):null,part:target,missing:!target||!await values.find('present',target)};
            }
          }
          // The generator reads other stores; it never allocates into this value
          // store while the declaration is being appended.
          const value=await values.store(streamJson({part,typeface:await attr(font,'typeface'),charset:await attr(font,'charset'),pitchFamily:await attr(font,'pitchFamily'),variants:variants()})),pointer=pages.allocate(24);
          await write(pointer,[0,value.start,value.length]);if(tail)await write(tail,[pointer]);else head=pointer;tail=pointer;
        }
      }catch(error){failed=true;throw error;}finally{try{await doc.close();}catch(error){if(!failed)await Promise.reject(error);}}
    }
    await graph.close();graph=undefined;check();
    return Object.freeze({close,fonts:inventory.objects.bind(undefined,'font'),async *summaries(){for await(const item of inventory.summaries())if(item.kind==='font')yield item;},async *declarations(){
      try{check();for(let pointer=head;pointer;){const bytes=await pages.read(pointer,24),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);pointer=view.getFloat64(0,true);const value={start:view.getFloat64(8,true),length:view.getFloat64(16,true)};yield {[rawJson]:()=>values.read(value)};}check();}catch(error){throw failure(error);}
    }});
  }catch(error){await close().catch(()=>{});throw failure(error);}
}
export async function stageRetainedFonts(archive:Archive,settings:RetainedPackageContext,output:{readonly json:boolean;readonly maxOutputBytes:number}){
  const format={...output},reader=await openRetainedFonts(archive,settings);let staged:Awaited<ReturnType<typeof stageRetainedOutput>>|undefined;
  async function* render(){if(format.json){yield* streamJson({version:1,operation:'fonts.list',ok:true,affected:0,warnings:[],errors:[],locations:[],data:{declarations:reader.declarations(),fonts:reader.fonts(),installationPerformed:false}});yield* literal('\n');}else for await(const item of reader.summaries())yield* literal(`${item.part} ${item.bytes} bytes\n`);}
  try{staged=await stageRetainedOutput(render(),settings,format.maxOutputBytes);await reader.close();return staged;}catch(error){await Promise.allSettled([reader.close(),staged?.close()]);throw error;}
}
