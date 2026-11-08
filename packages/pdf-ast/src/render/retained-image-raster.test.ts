import {expect,test} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfDocument} from "../document.js";
import {PdfRetainedDocument} from "../retained-document.js";
import {PdfFileSource} from "../source.js";
import {encodePng,renderDisplayListToBitmap,renderOperationStreamWindow} from "./raster.js";

test("retained raster stages image pixels and reduction levels in caller storage",async()=>{
 const data=Uint8Array.from({length:257*129*4},(_,i)=>i%4===3?(i*17)%256:(i*31)%256);
 const original=PdfDocument.create(),page=original.addPage([29,37]);
 const image=original.embedPng(encodePng({width:257,height:129,data}));
 page.drawImage(image,{x:1,y:2,width:25,height:31});
 const list=page.evaluateDisplayList(),expected=renderDisplayListToBitmap(list,{scale:1});
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",original.save());
 const source=await PdfFileSource.open(fs,"/input"),storage={fs,directory:"/scratch"};
 const document=await PdfRetainedDocument.open(source,storage),retained=(await document.pages().next()).value!;
 const signal=new AbortController().signal,pixels=new PagedStorage({fs,cwd:"/scratch",env:{},signal});let staged=0;
 const backing={allocate(length:number){staged+=length;return pixels.allocate(length);},read:pixels.read.bind(pixels),write:pixels.write.bind(pixels)};
 try {
  const operations=async function*(){for await(const event of retained.evaluateSteps(storage,{imageStorage:backing,onAllocation(bytes){if(bytes===data.length)throw Error("whole image allocation");}}))if(!event.captured)yield event.operation;};
  const actual=await renderOperationStreamWindow(list,operations,{x:0,y:0,width:29,height:37},{scale:1});
  expect(actual).toEqual(expected);expect(staged).toBeGreaterThan(data.length);
 }finally{await pixels.close();await document.close();await source.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

test("stored images preserve nested groups, luminosity masks and image clips",async()=>{
 const data=Uint8Array.from({length:24},(_,i)=>i*11),fs=createMemoryFileSystem();await fs.mkdir("/scratch");
 const signal=new AbortController().signal,storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal});
 const position=storage.allocate(data.length);await storage.write(position,data);
 const image={name:"test",width:3,height:2,bitsPerComponent:8,colorSpace:"DeviceRGB",matrix:[13,2,1,15,1,1] as const,decodedRgba:data};
 const base={pageIndex:0,width:19,height:21,rotation:0 as const,glyphs:[],paths:[],images:[],annotations:[]};
 function operations(stored:boolean):import("../ast.js").PdfPaintOperation[]{
  const value=stored?{...image,decodedRgba:undefined,storedRgba:{storage,position}}:image;
  const operation={kind:"image" as const,value};
  return [{kind:"group",value:{alpha:.7,isolated:false,operations:[operation],blendMode:"Multiply"}},
   {kind:"image",value:{...value,clipImages:[value],softMask:{subtype:"Luminosity",backdrop:{r:.2,g:.3,b:.1},operations:[operation]}}}];
 }
 try{
  for(const scale of [.5,1,2]){
   const expected=renderDisplayListToBitmap({...base,operations:operations(false)},{scale});
   const source=async function*(){yield* operations(true);};
   expect(await renderOperationStreamWindow(base,source,{x:0,y:0,width:expected.width,height:expected.height},{scale})).toEqual(expected);
  }
 }finally{await storage.close();}
 expect(await fs.readdir("/scratch")).toEqual([]);
});

test.each(["read","write"] as const)("preserves retained pixel %s failures despite source cleanup failure",async method=>{
 const failure=new Error(method),cleanup=new Error("cleanup");let next=1024;
 const storage={allocate(length:number){const position=next;next+=length;return position;},
  async read(_position:number,length:number){if(method==="read")throw failure;return new Uint8Array(length).fill(255);},
  async write(){throw failure;}};
 const value={name:"test",width:16,height:16,bitsPerComponent:8,colorSpace:"DeviceRGB",matrix:[1,0,0,1,0,0] as const,storedRgba:{storage,position:0}};
 const operations=async function*(){try{yield {kind:"image" as const,value};}finally{await Promise.reject(cleanup);}};
 await expect(renderOperationStreamWindow({width:1,height:1},operations,{x:0,y:0,width:1,height:1},{scale:1,transparent:true})).rejects.toBe(failure);
});
