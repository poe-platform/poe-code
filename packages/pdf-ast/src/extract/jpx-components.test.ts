import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfFileSource} from "../source.js";
import {PdfRetainedJpx} from "./retained-jpx.js";
import {JpxImage} from "../vendor/pdfjs-image-decoders.mjs";

function image(components:number,order:number){
 const siz=new Uint8Array(40+components*3),sv=new DataView(siz.buffer);siz.set([255,81]);sv.setUint16(2,siz.length-2);
 for(const at of [6,10,22,26])sv.setUint32(at,1);sv.setUint16(38,components);
 for(let i=0;i<components;i++)siz.set([7,1,1],40+i*3);
 const cod=new Uint8Array([255,82,0,12,0,order,0,1,0,0,0,0,0,1]);
 const qcd=new Uint8Array([255,92,0,4,64,64]),tile=new Uint8Array(14+components);tile.set([255,144,0,10]);new DataView(tile.buffer).setUint32(6,tile.length);tile[11]=1;tile.set([255,147],12);
 const bytes=new Uint8Array(2+siz.length+cod.length+qcd.length+tile.length+2);let at=0;for(const part of [new Uint8Array([255,79]),siz,cod,qcd,tile,new Uint8Array([255,217])]){bytes.set(part,at);at+=part.length;}return bytes;
}

it.each([64,256].flatMap(components=>[0,4].map(order=>({components,order}))))("backs $components JPEG 2000 components in progression order $order",async ({components,order})=>{
 const bytes=image(components,order),native=new JpxImage();native.parse(bytes);
 expect(native.tiles[0]!.items).toEqual(new Uint8ClampedArray(components).fill(128));
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);
 const source=await PdfFileSource.open(fs,"/input"),storage=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},2);
 try{const decoded=await PdfRetainedJpx.open(source,{coefficientStorage:storage,maxWorkingBytes:131072,color:{colorSpace:"gray",components}});
  try{const rows=[];for await(const row of decoded.rows())rows.push([...row]);expect(rows).toEqual([[128,128,128,255]]);}finally{decoded.close();}
 }finally{await source.close();await storage.close();expect(await fs.readdir("/scratch")).toEqual([]);}
});
