import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {extendedCoordinate,PixelMedian,trimBackground} from "./canvas-math.js";
import {Pixels,Output} from "./storage-raster.js";

type CanvasOperation=Extract<ImageAstNode,{kind:"extend"|"median"|"trim"}>;

export async function transformStoredCanvas(image:StoredRgbaImage,storage:ImageByteStorage,operation:CanvasOperation,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader=new Pixels(image,storage,signal);
  if(operation.kind==="median") {
    const radius=Math.max(1,Math.floor(operation.size/2)),histogram=new PixelMedian(),output=new Output(image,image.width,image.height,storage,signal);
    for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
      histogram.clear();
      for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++) {
        const pixel=await reader.pixel(Math.max(0,Math.min(image.height-1,y+dy))*image.width+Math.max(0,Math.min(image.width-1,x+dx)));
        histogram.add(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
      }
      const pixel=histogram.pixel();
      await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
    }
    return output.finish();
  }
  if(operation.kind==="extend") {
    const top=Math.max(0,Math.round(operation.top)),bottom=Math.max(0,Math.round(operation.bottom)),left=Math.max(0,Math.round(operation.left)),right=Math.max(0,Math.round(operation.right));
    const pages=image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight?image.pages:1;
    const pageHeight=image.height/pages,width=image.width+left+right,outPageHeight=pageHeight+top+bottom;
    const height=outPageHeight*pages;
    if(![width,height,left,top,right,bottom].every(Number.isSafeInteger) || !Number.isSafeInteger(width*height*4)) throw new RangeError("Invalid extended image dimensions");
    const output=new Output(image,width,height,storage,signal),bg=operation.background;
    for(let page=0;page<pages;page++) for(let y=0;y<outPageHeight;y++) {
      const sy=extendedCoordinate(y-top,pageHeight,operation.extendWith);
      for(let x=0;x<width;x++) {
        const sx=extendedCoordinate(x-left,image.width,operation.extendWith);
        if(sx<0 || sy<0) await output.pixel(bg.r,bg.g,bg.b,bg.a);
        else {
          const pixel=await reader.pixel((page*pageHeight+sy)*image.width+sx);
          await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
        }
      }
    }
    const hasAlpha=image.hasAlpha || operation.extendWith==="background" && bg.a<255;
    return {...await output.finish(),hasAlpha,channels:hasAlpha?(image.channels<3?2:4):image.channels,...(pages>1?{pageHeight:outPageHeight}:{})};
  }
  if(image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight) throw new Error("Trim is not supported for multi-page images");
  const detected=operation.lineArt || image.width<3 || image.height<3?image:await transformStoredCanvas(image,storage,{kind:"median",size:3},signal);
  const detection=new Pixels(detected,storage,signal),first=await detection.pixel(0);
  const reference=operation.background??{r:first&255,g:first>>>8&255,b:first>>>16&255,a:first>>>24};
  const matches=trimBackground(reference,operation.threshold??10);
  let left=image.width,top=image.height,right=-1,bottom=-1;
  for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
    const pixel=await detection.pixel(y*image.width+x);
    if(!matches(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24)) {left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  if(right<0) return {...image,trimOffsetLeft:0,trimOffsetTop:0};
  const width=right-left+1,height=bottom-top+1,output=new Output(image,width,height,storage,signal);
  for(let y=top;y<=bottom;y++) for(let x=left;x<=right;x++) {
    const pixel=await reader.pixel(y*image.width+x);
    await output.pixel(pixel&255,pixel>>>8&255,pixel>>>16&255,pixel>>>24);
  }
  return {...await output.finish(),trimOffsetLeft:-left,trimOffsetTop:-top};
}
