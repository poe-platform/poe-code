import {createByteCodec,defaultRuntime} from "@poe-code/compression";
import type {ImageByteStorage,StoredRgbaImage} from "./png-storage.js";

/** One image page, with streamed Flate RGB and soft-mask objects. Only the fixed
 * eight-object cross-reference table is retained; pixel bytes stay caller-owned. */
export async function* encodePdfFromStorage(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal):AsyncGenerator<Uint8Array>{
 signal.throwIfAborted();
 const {width,height,position}=image,count=width*height,gray=image.space==="b-w"||image.channels===1||image.channels===2;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(count*4)||!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+count*4))throw new RangeError("Invalid PDF backing dimensions");
 const encoder=new TextEncoder(),offsets:number[]=[0];let offset=0;
 const text=(value:string)=>{const bytes=encoder.encode(value);offset+=bytes.length;return bytes;};
 const object=(number:number,value:string)=>{offsets[number]=offset;return text(`${number} 0 obj\n${value}\nendobj\n`);};
 yield text("%PDF-1.4\n");
 yield object(1,"<< /Type /Catalog /Pages 2 0 R >>");
 yield object(2,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
 yield object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
 const content=`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
 yield object(4,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
 for(const alpha of [false,true]){
  signal.throwIfAborted();
  const number=alpha?7:5;offsets[number]=offset;
  yield text(`${number} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${alpha?"DeviceGray":"DeviceRGB"} /BitsPerComponent 8 /Filter /FlateDecode /Length ${number+1} 0 R${alpha?"":" /SMask 7 0 R"} >>\nstream\n`);
  const start=offset,codec=createByteCodec({direction:"encode",format:"zlib",chunkSize:4096,level:6});
  try{
   for(let index=0;index<count;index+=1024){
    signal.throwIfAborted();if(index%65536===0)await defaultRuntime.yieldTurn(signal);
    const pixels=Math.min(1024,count-index),input=await storage.read(position+index*4,pixels*4,{signal});signal.throwIfAborted();
    if(input.length!==pixels*4)throw new Error("Truncated PDF image backing");
    const raw=new Uint8Array(pixels*(alpha?1:3));
    for(let pixel=0;pixel<pixels;pixel++)if(alpha)raw[pixel]=input[pixel*4+3]!;else for(let channel=0;channel<3;channel++)raw[pixel*3+channel]=input[pixel*4+(gray?0:channel)]!;
    for(const bytes of codec.push(raw)){signal.throwIfAborted();offset+=bytes.length;yield new Uint8Array(bytes);}
   }
   for(const bytes of codec.push(new Uint8Array(),true)){signal.throwIfAborted();offset+=bytes.length;yield new Uint8Array(bytes);}
  }finally{codec.close();}
  const length=offset-start;yield text("\nendstream\nendobj\n");yield object(number+1,String(length));
 }
 signal.throwIfAborted();const xref=offset;
 yield text(`xref\n0 9\n0000000000 65535 f \n${offsets.slice(1).map(value=>`${String(value).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
