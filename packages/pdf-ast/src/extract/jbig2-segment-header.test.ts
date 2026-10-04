import {expect,it} from "vitest";
import {Jbig2Image} from "../vendor/pdfjs-image-decoders.mjs";

function stream(count:number,extended:boolean,flags=0){
 const retention=extended?Math.ceil((count+1)/8):0,length=extended?14:11;
 const bytes=new Uint8Array(30+length+retention+4*count),view=new DataView(bytes.buffer);
 bytes[4]=48;bytes[6]=1;view.setUint32(7,19);view.setUint32(11,8);view.setUint32(15,1);
 view.setUint32(30,0xffffffff);bytes[34]=62;
 if(extended)view.setUint32(35,0xe0000000+count);else bytes[35]=(count<<5)|flags;
 bytes[(extended?39:36)+retention+4*count]=1;
 return bytes;
}

it.each([0,1,4,7,8,15,16,33])("reads extended reference-count headers with %i references",count=>{
 const bytes=stream(count,true);
 expect(new Jbig2Image().parseChunks([{data:bytes,start:0,end:bytes.length}])).toEqual(new Uint8ClampedArray([0]));
});
it.each([5,6,7,31])("keeps short-header retention bits %i separate from the count",flags=>{
 const bytes=stream(0,false,flags);
 expect(new Jbig2Image().parseChunks([{data:bytes,start:0,end:bytes.length}])).toEqual(new Uint8ClampedArray([0]));
});
it.each([5,6])("rejects reserved short reference count %i",count=>{
 const bytes=stream(count,false);
 expect(()=>new Jbig2Image().parseChunks([{data:bytes,start:0,end:bytes.length}])).toThrow("invalid referred-to flags");
});
