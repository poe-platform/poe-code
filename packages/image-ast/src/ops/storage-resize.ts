import {EntropyHistogram} from "./resize-crop.js";
import {defaultRuntime} from "@poe-code/compression";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {attentionCropSteps,resolveGravityOffset} from "./resize.js";
import {resizeScale,type ResizeSpec} from "./resize-math.js";
import {resampleStoredImage} from "./storage-resample.js";

/** Resize with caller-owned intermediate rasters and bounded scan/copy windows. */
export async function resizeStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,spec:ResizeSpec,signal:AbortSignal,postScale?: (image:StoredRgbaImage)=>Promise<StoredRgbaImage>):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  let work=0;
  const read=async(position:number,length:number):Promise<Uint8Array>=>{
    signal.throwIfAborted();
    if(++work%64===0) await defaultRuntime.yieldTurn(signal);
    const bytes=await storage.read(position,length,{signal});
    signal.throwIfAborted();
    if(!(bytes instanceof Uint8Array) || bytes.length!==length) throw new Error("Truncated image backing storage");
    return new Uint8Array(bytes);
  };
  const write=async(position:number,bytes:Uint8Array):Promise<void>=>{
    signal.throwIfAborted();
    await storage.write(position,bytes,{signal});
    signal.throwIfAborted();
  };
  const allocate=(length:number):number=>{
    if(!Number.isSafeInteger(length) || length<0) throw new RangeError("Invalid resized image dimensions");
    const position=storage.allocate(length);
    if(!Number.isSafeInteger(position) || position<0 || !Number.isSafeInteger(position+length)) throw new RangeError("Invalid image backing allocation");
    return position;
  };
  if(image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight) {
    let result:StoredRgbaImage|undefined;
    for(let page=0;page<image.pages;page++) {
      const single=await resizeStoredImage({...image,position:image.position+page*image.width*image.pageHeight*4,height:image.pageHeight,pages:1},storage,spec,signal,postScale);
      const length=single.width*single.height*4;
      result??={...single,position:allocate(length*image.pages),height:single.height*image.pages,pages:image.pages,pageHeight:single.height};
      for(let offset=0;offset<length;offset+=4096) await write(result.position+page*length+offset,await read(single.position+offset,Math.min(4096,length-offset)));
    }
    return result!;
  }
  if(spec.width===null && spec.height===null) return image;
  const scale=resizeScale(image.width,image.height,spec),{reqW,reqH}=scale;
  let scaled=await resampleStoredImage(image,storage,{width:scale.width,height:scale.height,kernel:spec.kernel,hscale:scale.hscale,vscale:scale.vscale},signal);
  if(postScale) {scaled=await postScale(scaled);signal.throwIfAborted();}
  let width=scaled.width,height=scaled.height,left=0,top=0,embed=false;
  if(reqW>0 && reqH>0 && spec.fit==="cover") {
    let targetW=reqW,targetH=reqH;
    if(spec.withoutEnlargement && (targetW>image.width || targetH>image.height)) {targetW=Math.min(targetW,image.width);targetH=Math.min(targetH,image.height);}
    if(spec.withoutReduction && (targetW<image.width || targetH<image.height)) {targetW=Math.max(targetW,image.width);targetH=Math.max(targetH,image.height);}
    width=Math.min(scaled.width,targetW);height=Math.min(scaled.height,targetH);
    if(width<scaled.width || height<scaled.height) {
      const position=typeof spec.position==="string"?spec.position.toLowerCase():spec.position;
      if(position==="attention" || position===17) {
        // Buffered attention deliberately treats its thumbnail as straight alpha.
        const thumb=await resampleStoredImage({...scaled,isPremultiplied:false},storage,{width:32,height:32,kernel:"lanczos3",hscale:32/scaled.width,vscale:32/scaled.height},signal);
        const steps=attentionCropSteps(await read(thumb.position,4096),scaled.width,scaled.height,width,height,image.hasAlpha);
        let next=steps.next();
        while(!next.done) {await defaultRuntime.yieldTurn(signal);next=steps.next();}
        ({x:left,y:top}=next.value);
      } else if(position==="entropy" || position===16) {
        const entropy=async(x:number,y:number,w:number,h:number):Promise<number>=>{
          const histogram=new EntropyHistogram(image.channels,image.hasAlpha);
          for(let row=y;row<y+h;row++) for(let column=x;column<x+w;column+=1024) {
            const bytes=await read(scaled.position+(row*scaled.width+column)*4,Math.min(1024,x+w-column)*4);
            for(let i=0;i<bytes.length;i+=4) {
              histogram.add(bytes[i]!,bytes[i+1]!,bytes[i+2]!,bytes[i+3]!);
            }
          }
          return histogram.entropy();
        };
        let w=scaled.width,h=scaled.height;
        const maxSlice=Math.max(1,Math.max(Math.ceil((w-width)/8),Math.ceil((h-height)/8)));
        while(w>width || h>height) {
          const sw=Math.min(w-width,maxSlice),sh=Math.min(h-height,maxSlice);
          if(sw>0) {const a=await entropy(left,top,sw,h),b=await entropy(left+w-sw,top,sw,h);w-=sw;if(a<b)left+=sw;}
          if(sh>0) {const a=await entropy(left,top,w,sh),b=await entropy(left,top+h-sh,w,sh);h-=sh;if(a<b)top+=sh;}
        }
      } else ({x:left,y:top}=resolveGravityOffset(scaled.width,scaled.height,width,height,spec.position,true));
    }
  } else if(reqW>0 && reqH>0 && spec.fit==="contain") {
    width=Math.max(scaled.width,reqW);height=Math.max(scaled.height,reqH);embed=width>scaled.width || height>scaled.height;
    ({x:left,y:top}=resolveGravityOffset(width,height,scaled.width,scaled.height,spec.position,false));
  }
  const contain=reqW>0 && reqH>0 && spec.fit==="contain";
  const hasAlpha=image.hasAlpha || contain && spec.background.a<255;
  const channels=contain && hasAlpha?(image.channels<3?2:4):image.channels;
  if(width===scaled.width && height===scaled.height) return {...image,position:scaled.position,width,height,hasAlpha,channels};
  const position=allocate(width*height*4),bg=spec.background;
  const factor=Math.fround(bg.a/255),color=[bg.r,bg.g,bg.b].map(value=>image.isPremultiplied?Math.trunc(Math.fround(value*factor)):value);color.push(bg.a);
  for(let y=0;y<height;y++) for(let x=0;x<width;x+=1024) {
    const count=Math.min(1024,width-x);
    if(!embed) await write(position+(y*width+x)*4,await read(scaled.position+((y+top)*scaled.width+x+left)*4,count*4));
    else {
      const bytes=new Uint8Array(count*4);
      for(let i=0;i<count;i++) bytes.set(color,i*4);
      if(y>=top && y<top+scaled.height) {
        const start=Math.max(x,left),end=Math.min(x+count,left+scaled.width);
        if(start<end) bytes.set(await read(scaled.position+((y-top)*scaled.width+start-left)*4,(end-start)*4),(start-x)*4);
      }
      await write(position+(y*width+x)*4,bytes);
    }
  }
  return {...image,position,width,height,hasAlpha,channels};
}
