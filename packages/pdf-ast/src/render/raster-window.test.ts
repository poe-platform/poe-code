import {expect,test,vi} from "vitest";
import {PdfDocument} from "../document.js";
import type {PdfDisplayList,PdfEvaluatedImage,PdfPaintOperation} from "../ast.js";
import * as raster from "./raster.js";

function drain<T>(steps:Generator<void,T,void>):T{let next=steps.next();while(!next.done)next=steps.next();return next.value;}
function scene():PdfDisplayList{
 const doc=PdfDocument.create(),page=doc.addPage([53,41]);
 page.setRawContentStream(new TextEncoder().encode('0.1 0.3 0.8 rg 0 0 53 41 re f q 3 4 43 31 re W n 0.8 0.2 0.1 rg 1 3 m 47 7 l 18 37 l h f 0.3 0.9 0.1 RG 2.7 w 0 0 m 8 49 45 -4 52 40 c S Q'));
 const list=page.evaluateDisplayList(),path=list.paths[1]!;
 const image:PdfEvaluatedImage={name:'sample',width:3,height:2,colorSpace:'DeviceRGB',bitsPerComponent:8,matrix:[27,3,2,23,11,8],decodedRgba:Uint8Array.from([255,0,0,255,0,255,0,127,0,0,255,255,255,255,0,63,255,0,255,255,0,255,255,255])};
 const operations:PdfPaintOperation[]=[...list.operations!,{kind:'image',value:image},{kind:'group',value:{alpha:.65,isolated:false,operations:[{kind:'path',value:{...path,blendMode:'Multiply',fillAlpha:.7}}]}},{kind:'path',value:{...path,fillColor:{r:1,g:0,b:0},softMask:{subtype:'Luminosity',operations:[{kind:'path',value:{...path,fillColor:{r:.5,g:.5,b:.5}}}],backdrop:{r:.2,g:.3,b:.4}},clipImages:[image]}}];
 return {...list,operations};
}

for(const scale of [1,1.25,2.3])for(const transparent of [false,true])test(`raster windows match page pixels at ${scale}, transparent=${transparent}`,()=>{
 const list=scene(),options={scale,transparent,background:{r:.2,g:.1,b:.6}},full=raster.renderDisplayListToBitmap(list,options);
 for(const [x,y,width,height]of [[0,0,7,9],[5,3,11,13],[full.width-9,full.height-7,9,7]]){
  const window={x:x!,y:y!,width:width!,height:height!},tile=drain(raster.renderDisplayListWindowSteps(list,window,options));
  expect(tile).toMatchObject({width,height});
  for(let row=0;row<height!;row++)expect(tile.data.subarray(row*width!*4,(row+1)*width!*4)).toEqual(full.data.subarray(((y!+row)*full.width+x!)*4,((y!+row)*full.width+x!+width!)*4));
 }
});

test('a small window does not allocate a full page or full mask surface',()=>{
 const list=scene(),large={...list,width:1000000,height:1000000},native=Uint8Array,nativeBuffer=ArrayBuffer,nativeFloat=Float32Array;
 const bounded=(constructor:typeof Uint8Array|typeof Float32Array|typeof ArrayBuffer,bytesPerElement:number)=>new Proxy(constructor,{construct(target,args){const length=typeof args[0]==='number'?args[0]*bytesPerElement:args[0]?.byteLength??0;if(length>65536)throw Error('unbounded raster allocation '+length);return Reflect.construct(target,args);}});
 vi.stubGlobal('Uint8Array',bounded(native,1));vi.stubGlobal('ArrayBuffer',bounded(nativeBuffer,1));vi.stubGlobal('Float32Array',bounded(nativeFloat,4));
 try{const tile=drain(raster.renderDisplayListWindowSteps(large,{x:1,y:999970,width:8,height:8},{scale:1}));expect(tile.data.length).toBe(256);}finally{vi.unstubAllGlobals();}
});

for (const transparent of [false, true]) test(`streamed raster operations preserve composition, transparent=${transparent}`, async () => {
 const list = scene(), window = {x: 5, y: 3, width: 11, height: 13}, options = {scale: 1.25, transparent};
 const expected = drain(raster.renderDisplayListWindowSteps(list, window, options));
 let opened = 0, closed = 0;
 const operations = async function* () {
  opened++;
  try { for (const original of list.operations!) {
   const operation = structuredClone(original);
   yield operation;
   // The source can recycle borrowed resources when the consumer advances.
   if (operation.kind === "image") operation.value.decodedRgba?.fill(0);
  } } finally { closed++; }
 };
 expect(await raster.renderOperationStreamWindow(list, operations, window, options)).toEqual(expected);
 expect(opened).toBe(transparent ? 1 : 2);
 expect(closed).toBe(opened);
});

test("streamed raster preserves backend failure despite close failure", async () => {
 const failure = new Error("backend"), cleanup = new Error("cleanup");
 const source = () => ({[Symbol.asyncIterator]() {return {
  async next(): Promise<IteratorResult<PdfPaintOperation>> {throw failure;},
  async return(): Promise<IteratorResult<PdfPaintOperation>> {throw cleanup;}
 };}});
 await expect(raster.renderOperationStreamWindow(scene(), source, {x:0,y:0,width:2,height:2}, {transparent:true})).rejects.toBe(failure);
});

test("streamed raster cancels and closes the current operation source", async () => {
 const controller = new AbortController(), failure = new Error("cancelled"); let closed = 0;
 const source = async function* () {try {
  controller.abort(failure); yield scene().operations![0]!;
 } finally {closed++;}};
 await expect(raster.renderOperationStreamWindow(scene(), source, {x:0,y:0,width:2,height:2}, {signal:controller.signal})).rejects.toBe(failure);
 expect(closed).toBe(1);
});

test("streamed raster does not reuse masks across recycled operation resources", async () => {
 const list = scene(), original = structuredClone(list.operations!.find(op => op.kind === "path" && op.value.clipPaths)!);
 if (original.kind !== "path") throw Error("missing clipped path");
 const second = structuredClone(original);
 const clip = second.value.clipPaths![0]!;
 const segments = "segments" in clip ? clip.segments : clip;
 for (const segment of segments) if ("x" in segment) Object.assign(segment, {x:segment.x + 20});
 const expected = drain(raster.renderDisplayListWindowSteps({...list,operations:[original,second]}, {x:0,y:0,width:53,height:41}, {scale:1}));
 const source = async function* () {
  const borrowed = structuredClone(original); yield borrowed;
  const clip = borrowed.value.clipPaths![0]!;
  const segments = "segments" in clip ? clip.segments : clip;
  for (const segment of segments) if ("x" in segment) Object.assign(segment, {x:segment.x + 20});
  yield borrowed;
 };
 expect(await raster.renderOperationStreamWindow(list, source, {x:0,y:0,width:53,height:41}, {scale:1})).toEqual(expected);
});

test.each([false, true])("streamed raster observes asynchronous cancellation (transparent=%s)", async transparent => {
 const controller = new AbortController(), failure = new Error("cancelled later"); let closed = 0;
 const operation = scene().operations![0]!;
 const source = async function* () {try {while (true) yield operation;} finally {closed++;}};
 const timer = setTimeout(() => controller.abort(failure), 0);
 try {
  await expect(raster.renderOperationStreamWindow(scene(), source, {x:0,y:0,width:2,height:2}, {transparent,signal:controller.signal})).rejects.toBe(failure);
  expect(closed).toBe(1);
 } finally {clearTimeout(timer);}
});
