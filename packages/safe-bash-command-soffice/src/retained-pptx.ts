import { resolvePath } from "@poe-code/safe-fs/core";
import { RetainedPdf } from "./retained-pdf-storage.js";
import { RetainedSlide, renderRetainedSlide } from "./retained-slide.js";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, openRetainedXmlDocument, resolveOfficeResources } from "@poe-code/office-xml";
import { yieldTurn } from "safe-bash-contracts/yield";
import { OfficeXml, SpanMap, type OfficeElement } from "./retained-office-xml.js";
import { RetainedSpans } from "./retained-spans.js";
import { retainXmlText } from "./retained-xml-text.js";
import { escapeHtmlText } from "./html.js";
import { docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

/** Slide ordering, paragraph spans and markup remain in the caller's backing. */
export async function retainPptxText(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext,
  output?: {readonly format: string; readonly title: string; readonly filterOptions?: string | undefined}): Promise<SofficeSnapshot> {
  const {signal} = context, encoder = new TextEncoder(), records = new IntegerTable(storage), heap = new IntegerTable(storage), names = new SpanMap(storage,signal);
  const pdf = output?.format === "pdf" ? new RetainedPdf(storage, context) : undefined, resources = new SpanMap(storage, signal);
  let count = 0, declared = false;
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
    for await (const bytes of codec.decodeZipEntry(entry,limits,signal)) if (pdf || entry.name.endsWith(".xml") || entry.name.endsWith(".rels")) {await storage.append(bytes);size+=bytes.length;}
    await resources.set(await literal(entry.name), {position,size});
    if (!selected) return;
    const name = await literal(entry.name), previous = await names.get(name), row = previous?.position ?? count++;
    if (!previous) {await names.set(name,{position:row,size:0}); await heap.set(BigInt(row),BigInt(row));}
    for (const [field,value] of [name.position,name.size,position,size].entries()) await records.set(BigInt(row*4+field),BigInt(value));
  }});
  const resource = async (name: string) => resources.get(await literal(name));
  const open = async (source: SofficeSnapshot) => {
    if (declared) { const document = await openRetainedXmlDocument(read(source), {signal, workingStorage: {fs: context.fs, directory: context.cwd}}); await document.close(); }
    const xml = await openRetainedXml(read(source), {signal, workingStorage: {fs: context.fs, directory: context.cwd}}), index = new OfficeXml(xml, storage, signal);
    try {await index.retain(); return index;} catch (error) {await xml.close().catch(()=>{}); throw error;}
  };
  const numeric = async (index: OfficeXml, range: {start:number;length:number}, signed = false): Promise<number | undefined> => {
    let value=0,offset=0,negative=false;
    for await(const bytes of index.xml.read(range))for(const byte of bytes){if(signed&&offset===0&&byte===45)negative=true;else if(byte<48||byte>57)return undefined;else value=value*10+byte-48;offset++;}
    return offset>(negative?1:0)?negative?-value:value:undefined;
  };
  const pair = async (index: OfficeXml, first: number, end: number, tag: string, a: string, b: string, signed = false) => {
    for await(const element of index.elements(first,end,[tag],true,true)){
      const left=await index.attribute(element,a),right=await index.attribute(element,b);if(!left||!right)continue;
      const x=await numeric(index,left,signed),y=await numeric(index,right,signed);if(x!==undefined&&y!==undefined)return [x,y] as const;
    }
    return undefined;
  };
  let slideCx=12192000,slideCy=6858000;
  const retainValue = async (bytes: AsyncIterable<Uint8Array>) => {
    const position=storage.allocate(0);let size=0;
    for await(const chunk of bytes){await storage.append(chunk);size+=chunk.length;}
    return {position,size};
  };
  const attributeSpan = async (index: OfficeXml, element: OfficeElement, name: string) => {
    const range = await index.attribute(element, name);
    return range ? retainValue(index.xml.value(range, true)) : undefined;
  };
  const attributeText = async (index: OfficeXml, element: OfficeElement, name: string) => {
    const range = await index.attribute(element, name); if (!range) return undefined;
    let text = ''; const decoder = new TextDecoder();
    for await (const bytes of index.xml.value(range,true)) text += decoder.decode(bytes, {stream:true});
    return text + decoder.decode();
  };
  const manifest = await resource('ppt/presentation.xml');
  if (manifest) {
    const index = await open(manifest);
    try {
      const size = await pair(index,0,index.count,'sldSz','cx','cy');
      if (size) { slideCx=size[0]; slideCy=size[1]; }
      if (!Number.isFinite(slideCx) || !Number.isFinite(slideCy) || slideCx <= 0 || slideCy <= 0) throw new Error('Invalid PPTX slide size');
      for await (const list of index.elements(0,index.count,['sldIdLst'],true)) {
        declared = true; let nextRow = count; count = 0;
        const targets = new SpanMap(storage, signal), rels = await resource('ppt/_rels/presentation.xml.rels');
        if (rels) {
          const owner = await open(rels);
          try {
            for await (const rel of owner.elements(0,owner.count,['Relationship'],true,true)) {
              const id = await attributeSpan(owner,rel,'Id'), target = await attributeText(owner,rel,'Target');
              if (id && target && await attributeText(owner,rel,'TargetMode') !== 'External') await targets.set(id, await literal(resolvePath('/ppt',target).slice(1)));
            }
          } finally { await owner.xml.close(); }
        }
        for await (const slide of index.elements(list.open+1,list.end,['sldId'],true,true)) {
          let id: SofficeSnapshot | undefined;
          for (let token=slide.first+1;token<slide.open;token++) {
            const current=await index.token(token);
            if(current.kind !== 'attribute-name' || await index.name(current.range) !== 'id') continue;
            let namespaced=false;
            for await(const bytes of index.xml.read(current.range)) if(bytes.includes(58))namespaced=true;
            if(!namespaced)continue;
            const value=await index.token(token+1);
            id=await retainValue(index.xml.value(value.range,true));
          }
          const target = id ? await targets.get(id) : undefined, source = target ? await resources.get(target) : undefined;
          if (!target || !source) throw new Error('Missing referenced PPTX slide');
          const row = nextRow++;
          for (const [field,value] of [target.position,target.size,source.position,source.size].entries()) await records.set(BigInt(row*4+field),BigInt(value));
          await heap.set(BigInt(count++),BigInt(row));
        }
      }
    } finally { await index.xml.close(); }
    if (declared) { const document = await openRetainedXmlDocument(read(manifest), {signal, workingStorage: {fs: context.fs, directory: context.cwd}}); await document.close(); }
  }
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
  for(let index=declared?-1:Math.floor(count/2)-1;index>=0;index--)await sift(index,count);
  const result=new RetainedSpans(storage,signal), newline=await literal('\n'), slideGap=await literal('\n\n'), tab=await literal('\t');
  const markup=output?.format==='html'||output?.format==='docx', html=output?.format==='html';
  if(markup)await result.add(await literal(html?`<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(output!.title)}</title></head><body>\n`:docxDocumentPrefix));
  const add=async(value:SofficeSnapshot,heading:boolean)=>{
    if(pdf)return;
    if(!markup){await result.add(value);return;}
    await result.add(await literal(html?heading?'<h1>':'<p>':'<w:p>'+(heading?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':'')+'<w:r><w:t>'));
    const parts=new RetainedSpans(storage,signal),decoder=new TextDecoder('utf-8',{ignoreBOM:true});
    const escaped=(text:string)=>html?escapeHtmlText(text):text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    for await(const bytes of read(value))await parts.add(await literal(escaped(decoder.decode(bytes,{stream:true}))));
    await parts.add(await literal(escaped(decoder.decode())));await result.add(await parts.finish());
    await result.add(await literal(html?heading?'</h1>\n':'</p>\n':'</w:t></w:r></w:p>'));
  };
  for(let slide=0;slide<count;slide++){
    signal.throwIfAborted();const row=await at(declared?slide:0),remaining=count-slide-1;
    if(!declared&&remaining){await heap.set(0n,BigInt(await at(remaining)));await sift(0,remaining);}
    const index=await open(await span(row,2)),xml=index.xml;let failed=true;
    try{
      let paragraphs=0,shapeIndex=0; const presentation=pdf?new RetainedSlide(storage,signal):undefined;
      if(slide&&!markup&&!pdf)await result.add(slideGap);
      const text=async(element:OfficeElement)=>{
        const runs=new RetainedSpans(storage,signal);
        for await(const run of index.elements(element.open+1,element.end,['t']))await runs.add(await retainXmlText(storage,xml.read(run.body),signal,false));
        const joined=await runs.finish(),decoder=new TextDecoder('utf-8',{ignoreBOM:true});let first=-1,last=0,offset=0;
        const inspect=(text:string)=>{for(const char of text){const size=encoder.encode(char).length;if(char.trim()){if(first<0)first=offset;last=offset+size;}offset+=size;}};
        for await(const bytes of read(joined))inspect(decoder.decode(bytes,{stream:true}));inspect(decoder.decode());
        return {position:joined.position+Math.max(0,first),size:first<0?0:last-first};
      };
      const paragraph=async(value:SofficeSnapshot)=>{
        if(presentation)await presentation.paragraphs.add([value.position,value.size]);
        if(paragraphs&&!markup&&!pdf)await result.add(newline);await add(value,paragraphs===0);paragraphs++;
      };
      for await(const shape of index.elements(0,index.count,['sp'])){
        const first=paragraphs;let maxSize=1800;
        for await(const para of index.elements(shape.open+1,shape.end,['p'])){
          if(presentation)for(let token=para.first;token<para.end;token++){const current=await index.token(token);if(current.kind==='attribute-name'&&await index.name(current.range)==='sz'){const value=await index.token(token+1);if(value.kind==='attribute-value'){let quoted=false;for await(const bytes of xml.read({start:value.range.start-1,length:1}))quoted=bytes[0]===34;if(quoted){const size=await numeric(index,value.range);if(size!==undefined&&size>0)maxSize=size;}}}}
          const value=await text(para);if(value.size)await paragraph(value);
        }
        if(paragraphs>first){
          if(presentation&&shapeIndex>0){
            const off=await pair(index,shape.open+1,shape.end,'off','x','y',true),extent=await pair(index,shape.open+1,shape.end,'ext','cx','cy');
            if(off){const x=Math.max(24,Math.min(660,off[0]/slideCx*720)),width=Math.max(120,Math.min(720-x-24,(extent?.[0]??Math.round(slideCx*0.85))/slideCx*720)),size=Math.min(15,Math.max(10,Math.round(maxSize/100*0.65))),top=Math.max(28,Math.min(330,405-off[1]/slideCy*405-size));await presentation.boxes.add([first,paragraphs-first,x,top,width,size]);}
          }shapeIndex++;
        }
      }
      if(!paragraphs&&!pdf)await paragraph(await literal(`Slide ${slide+1}`));
      if(presentation){
        const relationships=new SpanMap(storage,signal),path=await key(row),slash=path.lastIndexOf('/'),rels=await resource(path.slice(0,slash+1)+'_rels/'+path.slice(slash+1)+'.rels');
        if(rels){const owner=await open(rels);try{for await(const element of owner.elements(0,owner.count,['Relationship'],true,true)){
          const id=await attributeSpan(owner,element,'Id'),target=await attributeText(owner,element,'Target');
          if(id&&target&&await attributeText(owner,element,'TargetMode')!=='External')await relationships.set(id,await literal(resolvePath('/'+path.slice(0,slash),target).slice(1)));
        }}finally{await owner.xml.close();}}
        for await(const pic of index.elements(0,index.count,['pic'])){
          let media:SofficeSnapshot|undefined;
          for await(const blip of index.elements(pic.open+1,pic.end,['blip'],true,true)){
            const embed=await attributeSpan(index,blip,'embed'),target=embed?await relationships.get(embed):undefined;
            if(target)media=await resources.get(target);
            break;
          }
          if(!media)throw new Error('Missing referenced PPTX image');
          const off=await pair(index,pic.open+1,pic.end,'off','x','y',true),extent=await pair(index,pic.open+1,pic.end,'ext','cx','cy');
          if(!off||!extent||![...off,...extent].every(Number.isFinite)||extent[0]<=0||extent[1]<=0)throw new Error('Invalid PPTX picture placement');
          const x=off[0]/12700,y=(slideCy-off[1]-extent[1])/12700,width=extent[0]/12700,height=extent[1]/12700;
          await presentation.images.add([media.position,media.size,x,y,width,height]);
        }
      }
      for await(const frame of index.elements(0,index.count,['graphicFrame'])){
        for await(const table of index.elements(frame.open+1,frame.end,['tbl'])){
          const first=presentation?.cells.snapshot().count??0;presentation?.cells.beginTable();
          for await(const row of index.elements(table.open+1,table.end,['tr'])){
            const cells=new RetainedSpans(storage,signal);let cellCount=0;
            for await(const cell of index.elements(row.open+1,row.end,['tc'])){if(cellCount++)await cells.add(tab);const value=await text(cell);await cells.add(value);await presentation?.cells.cell(value);}
            await presentation?.cells.endRow();
            if(cellCount)await paragraph(await cells.finish());
          }
          if(presentation){await presentation.cells.endTable();if(presentation.cells.snapshot().count>first){const off=await pair(index,frame.open+1,frame.end,'off','x','y',true),extent=await pair(index,frame.open+1,frame.end,'ext','cx','cy'),ox=off?.[0]??Math.round(slideCx*0.08),oy=off?.[1]??Math.round(slideCy*0.22),cx=extent?.[0]??Math.round(slideCx*0.84),x=Math.max(24,Math.min(640,ox/slideCx*720)),width=Math.max(180,Math.min(720-x-24,cx/slideCx*720)),top=Math.max(60,Math.min(325,405-oy/slideCy*405));await presentation.tables.add([first,x,top,width]);}}break;
        }
      }
      if(pdf&&presentation)await renderRetainedSlide(pdf,storage,presentation,signal,slideCy/12700);
      if(output&&!markup&&!pdf&&paragraphs===1)await result.add(newline);
      failed=false;
    }finally{await xml.close().catch(error=>{if(!failed)throw error;});}
  }
  if(markup)await result.add(await literal(html?'</body></html>\n':docxDocumentSuffix));
  if(pdf){const archive=await pdf.save({creator:"LibreOffice Impress (@poe-code/pdf-ast)",width:slideCx/12700,height:slideCy/12700,filterOptions:output?.filterOptions}),position=storage.allocate(archive.size);let written=0;for await(const bytes of archive.read()){await storage.write(position+written,bytes);written+=bytes.length;}return {position,size:archive.size};}
  return result.finish();
}
