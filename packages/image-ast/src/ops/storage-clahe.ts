import {defaultRuntime} from "@poe-code/compression";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {ClaheWindow,type ClaheOptions} from "./clahe.js";
import {Pixels,Output} from "./storage-raster.js";
export async function claheStoredImage(image:StoredRgbaImage,storage:ImageByteStorage,options:ClaheOptions,signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 const window=new ClaheWindow(image,options),reader=new Pixels(image,storage,signal),output=new Output(image,image.width,image.height,storage,signal);let work=0;
 for(let y=0;y<image.height;y++) {
  window.clear();
  for(let dy=0;dy<window.height;dy++) for(let dx=0;dx<window.width;dx++) window.add(await reader.pixel(window.position(dx-window.halfWidth,y+dy-window.halfHeight)),1);
  for(let x=0;x<image.width;x++) {
   work+=window.channels.length*256;
   if(work>=16384) {work%=16384;await defaultRuntime.yieldTurn(signal);}
   const pixel=window.pixel(await reader.pixel(y*image.width+x));
   await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
   if(x+1<image.width) for(let dy=0;dy<window.height;dy++) {
    const sy=y+dy-window.halfHeight;
    window.add(await reader.pixel(window.position(x-window.halfWidth,sy)),-1);
    window.add(await reader.pixel(window.position(x+window.width-window.halfWidth,sy)),1);
   }
  }
 }
 return output.finish();
}
