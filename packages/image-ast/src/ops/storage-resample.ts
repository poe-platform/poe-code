import {Pixels,Output} from "./storage-raster.js";
import type {ResizeKernel} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {fmaDouble,buildVipsReduceTable,VIPS_BICUBIC_TABLE,nearestCoordinates} from "./resize-math.js";

export interface StoredResampleOptions {
  readonly width:number;
  readonly height:number;
  readonly kernel?:ResizeKernel;
  readonly hscale?:number;
  readonly vscale?:number;
}
function clamp(value:number):number {return Math.max(0,Math.min(255,value));}
async function alphaPass(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,undo:boolean):Promise<StoredRgbaImage> {
  const reader=new Pixels(image,storage,signal),output=new Output(image,image.width,image.height,storage,signal);
  for(let i=0;i<image.width*image.height;i++) {
    const pixel=await reader.pixel(i),a=pixel>>>24;
    const factor=Math.fround(undo?(a===0?0:255/a):a/255);
    await output.pixel(clamp(Math.trunc(Math.fround((pixel&255)*factor))),clamp(Math.trunc(Math.fround((pixel>>>8&255)*factor))),clamp(Math.trunc(Math.fround((pixel>>>16&255)*factor))),a);
  }
  return output.finish();
}
async function box(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,shrink:number,vertical:boolean):Promise<StoredRgbaImage> {
  const width=vertical?image.width:Math.ceil(image.width/shrink),height=vertical?Math.ceil(image.height/shrink):image.height;
  const reader=new Pixels(image,storage,signal),output=new Output(image,width,height,storage,signal),round=shrink>>1;
  if(vertical) {
    let work=0;
    for(let y=0;y<height;y++) for(let x=0;x<width;x+=1024) {
      const count=Math.min(1024,width-x),sums=new Float64Array(count*4);
      for(let k=0;k<shrink;k++) {
        if(++work%16===0) await defaultRuntime.yieldTurn(signal);
        const bytes=await reader.read((Math.min(image.height-1,y*shrink+k)*width+x)*4,count*4);
        for(let i=0;i<bytes.length;i++) sums[i]!+=bytes[i]!;
      }
      for(let i=0;i<count*4;i+=4) await output.pixel(Math.floor((sums[i]!+round)/shrink),Math.floor((sums[i+1]!+round)/shrink),Math.floor((sums[i+2]!+round)/shrink),Math.floor((sums[i+3]!+round)/shrink));
    }
  } else for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sums=[0,0,0,0];
    for(let k=0;k<shrink;k++) {
      const pixel=await reader.pixel(y*image.width+Math.min(image.width-1,x*shrink+k));
      for(let c=0;c<4;c++) sums[c]!+=(pixel>>>(8*c)&255);
    }
    await output.pixel(Math.floor((sums[0]!+round)/shrink),Math.floor((sums[1]!+round)/shrink),Math.floor((sums[2]!+round)/shrink),Math.floor((sums[3]!+round)/shrink));
  }
  return output.finish();
}
async function reduce(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,shrink:number,extra:number,target:number,kernel:ResizeKernel,vertical:boolean):Promise<StoredRgbaImage> {
  const {nPoint,table}=buildVipsReduceTable(shrink,kernel),pad=Math.ceil(nPoint*0.5)-1;
  const first=fmaDouble(0.5,shrink,-0.5)-((extra+1)*0.5-1);
  const width=vertical?image.width:target,height=vertical?target:image.height;
  const reader=new Pixels(image,storage,signal),output=new Output(image,width,height,storage,signal);
  let rowPosition=first;
  for(let y=0;y<height;y++) {
    let columnPosition=first;
    for(let x=0;x<width;x++) {
      const coordinate=vertical?rowPosition:columnPosition,integer=Math.trunc(coordinate),phase=((Math.trunc(coordinate*128)&127)+1)>>1;
      const sums=[0,0,0,0];
      for(let j=0;j<nPoint;j++) {
        const position=Math.max(0,Math.min((vertical?image.height:image.width)-1,integer+j-pad));
        const pixel=await reader.pixel(vertical?position*image.width+x:y*image.width+position),weight=table[phase*nPoint+j]!;
        for(let c=0;c<4;c++) sums[c]!+=(pixel>>>(8*c)&255)*weight;
      }
      await output.pixel(clamp((sums[0]!+2048)>>12),clamp((sums[1]!+2048)>>12),clamp((sums[2]!+2048)>>12),clamp((sums[3]!+2048)>>12));
      columnPosition+=shrink;
    }
    rowPosition+=shrink;
  }
  return output.finish();
}
async function enlarge(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal,width:number,height:number,hscale:number,vscale:number,linear:boolean):Promise<StoredRgbaImage> {
  const inverse=1/(hscale*vscale),ia=vscale*inverse,id=hscale*inverse;
  const reader=new Pixels(image,storage,signal),output=new Output(image,width,height,storage,signal);
  for(let y=0;y<height;y++) {
    const dy=y*id+(linear?0.5:1.5),iy=Math.trunc(dy);
    let dx=linear?0.5:1.5;
    for(let x=0;x<width;x++) {
      const ix=Math.trunc(dx),sums=[0,0,0,0];
      if(linear) {
        const sy=Math.trunc((dy-iy)*4096),sx=Math.trunc((dx-ix)*4096),c3=sy*sx>>12,c1=(4096-sy)*sx>>12;
        const weights=[4096-sy-c1,c1,sy-c3,c3];
        for(let j=0;j<4;j++) {
          const px=Math.max(0,Math.min(image.width-1,ix-1+j%2)),py=Math.max(0,Math.min(image.height-1,iy-1+Math.floor(j/2)));
          const pixel=await reader.pixel(py*image.width+px);
          for(let c=0;c<4;c++) sums[c]!+=(pixel>>>(8*c)&255)*weights[j]!;
        }
      } else {
        const tx=((Math.trunc(dx*128)&127)+1)>>1,ty=((Math.trunc(dy*128)&127)+1)>>1;
        for(let row=0;row<4;row++) {
          const rowSums=[0,0,0,0],py=Math.max(0,Math.min(image.height-1,iy-3+row));
          for(let column=0;column<4;column++) {
            const px=Math.max(0,Math.min(image.width-1,ix-3+column)),pixel=await reader.pixel(py*image.width+px),weight=VIPS_BICUBIC_TABLE[tx*4+column]!;
            for(let c=0;c<4;c++) rowSums[c]!+=(pixel>>>(8*c)&255)*weight;
          }
          for(let c=0;c<4;c++) sums[c]!+=((rowSums[c]!+2048)>>12)*VIPS_BICUBIC_TABLE[ty*4+row]!;
        }
      }
      await output.pixel(clamp((sums[0]!+2048)>>12),clamp((sums[1]!+2048)>>12),clamp((sums[2]!+2048)>>12),clamp((sums[3]!+2048)>>12));
      dx+=ia;
    }
  }
  return output.finish();
}

