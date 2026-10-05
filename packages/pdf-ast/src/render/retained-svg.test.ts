import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PdfDocument} from "../document.js";
import {PdfRetainedDocument} from "../retained-document.js";
import {PdfFileSource} from "../source.js";
import {cosArray,cosBool,cosDict,cosName,cosNumber,cosStream,dictSet} from "../ast.js";
import {renderDisplayListToSvg,renderRetainedPageToSvg} from "./raster.js";
for(const rotation of [0,90,180,270])for(const options of [{scale:0.7},{dpiX:90,dpiY:47,useCropBox:true},{scale:1,transparent:true,cropRect:{x:3,y:2,width:13,height:11}}])it(`streams full SVG rotation=${rotation} ${JSON.stringify(options)}`,async()=>{
 const doc=PdfDocument.create(),page=doc.addPage([37,29]);dictSet(page.pageDict,"MediaBox",cosArray([-5,-7,32,22].map(n=>cosNumber(n))));dictSet(page.pageDict,"CropBox",cosArray([0,0,28,18].map(n=>cosNumber(n))));dictSet(page.pageDict,"Rotate",cosNumber(rotation));page.setRawContentStream("q 0 0 25 20 re W n [0 4] 1 d 1 J 2 w 0 0 m 20 15 l S Q");page.drawText("<&",{x:1,y:9,size:8});
 const expected=renderDisplayListToSvg(page.evaluateDisplayList(),options),fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",doc.save());const source=await PdfFileSource.open(fs,"/input"),storage={fs,directory:"/scratch"},retained=await PdfRetainedDocument.open(source,storage);
 try{const p=(await retained.pages().next()).value!,chunks=[];for await(const chunk of renderRetainedPageToSvg(p,storage,{...options,chunkBytes:64})){expect(chunk.buffer.byteLength).toBeLessThanOrEqual(64);chunks.push(chunk);}expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(expected);}finally{await retained.close();await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);
});

const numbers = (values: readonly number[]) => cosArray(values.map(value => cosNumber(value)));

function maskedGroup(options: { isolated?: boolean; mask?: boolean; blend?: string; alpha?: number; backgroundAlpha?: number; matrix?: number[]; nested?: boolean } = {}) {
  const doc = PdfDocument.create(), page = doc.addPage([40, 40]);
  const mask = cosStream(new TextEncoder().encode("0.5 g 0 0 40 40 re f"), { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([0, 0, 40, 40]),
    Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) }),
  }) });
  const resources = cosDict({ ExtGState: cosDict({ B: cosDict({ BM: cosName(options.blend ?? "Screen") }) }) });
  const paint = new TextEncoder().encode("/B gs 1 0 0 rg 0 0 40 40 re f");
  const form = cosStream(options.nested ? new TextEncoder().encode("/Inner Do") : paint, { dict: cosDict({
    Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([10, 10, 30, 30]),
    Group: cosDict({ S: cosName("Transparency"), I: cosBool(options.isolated ?? false) }),
    ...(options.matrix ? { Matrix: numbers(options.matrix) } : {}), Resources: resources,
  }) });
  if (options.nested) {
    const inner = cosStream(paint, { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Form"), BBox: numbers([10, 10, 30, 30]),
      Group: cosDict({ S: cosName("Transparency"), I: cosBool(false) }), Resources: resources,
    }) });
    dictSet(form.dict, "Resources", cosDict({ XObject: cosDict({ Inner: doc.cos.allocateObject(inner) }) }));
  }
  dictSet(page.pageDict, "Resources", cosDict({
    XObject: cosDict({ G: doc.cos.allocateObject(form) }),
    ExtGState: cosDict({
      BG: cosDict({ ca: cosNumber(options.backgroundAlpha ?? 1) }),
      Outer: cosDict({ ca: cosNumber(options.alpha ?? 1),
        ...(options.mask === false ? {} : { SMask: cosDict({ S: cosName("Luminosity"), G: doc.cos.allocateObject(mask) }) }),
      }),
    }),
  }));
  page.setRawContentStream("/BG gs 0 0 1 rg 0 0 40 40 re f /Outer gs /G Do");
  return { doc, page };
}

