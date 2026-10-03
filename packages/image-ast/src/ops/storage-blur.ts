import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {blurKernel,blurFloatPixel} from "./blur.js";
import {Pixels,Output} from "./storage-raster.js";
import {FloatReader,FloatWriter} from "./storage-floats.js";
import {transformStoredPixels} from "./storage-pixels.js";
import {convolveStoredImage} from "./storage-convolve.js";

export async function blurStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,operation:Extract<ImageAstNode,{kind:"blur"}>,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const {sigma,minAmplitude=0.2,precision="integer"}=operation;
  if(sigma<0) return convolveStoredImage(image,storage,{kind:"convolve",width:3,height:3,kernel:[1,1,1,1,1,1,1,1,1],scale:9,offset:0},signal);
  if(sigma<0.2) return image;
  const {radius,weights,shift,half}=blurKernel(sigma,minAmplitude,precision);
  if(radius<=0) return image;
  const alreadyPremultiplied=Boolean(image.isPremultiplied),useAlpha=alreadyPremultiplied || image.hasAlpha || image.channels===4 || image.channels===2;
  const source=useAlpha && !alreadyPremultiplied?await transformStoredPixels(image,storage,{kind:"premultiply"},signal):image;
  const {width,height}=image;
  if(precision!=="float") {
    let current=source;
    for(const vertical of [false,true]) {
      const reader=new Pixels(current,storage,signal),output=new Output(image,width,height,storage,signal);
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const sums=[0,0,0,0];
        for(let k=-radius;k<=radius;k++) {
          const position=vertical?Math.max(0,Math.min(height-1,y+k))*width+x:y*width+Math.max(0,Math.min(width-1,x+k));
          const pixel=await reader.pixel(position),weight=weights[k+radius]!;
          for(let c=0;c<4;c++) sums[c]!+=(pixel>>>(8*c)&255)*weight;
        }
        const round=(value:number)=>Math.min(255,Math.max(0,(value+half)>>shift));
        await output.pixel(round(sums[0]!),round(sums[1]!),round(sums[2]!),useAlpha?round(sums[3]!):255);
      }
      current=await output.finish();
    }
    if(useAlpha && !alreadyPremultiplied) current=await transformStoredPixels({...current,isPremultiplied:true},storage,{kind:"unpremultiply"},signal);
    return {...image,position:current.position};
  }
  const reader=new Pixels(source,storage,signal),temporary=new FloatWriter(width*height*4,storage,signal);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sums=[0,0,0,0];
    for(let k=-radius;k<=radius;k++) {
      const pixel=await reader.pixel(y*width+Math.max(0,Math.min(width-1,x+k))),weight=weights[k+radius]!;
      for(let c=0;c<4;c++) sums[c]!+=(pixel>>>(8*c)&255)*weight;
    }
    for(const value of sums) await temporary.value(value);
  }
  const floats=new FloatReader(await temporary.finish(),storage,signal),output=new Output(image,width,height,storage,signal);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sums=[0,0,0,0];
    for(let k=-radius;k<=radius;k++) {
      const position=(Math.max(0,Math.min(height-1,y+k))*width+x)*4,weight=weights[k+radius]!;
      for(let c=0;c<4;c++) sums[c]!+=(await floats.value(position+c))*weight;
    }
    const pixel=blurFloatPixel(sums[0]!,sums[1]!,sums[2]!,sums[3]!,alreadyPremultiplied,useAlpha);
    await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
  }
  return output.finish();
}
