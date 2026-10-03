import type {ImageAstNode,RgbaImage} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {premultiplyRgbaImage,unpremultiplyRgbaImage,grayscaleImage,flattenImage,unflattenImage,negateImage,modulateImage,tintImage,gammaImage,linearImage,thresholdImage,ensureAlphaImage,removeAlphaImage,extractChannelImage,recombImage,toColorspaceImage,bandboolImage} from "./transform.js";

export type StoredPixelOperation=Extract<ImageAstNode,{kind:"grayscale"|"flatten"|"unflatten"|"negate"|"modulate"|"tint"|"gamma"|"linear"|"threshold"|"ensureAlpha"|"removeAlpha"|"extractChannel"|"recomb"|"toColorspace"|"bandbool"|"withMetadata"}>;
export function isStoredPixelOperation(node:ImageAstNode):node is StoredPixelOperation {
  return ["grayscale","flatten","unflatten","negate","modulate","tint","gamma","linear","threshold","ensureAlpha","removeAlpha","extractChannel","recomb","toColorspace","bandbool","withMetadata"].includes(node.kind);
}
type InternalPixelOperation=StoredPixelOperation|{readonly kind:"premultiply"|"unpremultiply"};
function apply(image:RgbaImage,node:InternalPixelOperation):RgbaImage {
  switch(node.kind) {
    case "premultiply":return premultiplyRgbaImage(image);
    case "unpremultiply":return unpremultiplyRgbaImage(image);
    case "grayscale":return grayscaleImage(image);
    case "flatten":return flattenImage(image,node.background);
    case "unflatten":return unflattenImage(image);
    case "negate":return negateImage(image,{alpha:node.alpha});
    case "modulate":return modulateImage(image,node);
    case "tint":return tintImage(image,node.color);
    case "gamma":return gammaImage(image,node.gamma,node.gammaOut);
    case "linear":return linearImage(image,node.a,node.b);
    case "threshold":return thresholdImage(image,node.value,node.grayscale);
    case "ensureAlpha":return ensureAlphaImage(image,node.alpha);
    case "removeAlpha":return removeAlphaImage(image);
    case "extractChannel":return extractChannelImage(image,node.channel);
    case "recomb":return recombImage(image,node.matrix);
    case "toColorspace":return toColorspaceImage(image,node.space);
    case "bandbool":return bandboolImage(image,node.op);
    case "withMetadata":return {...image,...(node.density===undefined?{}:{density:node.density}),...(node.orientation===undefined?{}:{orientation:node.orientation})};
  }
}
export async function transformStoredPixels(image:StoredRgbaImage,storage:ImageByteStorage,operation:InternalPixelOperation,signal:AbortSignal):Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  // Selected operators have pixel-independent metadata. Validate their arguments
  // before acquiring output space, using the same implementation as each chunk.
  const {data:ignoredData,...metadata}=apply({...image,width:0,height:0,data:new Uint8Array()},operation);
  if(operation.kind==="withMetadata") return {...metadata,width:image.width,height:image.height,position:image.position};
  const position=storage.allocate(image.width*image.height*4);
  for(let offset=0;offset<image.width*image.height*4;offset+=4096) {
    signal.throwIfAborted();
    if(offset%(4096*16)===0) await defaultRuntime.yieldTurn(signal);
    const length=Math.min(4096,image.width*image.height*4-offset);
    const bytes=await storage.read(image.position+offset,length,{signal});
    signal.throwIfAborted();
    if(!(bytes instanceof Uint8Array) || bytes.length!==length) throw new Error("Truncated image backing storage");
    const result=apply({...image,width:length/4,height:1,data:new Uint8Array(bytes)},operation);
    await storage.write(position+offset,result.data,{signal});
    signal.throwIfAborted();
  }
  return {...metadata,width:image.width,height:image.height,position};
}
