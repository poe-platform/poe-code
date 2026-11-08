import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {PdfFileSource} from "../source.js";
import {encodeJpeg} from "../render/raster.js";
import {decodeJpegToRgba} from "./images.js";
import {PdfRetainedJpeg} from "./retained-jpeg.js";

it.each(['jpeg-L-0-0-17','jpeg-L-1-0-17','jpeg-RGB-0-0-17','jpeg-RGB-1-0-17','jpeg-CMYK-0-0-17','jpeg-CMYK-1-0-17','jpeg-rgb-direct'])('keeps native %s pixels with caller-backed coefficients',async name=>{
 const bytes=new Uint8Array(readFileSync(new URL('../fixtures/'+name+'.jpg',import.meta.url))),expected=decodeJpegToRgba(bytes),fs=createMemoryFileSystem();await fs.mkdir('/scratch');await fs.writeFile('/input',bytes);
 const source=await PdfFileSource.open(fs,'/input',{chunkBytes:64}),storage=new PagedStorage({fs,cwd:'/scratch',env:{},signal:new AbortController().signal},2);
 try{const image=await PdfRetainedJpeg.open(source,{coefficientStorage:storage}),actual=[];await source.close();for await(const row of image.rows())actual.push(...row);expect(actual).toEqual([...expected.data]);image.close();}finally{await source.close();await storage.close();expect(await fs.readdir('/scratch')).toEqual([]);}
});
it.each([64,256])('uses fixed decoder scratch as JPEG height grows to %i',async height=>{
 const width=257,data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=(i*31)%256;
 const bytes=encodeJpeg({width,height,data}),expected=decodeJpegToRgba(bytes),fs=createMemoryFileSystem();await fs.mkdir('/scratch');await fs.writeFile('/input',bytes);
 const source=await PdfFileSource.open(fs,'/input',{chunkBytes:512}),storage=new PagedStorage({fs,cwd:'/scratch',env:{},signal:new AbortController().signal},2);
 try{let peak=0;const image=await PdfRetainedJpeg.open(source,{coefficientStorage:storage,onDecoderAllocation(size){peak=Math.max(peak,size);if(size>4096)throw Error('resident coefficient plane');}});let y=0;for await(const row of image.rows()){expect(row).toEqual(expected.data.slice(y*width*4,++y*width*4));}expect(y).toBe(height);expect(peak).toBeLessThanOrEqual(4096);image.close();}finally{await storage.close();await source.close();expect(await fs.readdir('/scratch')).toEqual([]);}
});

it.each(['read','write','cancel'])('preserves caller coefficient %s failures',async mode=>{
 const bytes=new Uint8Array(readFileSync(new URL('../fixtures/jpeg-RGB-1-0-17.jpg',import.meta.url))),fs=createMemoryFileSystem();await fs.writeFile('/input',bytes);const source=await PdfFileSource.open(fs,'/input'),failure=new Error('coefficient failure'),controller=new AbortController();
 const storage={allocate(){return 0;},async read(){if(mode==='cancel')controller.abort(failure);else throw failure;return new Uint8Array(128);},async write(){if(mode==='write')throw failure;}};
 try{await expect(PdfRetainedJpeg.open(source,{coefficientStorage:storage,signal:controller.signal})).rejects.toBe(failure);}finally{await source.close();}
});

it('stops a suspended row when its decoder closes',async()=>{
 const bytes=new Uint8Array(readFileSync(new URL('../fixtures/jpeg-RGB-1-0-17.jpg',import.meta.url))),fs=createMemoryFileSystem();await fs.mkdir('/scratch');await fs.writeFile('/input',bytes);const source=await PdfFileSource.open(fs,'/input'),storage=new PagedStorage({fs,cwd:'/scratch',env:{},signal:new AbortController().signal},2);
 let pause=false,resume!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
 const backing={allocate:storage.allocate.bind(storage),write:storage.write.bind(storage),async read(...args:Parameters<typeof storage.read>){if(pause){pause=false;started();await new Promise<void>(resolve=>{resume=resolve;});}return storage.read(...args);}};
 try{const image=await PdfRetainedJpeg.open(source,{coefficientStorage:backing});pause=true;const result=image.rows().next();await waiting;image.close();resume();await expect(result).rejects.toThrow('closed');}finally{await storage.close();await source.close();}
});
