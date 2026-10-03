import type {ImageAstNode,RgbaImage,SharpInputOptions} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {booleanImage,joinChannelImage} from "./transform.js";
import {Pixels} from "./storage-raster.js";
export interface StoredImageResources {
 /** Return pixels in the operation's caller-owned backing storage. */
 readImage(input:Uint8Array|string|undefined,options:SharpInputOptions|undefined,signal:AbortSignal):Promise<StoredRgbaImage>;
}
export async function transformStoredChannels(image:StoredRgbaImage,storage:ImageByteStorage,operation:Extract<ImageAstNode,{kind:"boolean"|"joinChannel"}>,signal:AbortSignal,resources:StoredImageResources):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const validate=(extra:StoredRgbaImage):void=>{if(!Number.isSafeInteger(extra.width) || extra.width<=0 || !Number.isSafeInteger(extra.height) || extra.height<=0 || !Number.isSafeInteger(extra.width*extra.height*4) || !Number.isSafeInteger(extra.position) || extra.position<0 || !Number.isSafeInteger(extra.position+extra.width*extra.height*4)) throw new RangeError("Invalid stored resource dimensions");};
 validate(image);
 const extras:StoredRgbaImage[]=[];
 if(operation.kind==="boolean") {const extra=await resources.readImage(operation.operand,operation.options,signal);signal.throwIfAborted();validate(extra);extras.push(extra);}
 else for(const input of operation.inputs) {
  const extra=await resources.readImage(input.data,input.options,signal);signal.throwIfAborted();validate(extra);
  // All resources are decoded/validated, including channels the legacy join ignores.
  if(extras.length<3) extras.push(extra);
 }
 signal.throwIfAborted();
 if(operation.kind==="joinChannel" && !extras.length) return image;
 const apply=(base:RgbaImage,inputs:RgbaImage[])=>operation.kind==="boolean"?booleanImage(base,inputs[0]!,operation.op):joinChannelImage(base,inputs);
 const {data:ignoredData,...metadata}=apply({...image,width:0,height:0,data:new Uint8Array()},extras.map(extra=>({...extra,width:0,height:0,data:new Uint8Array()})));
 const length=image.width*image.height*4,position=storage.allocate(length);
 if(!Number.isSafeInteger(position) || position<0 || !Number.isSafeInteger(position+length)) throw new RangeError("Invalid image backing allocation");
 const operand=operation.kind==="boolean"?new Pixels(extras[0]!,storage,signal):undefined;
 const read=async(source:StoredRgbaImage,offset:number,size:number):Promise<Uint8Array>=>{
  signal.throwIfAborted();
  if(!size) return new Uint8Array();
  const bytes=await storage.read(source.position+offset,size,{signal});signal.throwIfAborted();
  if(!(bytes instanceof Uint8Array) || bytes.length!==size) throw new Error("Truncated image backing storage");
  return new Uint8Array(bytes);
 };
 for(let offset=0;offset<length;offset+=4096) {
  signal.throwIfAborted();if(offset%(4096*16)===0) await defaultRuntime.yieldTurn(signal);
  const size=Math.min(4096,length-offset),base={...image,width:size/4,height:1,data:await read(image,offset,size)},inputs:RgbaImage[]=[];
  for(const extra of extras) {
   let data:Uint8Array;
   if(operand) {
    data=new Uint8Array(size);
    for(let i=0;i<size/4;i++) {
     const source=offset/4+i,x=source%image.width,y=Math.floor(source/image.width);
     const pixel=await operand.pixel(Math.min(extra.height-1,y)*extra.width+Math.min(extra.width-1,x));
     data[i*4]=pixel&255;data[i*4+1]=pixel>>>8&255;data[i*4+2]=pixel>>>16&255;data[i*4+3]=pixel>>>24;
    }
   } else data=await read(extra,offset,Math.min(size,Math.max(0,extra.width*extra.height*4-offset)));
   inputs.push({...extra,width:data.length/4,height:1,data});
  }
  const result=apply(base,inputs);
  await storage.write(position+offset,result.data,{signal});signal.throwIfAborted();
 }
 return {...metadata,width:image.width,height:image.height,position};
}
