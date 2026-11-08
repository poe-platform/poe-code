import type {CompositeLayer,SharpInputOptions} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import type {StoredImageResources} from "./storage-channels.js";
import {CompositePixel,compositeOffset} from "./composite.js";
import {Pixels,Output} from "./storage-raster.js";
import {transformStoredImage} from "./storage.js";

export async function compositeStoredImage(base:StoredRgbaImage,storage:ImageByteStorage,layers:readonly CompositeLayer[],signal:AbortSignal,resources:StoredImageResources):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const initial=new Pixels(base,storage,signal),clean=new Output(base,base.width,base.height,storage,signal);
 // Transparent source colours are cleared once, before any layer is applied.
 for(let i=0;i<base.width*base.height;i++) {
  const value=await initial.pixel(i);
  await clean.pixel(value>>>24?value&255:0,value>>>24?value>>>8&255:0,value>>>24?value>>>16&255:0,value>>>24);
 }
 let image=await clean.finish();
 const destination=new Uint8Array(4),source=new Uint8Array(4);
 for(const layer of layers) {
  signal.throwIfAborted();
  let input:Uint8Array|string|undefined;
  let options:SharpInputOptions={...(layer.density!==undefined?{density:layer.density}:{}),...(layer.page!==undefined?{page:layer.page}:{}),...(layer.pages!==undefined?{pages:layer.pages}:{}),...(layer.animated!==undefined?{animated:layer.animated}:{}),...(layer.raw?{raw:{...layer.raw,premultiplied:false}}:{})};
  if(typeof layer.input==="string") input=layer.input.trimStart().startsWith("<")?new TextEncoder().encode(layer.input):layer.input;
  else if(layer.input instanceof Uint8Array) input=layer.input;
  else if(ArrayBuffer.isView(layer.input)) input=new Uint8Array(layer.input.buffer,layer.input.byteOffset,layer.input.byteLength);
  else if(layer.input instanceof ArrayBuffer) input=new Uint8Array(layer.input);
  else options={...(layer.input.create!==undefined?{create:layer.input.create}:{}),...(layer.input.text!==undefined?{text:layer.input.text}:{}),...(layer.density!==undefined?{density:layer.density}:{})};
  let overlay=await resources.readImage(input,options,signal);signal.throwIfAborted();
  if(!Number.isSafeInteger(overlay.width)||overlay.width<=0||!Number.isSafeInteger(overlay.height)||overlay.height<=0||!Number.isSafeInteger(overlay.width*overlay.height*4)||!Number.isSafeInteger(overlay.position)||overlay.position<0||!Number.isSafeInteger(overlay.position+overlay.width*overlay.height*4)) throw new RangeError("Invalid stored resource dimensions");
  if(layer.autoOrient && overlay.orientation && overlay.orientation>1) overlay=await transformStoredImage(overlay,storage,{kind:"autoOrient"},signal);
  if(overlay.width>base.width||overlay.height>base.height) throw new Error("Image to composite must have same dimensions or smaller");
  const {startX,startY}=compositeOffset(base.width,base.height,overlay,layer),kernel=new CompositePixel(layer);
  const previous=new Pixels(image,storage,signal),operand=new Pixels(overlay,storage,signal),output=new Output(image,base.width,base.height,storage,signal);
  const opaque=!layer.tile&&!overlay.hasAlpha&&(layer.blend===undefined||layer.blend==="over"||layer.blend==="source");
  for(let y=0;y<base.height;y++) for(let x=0;x<base.width;x++) {
   const d=await previous.pixel(y*base.width+x);
   destination[0]=d&255;destination[1]=d>>>8&255;destination[2]=d>>>16&255;destination[3]=d>>>24;
   const sx=layer.tile?((x-startX)%overlay.width+overlay.width)%overlay.width:x-startX,sy=layer.tile?((y-startY)%overlay.height+overlay.height)%overlay.height:y-startY;
   if(sx>=0&&sy>=0&&sx<overlay.width&&sy<overlay.height) {
    const s=await operand.pixel(sy*overlay.width+sx);
    source[0]=s&255;source[1]=s>>>8&255;source[2]=s>>>16&255;source[3]=s>>>24;
    if(opaque) destination.set(source);else kernel.apply(destination,destination,0,source,0);
   } else if(!kernel.skipWhenSaZero) destination.fill(0);
   await output.pixel(destination[0]!,destination[1]!,destination[2]!,destination[3]!);
  }
  image=await output.finish();
 }
 return {...image,hasAlpha:true,channels:base.channels<3?2:4};
}
