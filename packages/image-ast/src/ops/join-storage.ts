import type {SharpInputOptions} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {JoinLayout} from "./join-layout.js";

/** Join retained rasters without staging rows or a canvas in memory. */
export async function joinStoredImages(images:readonly StoredRgbaImage[],storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage>{
 signal.throwIfAborted();const layout=new JoinLayout(images,options),{width,height}=layout.metadata,length=width*height*4;
 if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(length))throw new RangeError("Invalid joined image dimensions");
 const position=storage.allocate(length);
 if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length))throw new RangeError("Invalid joined image storage");
 const background=new Uint8Array(4096);new Uint32Array(background.buffer).fill(layout.background);
 for(let at=0;at<length;at+=4096){signal.throwIfAborted();if(at%65536===0)await defaultRuntime.yieldTurn(signal);await storage.write(position+at,background.subarray(0,Math.min(4096,length-at)),{signal});signal.throwIfAborted();}
 let work=0;
 for(let index=0;index<images.length;index++){
  const image=images[index]!,{left,top}=layout.placement(index,image),rowBytes=image.width*4;
  for(let row=0;row<image.height;row++)for(let at=0;at<rowBytes;at+=4096){
   signal.throwIfAborted();const length=Math.min(4096,rowBytes-at),bytes=await storage.read(image.position+row*rowBytes+at,length,{signal});signal.throwIfAborted();
   if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated joined image storage");
   await storage.write(position+((top+row)*width+left)*4+at,new Uint8Array(bytes),{signal});signal.throwIfAborted();
   work+=length;if(work>=65536){await defaultRuntime.yieldTurn(signal);work=0;}
  }
 }
 return {...layout.metadata,position};
}
