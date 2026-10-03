import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {Pixels,Output} from "./storage-raster.js";

/** Bitwise neighborhoods are separable; repeated clamped edge samples are idempotent. */
export async function morphStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,operation:Extract<ImageAstNode,{kind:"dilate"|"erode"}>,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const radius=Math.max(1,Math.round(operation.width)),and=operation.kind==="dilate";
  if(!Number.isFinite(radius)) throw new RangeError("Invalid morphology radius");
  let current=image;
  for(const vertical of [false,true]) {
    const reader=new Pixels(current,storage,signal),output=new Output(current,image.width,image.height,storage,signal);
    for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
      const coordinate=vertical?y:x,size=vertical?image.height:image.width;
      const start=Math.max(0,coordinate-radius),end=Math.min(size-1,coordinate+radius);
      let value=and?-1:0;
      for(let position=start;position<=end;position++) {
        const pixel=await reader.pixel(vertical?position*image.width+x:y*image.width+position);
        value=and?value&pixel:value|pixel;
        if(and?value===0:value===-1) break;
      }
      await output.pixel(value&255,value>>>8&255,value>>>16&255,image.hasAlpha?value>>>24:255);
    }
    current=await output.finish();
  }
  return {...current,space:"srgb",channels:image.hasAlpha?4:3};
}