/** Preserve bitmap resampling arithmetic with bounded caches and caller-owned intermediates. */
export async function resampleStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,options:StoredResampleOptions,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const {width,height}=options,kernel=options.kernel??"lanczos3";
  const hscale=options.hscale??1/(image.width/width),vscale=options.vscale??1/(image.height/height);
  if(!Number.isSafeInteger(image.position) || image.position<0 || !Number.isSafeInteger(image.position+image.width*image.height*4) || ![image.width,image.height,width,height].every(value=>Number.isSafeInteger(value)&&value>0) || !Number.isSafeInteger(width*height*4) || !Number.isSafeInteger(image.width*image.height*4) || !Number.isFinite(hscale) || hscale<=0 || !Number.isFinite(vscale) || vscale<=0) throw new RangeError("Invalid stored resample dimensions");
  if(Math.trunc(fmaDouble(image.width,hscale,0.5))!==width || Math.trunc(fmaDouble(image.height,vscale,0.5))!==height) throw new RangeError("Stored resample scales must match output dimensions");
  if(width===image.width && height===image.height && hscale===1 && vscale===1) return image;
  let alpha=false;
  if(!image.isPremultiplied) {
    const reader=new Pixels(image,storage,signal);
    for(let i=0;i<image.width*image.height;i++) if(((await reader.pixel(i))>>>24)<255) {alpha=true;break;}
  }
  let current=alpha?await alphaPass(image,storage,signal,false):image;
  if(kernel==="nearest") {
    const coordinates=nearestCoordinates(image.width,image.height,width,height,hscale,vscale),reader=new Pixels(current,storage,signal),output=new Output(current,width,height,storage,signal);
    for(const y of coordinates.y()) for(const x of coordinates.x()) {
      const pixel=await reader.pixel(y*image.width+x);
      await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
    }
    current=await output.finish();
  } else {
    const targetW=Math.trunc(fmaDouble(image.width,hscale,0.5)),targetH=Math.trunc(fmaDouble(image.height,vscale,0.5));
    if(targetW<1 || targetH<1 || !Number.isSafeInteger(targetW*targetH*4)) throw new RangeError("Invalid stored resample scale");
    for(const vertical of [true,false]) {
      const scale=vertical?vscale:hscale;
      if(scale>=1) continue;
      const size=vertical?current.height:current.width,target=vertical?targetH:targetW;
      let shrink=1/scale,extra=fmaDouble(target,shrink,-size);
      const integer=Math.max(1,Math.floor((size/target)/2));
      if(integer>1) {current=await box(current,storage,signal,integer,vertical);shrink/=integer;extra/=integer;}
      if(shrink>1) current=await reduce(current,storage,signal,shrink,extra,target,kernel,vertical);
    }
    const remainingH=hscale<1?1:hscale,remainingV=vscale<1?1:vscale;
    if(remainingH>1 || remainingV>1) current=await enlarge(current,storage,signal,width,height,remainingH,remainingV,kernel==="linear" || kernel==="bilinear");
  }
  return alpha?alphaPass(current,storage,signal,true):current;
}
