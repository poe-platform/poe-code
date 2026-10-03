import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {AffineSampler,type AffineSpec} from "./affine.js";
import {Pixels,Output} from "./storage-raster.js";
export async function affineStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,spec:AffineSpec,signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const sampler=new AffineSampler(image.width,image.height,spec);if(sampler.identity) return image;
 const hasAlpha=image.hasAlpha || spec.background.a<255,reader=new Pixels(image,storage,signal);
 const output=new Output({...image,hasAlpha,channels:hasAlpha?(image.channels<3?2:4):image.channels},sampler.width,sampler.height,storage,signal);
 for(let y=0;y<sampler.height;y++) for(let x=0;x<sampler.width;x++) {
  const count=sampler.prepare(x,y);
  for(let i=0;i<count;i++) {const position=sampler.positions[i]!;sampler.add(position<0?0:await reader.pixel(position),i);}
  const pixel=sampler.pixel();await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
 }
 return output.finish();
}
