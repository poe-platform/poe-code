import {compositeStoredImage} from "./storage-composite.js";
import {transformStoredChannels,type StoredImageResources} from "./storage-channels.js";
export type {StoredImageResources} from "./storage-channels.js";
import {claheStoredImage} from "./storage-clahe.js";
import {affineStoredImage} from "./storage-affine.js";
import {normalizedRotation} from "./affine.js";
import {sharpenStoredImage} from "./storage-sharpen.js";
import {blurStoredImage} from "./storage-blur.js";
import {morphStoredImage} from "./storage-morphology.js";
import {convolveStoredImage} from "./storage-convolve.js";
import {transformStoredCanvas} from "./storage-canvas.js";
import {resizeStoredImage} from "./storage-resize.js";
import {normalizeStoredImage} from "./storage-normalize.js";
import {isStoredPixelOperation, transformStoredPixels, type StoredPixelOperation} from "./storage-pixels.js";
import type {ImageAstNode} from "../ast.js";
import type {ImageByteStorage, StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";

export type StoredImageOperation = Extract<ImageAstNode,{kind:"flip"|"flop"|"rotate"|"extract"|"autoOrient"|"normalize"|"resize"|"extend"|"median"|"trim"|"convolve"|"dilate"|"erode"|"blur"|"sharpen"|"affine"|"clahe"|"boolean"|"joinChannel"|"composite"}> | StoredPixelOperation;

export function isStoredImageOperation(node:ImageAstNode):node is StoredImageOperation {
  return node.kind==="composite" || node.kind==="boolean" || node.kind==="joinChannel" || node.kind==="clahe" || node.kind==="affine" || node.kind==="sharpen" || node.kind==="blur" || node.kind==="dilate" || node.kind==="erode" || node.kind==="convolve" || node.kind==="extend" || node.kind==="median" || node.kind==="trim" || node.kind==="resize" || node.kind==="normalize" || isStoredPixelOperation(node) || node.kind==="flip" || node.kind==="flop" || node.kind==="extract" || node.kind==="autoOrient" || node.kind==="rotate" && Number.isFinite(node.angle);
}

/** Transforms use bounded chunks or spatial tiles; raster state stays in caller-owned storage. */
export async function transformStoredImage(image:StoredRgbaImage, storage:ImageByteStorage, operation:StoredImageOperation, signal:AbortSignal, resources?:StoredImageResources):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(image.width) || image.width<=0 || !Number.isSafeInteger(image.height) || image.height<=0 || !Number.isSafeInteger(image.width*image.height*4) || !Number.isSafeInteger(image.position) || image.position<0) throw new RangeError("Invalid stored image dimensions");
  if(operation.kind==="composite") {
    if(!resources) throw new Error("Stored image resources require an explicit resolver");
    return compositeStoredImage(image,storage,operation.layers,signal,resources);
  }
  if(operation.kind==="boolean" || operation.kind==="joinChannel") {
    if(!resources) throw new Error("Stored image resources require an explicit resolver");
    return transformStoredChannels(image,storage,operation,signal,resources);
  }
  if(operation.kind==="clahe") return claheStoredImage(image,storage,operation,signal);
  if(operation.kind==="affine") return affineStoredImage(image,storage,operation,signal);
  if(operation.kind==="sharpen") return sharpenStoredImage(image,storage,operation,signal);
  if(operation.kind==="blur") return blurStoredImage(image,storage,operation,signal);
  if(operation.kind==="dilate" || operation.kind==="erode") return morphStoredImage(image,storage,operation,signal);
  if(operation.kind==="convolve") return convolveStoredImage(image,storage,operation,signal);
  if(operation.kind==="extend" || operation.kind==="median" || operation.kind==="trim") return transformStoredCanvas(image,storage,operation,signal);
  if(operation.kind==="resize") return resizeStoredImage(image,storage,operation,signal);
  if(operation.kind==="normalize") return normalizeStoredImage(image,storage,operation,signal);
  if(isStoredPixelOperation(operation)) return transformStoredPixels(image,storage,operation,signal);
  const angle=operation.kind==="rotate"?normalizedRotation(operation.angle):0;
  if (operation.kind==="rotate" && !Number.isFinite(angle)) throw new RangeError("Invalid rotation angle");
  if (operation.kind==="rotate" && angle!==0 && angle!==180 && image.pages && image.pages>1 && image.pageHeight && image.height===image.pages*image.pageHeight) throw new Error("Rotate is not supported for multi-page images");
  if(operation.kind==="rotate" && angle%90!==0) {
    const rad=angle*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    return affineStoredImage(image,storage,{matrix:[cos,-sin,sin,cos],background:operation.background,interpolator:"bilinear"},signal);
  }
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
  const position=storage.allocate(width*height*4);
  const storedPngIndices=image.storedPngIndices?{position:storage.allocate(width*height),width,height}:undefined;
  const storedData16=image.storedData16?{position:storage.allocate(width*height*8),length:width*height*4}:undefined;
  const storedEvaluateSamples=image.storedEvaluateSamples===undefined?undefined:storage.allocate(width*height*32);
  const storedHueSamples=image.storedHueSamples===undefined?undefined:storage.allocate(width*height*32);
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
      const tileWidth=Math.min(32,traversalWidth-x);
      const sourceY=pageHeight===undefined?top+y:Math.floor(y/pageHeight)*image.pageHeight!+top+y%pageHeight;
      const destinationX=transform===2 || transform===3?image.width-x-tileWidth:transform===5 || transform===8?y:transform===6 || transform===7?image.height-y-tileHeight:x;
      const destinationY=transform===3 || transform===4?image.height-y-tileHeight:transform===5 || transform===6?x:transform===7 || transform===8?image.width-x-tileWidth:y;
      const outputWidth=transform>=5?tileHeight:tileWidth,outputHeight=transform>=5?tileWidth:tileHeight;
      for(const plane of [{source:image.position,target:position,stride:4},...(storedPngIndices?[{source:image.storedPngIndices!.position,target:storedPngIndices.position,stride:1}]:[]),...(storedData16?[{source:image.storedData16!.position,target:storedData16.position,stride:8}]:[]),...(storedEvaluateSamples===undefined?[]:[{source:image.storedEvaluateSamples!,target:storedEvaluateSamples,stride:32}]),...(storedHueSamples===undefined?[]:[{source:image.storedHueSamples!,target:storedHueSamples,stride:32}])]) {
        const data=new Uint8Array(tileWidth*tileHeight*plane.stride);
        for(let row=0;row<tileHeight;row++) {
          const bytes=await read(plane.source+((sourceY+row)*image.width+left+x)*plane.stride,tileWidth*plane.stride);
          for(let col=0;col<tileWidth;col++) {
            const dx=transform===2 || transform===3?tileWidth-1-col:transform===5 || transform===8?row:transform===6 || transform===7?tileHeight-1-row:col;
            const dy=transform===3 || transform===4?tileHeight-1-row:transform===5 || transform===6?col:transform===7 || transform===8?tileWidth-1-col:row;
            data.set(bytes.subarray(col*plane.stride,(col+1)*plane.stride),(dy*outputWidth+dx)*plane.stride);
          }
        }
        for(let row=0;row<outputHeight;row++) {
          signal.throwIfAborted();
          await storage.write(plane.target+((destinationY+row)*width+destinationX)*plane.stride,data.subarray(row*outputWidth*plane.stride,(row+1)*outputWidth*plane.stride),{signal});
          signal.throwIfAborted();
        }
      }
    }
    y+=tileHeight;
  }
  return {...image,position,width,height,...(storedPngIndices?{storedPngIndices}:{}),...(storedEvaluateSamples===undefined?{}:{storedEvaluateSamples}),...(storedHueSamples===undefined?{}:{storedHueSamples}),...(storedData16?{storedData16}:{}),...(pageHeight===undefined?{}:{pageHeight}),...(operation.kind==="autoOrient"?{orientation:1}:{})};
}
