import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {Pixels,Output} from "./storage-raster.js";
import {FloatReader,FloatWriter} from "./storage-floats.js";
import {convolveStoredImage} from "./storage-convolve.js";
import {buildVipsGaussmat,vipsSrgbToLabForSharpenInto,vipsLabToSrgbForSharpenInto,sharpenLuminance} from "./sharpen.js";

/** Retain only luminance planes; recompute chroma from the source for output. */
export async function sharpenStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,operation:Extract<ImageAstNode,{kind:"sharpen"}>,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const {sigma,m1,m2,x1=2,y2=10,y3=20}=operation;
  if(sigma<0) return convolveStoredImage(image,storage,{kind:"convolve",width:3,height:3,kernel:[-1,-1,-1,-1,32,-1,-1,-1,-1],scale:24,offset:0},signal);
  const {width,height}=image,count=width*height;
  const reader=new Pixels(image,storage,signal),luminance=new FloatWriter(count,storage,signal);
  const lab=new Float64Array(3),shortLab=new Int16Array(3),rgb=new Uint8Array(3);
  const premultiply=!image.isPremultiplied && (image.hasAlpha || image.channels===4 || image.channels===2);
  const readLab=async(index:number):Promise<number>=>{
    const pixel=await reader.pixel(index),alpha=pixel>>>24,af=Math.fround(alpha/255);
    let r=pixel&255,g=pixel>>>8&255,b=pixel>>>16&255;
    if(premultiply) {r=Math.trunc(Math.fround(r*af));g=Math.trunc(Math.fround(g*af));b=Math.trunc(Math.fround(b*af));}
    vipsSrgbToLabForSharpenInto(r,g,b,lab);
    shortLab[0]=Math.trunc(lab[0]!*327.67);shortLab[1]=Math.trunc(lab[1]!*256);shortLab[2]=Math.trunc(lab[2]!*256);
    return alpha;
  };
  for(let i=0;i<count;i++) {await readLab(i);await luminance.value(shortLab[0]!);}
  const source=new FloatReader(await luminance.finish(),storage,signal),temporary=new FloatWriter(count,storage,signal);
  const {radius,weights,scale}=buildVipsGaussmat(sigma,0.1),roundAdd=Math.trunc(scale)>>1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let sum=0;
    for(let k=-radius;k<=radius;k++) sum+=(await source.value(y*width+Math.max(0,Math.min(width-1,x+k))))*weights[k+radius]!;
    await temporary.value(Math.floor((sum+roundAdd)/scale)<<16>>16);
  }
  const horizontal=new FloatReader(await temporary.finish(),storage,signal),output=new Output(image,width,height,storage,signal);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let sum=0;
    for(let k=-radius;k<=radius;k++) sum+=(await horizontal.value(Math.max(0,Math.min(height-1,y+k))*width+x))*weights[k+radius]!;
    const blurred=Math.floor((sum+roundAdd)/scale)<<16>>16,alpha=await readLab(y*width+x);
    const light=sharpenLuminance(shortLab[0]!,blurred,m1,m2,x1,y2,y3);
    vipsLabToSrgbForSharpenInto(light/327.67,shortLab[1]!/256,shortLab[2]!/256,rgb);
    if(premultiply) {
      const factor=alpha===0?0:Math.fround(255/alpha);
      for(let c=0;c<3;c++) rgb[c]=Math.max(0,Math.min(255,Math.trunc(Math.fround(factor*rgb[c]!))));
    }
    await output.pixel(rgb[0]!,rgb[1]!,rgb[2]!,alpha);
  }
  return output.finish();
}
