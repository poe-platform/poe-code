import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, resolveOfficeResources } from "@poe-code/office-xml";
import { yieldTurn } from "safe-bash-contracts/yield";
import { OfficeXml, SpanMap, type OfficeElement } from "./retained-office-xml.js";
import { RetainedSpans } from "./retained-spans.js";
import { retainXmlText } from "./retained-xml-text.js";
import { escapeHtmlText } from "./html.js";
import { docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

/** Slide ordering, paragraph spans and markup remain in the caller's backing. */
export async function retainPptxText(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext,
  output?: {readonly format: string; readonly title: string}): Promise<SofficeSnapshot> {
  const {signal} = context, encoder = new TextEncoder(), records = new IntegerTable(storage), heap = new IntegerTable(storage), names = new SpanMap(storage,signal);
  let count = 0;
  const literal = async (text: string) => {
    const position = storage.allocate(0); let size = 0;
    for (let at = 0; at < text.length;) {
      signal.throwIfAborted(); let end = Math.min(text.length, at + 4096);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
      const bytes = encoder.encode(text.slice(at,end)); await storage.append(bytes); size += bytes.length; at = end;
    }
    return {position,size};
  };
  async function* read(span: SofficeSnapshot) {
    for (let at = 0; at < span.size; at += 16384) { signal.throwIfAborted(); yield new Uint8Array(await storage.read(span.position+at,Math.min(16384,span.size-at))); }
  }
  const codec = createZipCodec(), limits = resolveOfficeResources({archiveLimits:{chunkSize:16384}}).archiveLimits;
  await codec.readZipArchive({size:source.size,read:(position,length)=>storage.read(source.position+position,Math.min(16384,length,source.size-position))},limits,signal,{storage,async onEntry(entry){
    const digits = entry.name.startsWith('ppt/slides/slide') && entry.name.endsWith('.xml') ? entry.name.slice(16,-4) : '';
    let selected = digits.length > 0; for (const char of digits) if (char < '0' || char > '9') { selected = false; break; }
    const position = storage.allocate(0); let size = 0;
    for await (const bytes of codec.decodeZipEntry(entry,limits,signal)) if (selected) {await storage.append(bytes);size+=bytes.length;}
    if (!selected) return;
    const name = await literal(entry.name), previous = await names.get(name), row = previous?.position ?? count++;
    if (!previous) {await names.set(name,{position:row,size:0}); await heap.set(BigInt(row),BigInt(row));}
    for (const [field,value] of [name.position,name.size,position,size].entries()) await records.set(BigInt(row*4+field),BigInt(value));
  }});
  const span = async (row: number, field: number): Promise<SofficeSnapshot> => ({position:Number(await records.get(BigInt(row*4+field))),size:Number(await records.get(BigInt(row*4+field+1)))});
  const key = async (row: number) => { let result=''; const decoder=new TextDecoder(); for await(const bytes of read(await span(row,0))) result+=decoder.decode(bytes,{stream:true}); return result+decoder.decode(); };
  const less = async (a: number,b: number) => { const order=(await key(a)).localeCompare(await key(b),undefined,{numeric:true}); return order<0 || order===0 && a<b; };
  const at = async (index: number) => Number(await heap.get(BigInt(index)));
  const sift = async (start: number,length: number) => {
    const value=await at(start); let parent=start;
    while(parent*2+1<length){let child=parent*2+1;if(child+1<length&&await less(await at(child+1),await at(child)))child++;
      if(!await less(await at(child),value))break;await heap.set(BigInt(parent),BigInt(await at(child)));parent=child;await yieldTurn(signal);}
    await heap.set(BigInt(parent),BigInt(value));
  };
  for(let index=Math.floor(count/2)-1;index>=0;index--)await sift(index,count);
  const result=new RetainedSpans(storage,signal), newline=await literal('\n'), slideGap=await literal('\n\n'), tab=await literal('\t');
  const markup=output?.format==='html'||output?.format==='docx', html=output?.format==='html';
  if(markup)await result.add(await literal(html?`<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(output!.title)}</title></head><body>\n`:docxDocumentPrefix));
  const add=async(value:SofficeSnapshot,heading:boolean)=>{
    if(!markup){await result.add(value);return;}
    await result.add(await literal(html?heading?'<h1>':'<p>':'<w:p>'+(heading?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':'')+'<w:r><w:t>'));
    const parts=new RetainedSpans(storage,signal),decoder=new TextDecoder('utf-8',{ignoreBOM:true});
    const escaped=(text:string)=>html?escapeHtmlText(text):text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    for await(const bytes of read(value))await parts.add(await literal(escaped(decoder.decode(bytes,{stream:true}))));
    await parts.add(await literal(escaped(decoder.decode())));await result.add(await parts.finish());
    await result.add(await literal(html?heading?'</h1>\n':'</p>\n':'</w:t></w:r></w:p>'));
  };
  for(let slide=0;slide<count;slide++){
    signal.throwIfAborted();const row=await at(0),remaining=count-slide-1;
    if(remaining){await heap.set(0n,BigInt(await at(remaining)));await sift(0,remaining);}
    const xml=await openRetainedXml(read(await span(row,2)),{signal,workingStorage:{fs:context.fs,directory:context.cwd}}),index=new OfficeXml(xml,storage,signal);let failed=true;
    try{
      await index.retain();let paragraphs=0;
      if(slide&&!markup)await result.add(slideGap);
      const text=async(element:OfficeElement)=>{
        const runs=new RetainedSpans(storage,signal);
        for await(const run of index.elements(element.open+1,element.end,['t']))await runs.add(await retainXmlText(storage,xml.read(run.body),signal,false));
        const joined=await runs.finish(),decoder=new TextDecoder('utf-8',{ignoreBOM:true});let first=-1,last=0,offset=0;
        const inspect=(text:string)=>{for(const char of text){const size=encoder.encode(char).length;if(char.trim()){if(first<0)first=offset;last=offset+size;}offset+=size;}};
        for await(const bytes of read(joined))inspect(decoder.decode(bytes,{stream:true}));inspect(decoder.decode());
        return {position:joined.position+Math.max(0,first),size:first<0?0:last-first};
      };
      const paragraph=async(value:SofficeSnapshot)=>{
        if(paragraphs&&!markup)await result.add(newline);await add(value,paragraphs===0);paragraphs++;
      };
      for await(const shape of index.elements(0,index.count,['sp']))for await(const para of index.elements(shape.open+1,shape.end,['p'])){const value=await text(para);if(value.size)await paragraph(value);}
      if(!paragraphs)await paragraph(await literal(`Slide ${slide+1}`));
      for await(const frame of index.elements(0,index.count,['graphicFrame'])){
        for await(const table of index.elements(frame.open+1,frame.end,['tbl'])){
          for await(const row of index.elements(table.open+1,table.end,['tr'])){
            const cells=new RetainedSpans(storage,signal);let cellCount=0;
            for await(const cell of index.elements(row.open+1,row.end,['tc'])){if(cellCount++)await cells.add(tab);await cells.add(await text(cell));}
            if(cellCount)await paragraph(await cells.finish());
          }break;
        }
      }
      if(output&&!markup&&paragraphs===1)await result.add(newline);
      failed=false;
    }finally{await xml.close().catch(error=>{if(!failed)throw error;});}
  }
  if(markup)await result.add(await literal(html?'</body></html>\n':docxDocumentSuffix));
  return result.finish();
}
