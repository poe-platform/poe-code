import {prepareClaheImage} from "./clahe.js";
import {transformStoredPixels} from "./storage-pixels.js";
import {resizeStoredImage} from "./storage-resize.js";
import {orderImageNodes,splitPostScaleNodes,imageAlphaStages} from "./order.js";
import {transformStoredImage,type StoredImageOperation,type StoredImageResources} from "./storage.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";

/** Apply the same ordered alpha, gamma and post-scale stages to each retained terminal operation. */
export async function transformStoredPipeline(image:StoredRgbaImage,storage:ImageByteStorage,operations:readonly StoredImageOperation[],signal:AbortSignal,resources:StoredImageResources):Promise<StoredRgbaImage> {
    const gamma=operations.find(node=>node.kind==="gamma");
    const splitGamma=gamma && operations.some(node=>node.kind==="resize" || node.kind==="blur" || node.kind==="sharpen" || node.kind==="convolve" || node.kind==="modulate" || node.kind==="recomb");
    let gammaInApplied=false;
    const {nodes,postScale}=splitPostScaleNodes(operations);
    const ordered=orderImageNodes(nodes),stages=imageAlphaStages(ordered);
    for (let index=0;index<ordered.length;index++) {
      const operation=ordered[index]!;
      if(operation.kind==="clahe") image=prepareClaheImage(image,operations);
      if (splitGamma && !gammaInApplied && (index===stages.first || operation.kind==="modulate" || operation.kind==="recomb")) {
        image=await transformStoredImage(image,storage,{...gamma,gammaOut:1},signal);
        gammaInApplied=true;
      }
      if(index===stages.first && image.hasAlpha) {
        image=stages.count>1?await transformStoredPixels(image,storage,{kind:"premultiply"},signal):{...image,wasPremultiplied:true};
      }
      if(operation.kind==="resize") {
        image=await resizeStoredImage(image,storage,operation,signal,postScale.length?async scaled=>{
          for(const node of postScale) scaled=await transformStoredImage(scaled,storage,node,signal);
          return scaled;
        }:undefined);
        if(image.hasAlpha && !image.isPremultiplied) image=index<stages.last?await transformStoredPixels(image,storage,{kind:"premultiply"},signal):{...image,wasPremultiplied:true};
      } else image=await transformStoredImage(image,storage,splitGamma && operation.kind==="gamma"?{...operation,gamma:1}:operation,signal,resources);
      if(index===stages.last && image.isPremultiplied) image=await transformStoredPixels(image,storage,{kind:"unpremultiply"},signal);
    }
    return image;
}