for(const isolated of [true,false])for(const options of [{scale:1},{dpiX:144,dpiY:72,useCropBox:true,cropRect:{x:2,y:3,width:5,height:6}}])it(`streams groups and soft masks isolated=${isolated} ${JSON.stringify(options)}`,async()=>{const {doc,page}=maskedGroup({isolated,nested:true});page.setCropBox(10,10,30,30);page.setRotation(90);await checkSvg(doc,options);});
it("keeps shared mask IDs across multiple paints and captured groups",async()=>{const {doc,page}=maskedGroup({isolated:true});page.setRawContentStream("/Outer gs 1 0 0 rg 0 0 10 10 re f /G Do 10 10 20 20 re f");await checkSvg(doc,{scale:1});});
it("streams inline image data without collecting PNG/base64 output",async()=>{const doc=PdfDocument.create(),page=doc.addPage([20,20]);page.drawImage({width:2,height:2,data:Uint8Array.from([255,0,0,255,0,255,0,127,0,0,255,255,255,255,0,0])},{x:2,y:2,width:16,height:16});await checkSvg(doc,{scale:1});});
async function checkSvg(doc:PdfDocument,options:Parameters<typeof renderRetainedPageToSvg>[2]){const expected=renderDisplayListToSvg(doc.getPage(0).evaluateDisplayList(),options),fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",doc.save());const storage={fs,directory:"/scratch"},source=await PdfFileSource.open(fs,"/input"),retained=await PdfRetainedDocument.open(source,storage);try{const page=(await retained.pages().next()).value!,chunks=[];for await(const chunk of renderRetainedPageToSvg(page,storage,{...options,chunkBytes:64,tileSize:16}))chunks.push(chunk);expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(expected);}finally{await retained.close();await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);}
for(const count of [1024,4096])it(`streams ${count} generated paints with bounded owned chunks and backpressure`,async()=>{let pulls=0,closed=0;const operation={kind:"path" as const,value:{segments:[{kind:"rect" as const,x:1,y:1,width:2,height:2}],strokeWidth:1,fillColor:{r:1,g:0,b:0}}},page={async attributes(){return {mediaBox:[0,0,10,10],cropBox:[0,0,10,10],rotation:0};},async *evaluateSteps(){try{for(let i=0;i<count;i++){pulls++;yield {operation};}}finally{closed++;}}} as unknown as import('../retained-document.js').PdfRetainedPage,fs=createMemoryFileSystem();await fs.mkdir('/scratch');let bytes=0;for await(const chunk of renderRetainedPageToSvg(page,{fs,directory:'/scratch'},{chunkBytes:64})){expect(chunk.buffer.byteLength).toBeLessThanOrEqual(64);const before=pulls;await Promise.resolve();expect(pulls).toBe(before);bytes+=chunk.length;}expect(bytes).toBeGreaterThan(count*50);expect(pulls).toBe(count*2);expect(closed).toBe(2);expect(await fs.readdir('/scratch')).toEqual([]);});
it('enforces operation admission and timer cancellation during preflight',async()=>{let closed=0,pulls=0;const page={async attributes(){return {mediaBox:[0,0,10,10],cropBox:[0,0,10,10],rotation:0};},async *evaluateSteps(){try{for(let i=0;i<100000;i++){pulls++;yield {operation:{kind:'path',value:{segments:[],strokeWidth:1}}};}}finally{closed++;}}} as unknown as import('../retained-document.js').PdfRetainedPage,fs=createMemoryFileSystem();await fs.mkdir('/scratch');const storage={fs,directory:'/scratch'};await expect(renderRetainedPageToSvg(page,storage,{maxOperations:0}).next()).rejects.toMatchObject({code:'E_LIMIT'});expect(pulls).toBe(1);const controller=new AbortController(),reason=new Error('cancel preflight'),timer=setTimeout(()=>controller.abort(reason),0);try{await expect(renderRetainedPageToSvg(page,storage,{signal:controller.signal}).next()).rejects.toBe(reason);}finally{clearTimeout(timer);}expect(pulls).toBeLessThan(100000);expect(closed).toBe(2);expect(await fs.readdir('/scratch')).toEqual([]);});
it('enforces total output limits and cleans evaluation backing on consumer return',async()=>{const doc=PdfDocument.create();doc.addPage([20,20]).drawText('Cleanup',{x:1,y:5,size:5});const fs=createMemoryFileSystem();await fs.mkdir('/scratch');await fs.writeFile('/input',doc.save());const storage={fs,directory:'/scratch'},source=await PdfFileSource.open(fs,'/input'),document=await PdfRetainedDocument.open(source,storage);try{const page=(await document.pages().next()).value!,before=await fs.readdir('/scratch');let length=0;for await(const chunk of renderRetainedPageToSvg(page,storage,{chunkBytes:32}))length+=chunk.length;let bounded=0;for await(const chunk of renderRetainedPageToSvg(page,storage,{maxOutputBytes:length,chunkBytes:32}))bounded+=chunk.length;expect(bounded).toBe(length);await expect(async()=>{for await(const ignored of renderRetainedPageToSvg(page,storage,{maxOutputBytes:length-1,chunkBytes:32}))void ignored;}).rejects.toMatchObject({code:'E_LIMIT'});const stream=renderRetainedPageToSvg(page,storage,{chunkBytes:32});for(let i=0;i<15;i++)await stream.next();await stream.return();expect(await fs.readdir('/scratch')).toEqual(before);}finally{await document.close();await source.close();}expect(await fs.readdir('/scratch')).toEqual([]);});
