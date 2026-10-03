import {sharpenStoredImage} from "./storage-sharpen.js";
import {blurStoredImage} from "./storage-blur.js";
import {morphStoredImage} from "./storage-morphology.js";
import {convolveStoredImage} from "./storage-convolve.js";
import {transformStoredCanvas} from "./storage-canvas.js";
import {resizeStoredImage} from "./storage-resize.js";
import {normalizeStoredImage} from "./storage-normalize.js";
import {isStoredPixelOperation, transformStoredPixels, type StoredPixelOperation} from "./storage-pixels.js";
import type {ImageAstNode, RgbaImage} from "../ast.js";
import type {ImageByteStorage, StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {flipImage, flopImage, rotateImage, applyExifOrientation} from "./transform.js";

export type StoredImageOperation = Extract<ImageAstNode,{kind:"flip"|"flop"|"rotate"|"extract"|"autoOrient"|"normalize"|"resize"|"extend"|"median"|"trim"|"convolve"|"dilate"|"erode"|"blur"|"sharpen"}> | StoredPixelOperation;

export function isStoredImageOperation(node:ImageAstNode):node is StoredImageOperation {
  return node.kind==="sharpen" || node.kind==="blur" || node.kind==="dilate" || node.kind==="erode" || node.kind==="convolve" || node.kind==="extend" || node.kind==="median" || node.kind==="trim" || node.kind==="resize" || node.kind==="normalize" || isStoredPixelOperation(node) || node.kind==="flip" || node.kind==="flop" || node.kind==="extract" || node.kind==="autoOrient" || node.kind==="rotate" && Number.isFinite(node.angle) && node.angle%90===0;
}

/** Transforms use bounded chunks or spatial tiles; raster state stays in caller-owned storage. */
export async function transformStoredImage(image:StoredRgbaImage, storage:ImageByteStorage, operation:StoredImageOperation, signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(image.width) || image.width<=0 || !Number.isSafeInteger(image.height) || image.height<=0 || !Number.isSafeInteger(image.width*image.height*4) || !Number.isSafeInteger(image.position) || image.position<0) throw new RangeError("Invalid stored image dimensions");
  if(operation.kind==="sharpen") return sharpenStoredImage(image,storage,operation,signal);
  if(operation.kind==="blur") return blurStoredImage(image,storage,operation,signal);
  if(operation.kind==="dilate" || operation.kind==="erode") return morphStoredImage(image,storage,operation,signal);
  if(operation.kind==="convolve") return convolveStoredImage(image,storage,operation,signal);
  if(operation.kind==="extend" || operation.kind==="median" || operation.kind==="trim") return transformStoredCanvas(image,storage,operation,signal);
  if(operation.kind==="resize") return resizeStoredImage(image,storage,operation,signal);
  if(operation.kind==="normalize") return normalizeStoredImage(image,storage,operation,signal);
  if(isStoredPixelOperation(operation)) return transformStoredPixels(image,storage,operation,signal);
  const angle=operation.kind==="rotate"?((operation.angle%360)+360)%360:0;
  if (operation.kind==="rotate" && (!Number.isFinite(angle) || angle%90!==0)) throw new RangeError("Stored rotation requires a right angle");
  if (operation.kind==="rotate" && angle!==0 && angle!==180 && image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight) throw new Error("Rotate is not supported for multi-page images");
  const orientation=operation.kind==="autoOrient"?image.orientation:undefined;
  let transform=operation.kind==="flip"?4:operation.kind==="flop"?2:operation.kind==="rotate"?angle===90?6:angle===180?3:angle===270?8:1:orientation??1;
  if (!Number.isInteger(transform) || transform<1 || transform>8) transform=1;
  let left=0,top=0,width=image.width,height=image.height,pageHeight:number|undefined;
  if (operation.kind==="extract") {
    left=Math.round(operation.left);top=Math.round(operation.top);width=Math.round(operation.width);height=Math.round(operation.height);
    if (![left,top,width,height].every(Number.isSafeInteger) || width<=0 || height<=0 || left<0 || top<0 || left+width>image.width || top+height>image.height) throw new Error(`extract_area: bad extract area (left=${left}, top=${top}, width=${width}, height=${height} on ${image.width}x${image.height})`);
    if (image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight && top+height<=image.pageHeight) {pageHeight=height;height*=image.pages;}
  } else if (transform>=5) {width=image.height;height=image.width;}
  if (operation.kind!=="extract" && transform===1) return operation.kind==="autoOrient"?{...image,orientation:1}:image;
  const {pages:ignoredPages,pageHeight:ignoredPageHeight,...tileMetadata}=image;
  const position=storage.allocate(width*height*4);
  let work=0;
  const read=async(offset:number,length:number):Promise<Uint8Array>=>{
    signal.throwIfAborted();
    if (++work%64===0) await defaultRuntime.yieldTurn(signal);
    const bytes=await storage.read(offset,length,{signal});
    signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.length!==length) throw new Error("Truncated image backing storage");
    return new Uint8Array(bytes);
  };
  // Crop traverses the output rectangle; other operations traverse the input.
  const traversalWidth=operation.kind==="extract"?width:image.width;
  const traversalHeight=operation.kind==="extract"?height:image.height;
  for(let y=0;y<traversalHeight;) {
    const tileHeight=Math.min(32,traversalHeight-y,pageHeight===undefined?Infinity:pageHeight-y%pageHeight);
    for(let x=0;x<traversalWidth;x+=32) {
      const tileWidth=Math.min(32,traversalWidth-x),data=new Uint8Array(tileWidth*tileHeight*4);
      const sourceY=pageHeight===undefined?top+y:Math.floor(y/pageHeight)*image.pageHeight!+top+y%pageHeight;
      for(let row=0;row<tileHeight;row++) data.set(await read(image.position+((sourceY+row)*image.width+left+x)*4,tileWidth*4),row*tileWidth*4);
      const tile:RgbaImage={...tileMetadata,width:tileWidth,height:tileHeight,data};
      const pixels=operation.kind==="flip"?flipImage(tile):operation.kind==="flop"?flopImage(tile):operation.kind==="rotate"?rotateImage(tile,angle,operation.background):operation.kind==="autoOrient"?applyExifOrientation(tile):tile;
      const destinationX=transform===2 || transform===3?image.width-x-tileWidth:transform===5 || transform===8?y:transform===6 || transform===7?image.height-y-tileHeight:x;
      const destinationY=transform===3 || transform===4?image.height-y-tileHeight:transform===5 || transform===6?x:transform===7 || transform===8?image.width-x-tileWidth:y;
      for(let row=0;row<pixels.height;row++) {
        signal.throwIfAborted();
        await storage.write(position+((destinationY+row)*width+destinationX)*4,pixels.data.subarray(row*pixels.width*4,(row+1)*pixels.width*4),{signal});
        signal.throwIfAborted();
      }
    }
    y+=tileHeight;
  }
  return {...image,position,width,height,...(pageHeight===undefined?{}:{pageHeight}),...(operation.kind==="autoOrient"?{orientation:1}:{})};
}
