import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {Pixels,Output} from "./storage-raster.js";
import {ConvolutionPixel} from "./convolve.js";

export async function convolveStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,operation:Extract<ImageAstNode,{kind:"convolve"}>,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader=new Pixels(image,storage,signal),output=new Output(image,image.width,image.height,storage,signal),accumulator=new ConvolutionPixel(image,operation.scale,operation.offset);
  const rx=Math.floor(operation.width/2),ry=Math.floor(operation.height/2);
  for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
    accumulator.clear();
    for(let ky=0;ky<operation.height;ky++) for(let kx=0;kx<operation.width;kx++) {
      const sy=Math.max(0,Math.min(image.height-1,y+ky-ry)),sx=Math.max(0,Math.min(image.width-1,x+kx-rx));
      const pixel=await reader.pixel(sy*image.width+sx);
      accumulator.add(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24,operation.kernel[ky*operation.width+kx]??0);
    }
    const pixel=accumulator.pixel((await reader.pixel(y*image.width+x))>>>24);
    await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
  }
  return output.finish();
}
