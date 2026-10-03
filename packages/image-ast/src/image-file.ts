import {encodeJpegFromStorage} from "./codecs/jpeg-storage.js";
import {encodeGifFromStorage} from "./codecs/gif-storage.js";
import {encodeTiffFromStorage} from "./codecs/tiff-storage.js";
import {encodeNetpbmFromStorage} from "./codecs/netpbm-storage.js";
import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {encodeBmpFromStorage} from "./codecs/bmp-storage.js";
import {readImageResource,UnsupportedStoredResource} from "./image-resources.js";
import {prepareClaheImage} from "./ops/clahe.js";
import {transformStoredPixels} from "./ops/storage-pixels.js";
import {resizeStoredImage} from "./ops/storage-resize.js";
import {compareIdentity, compareFileVersion, dirname, FsError, isFsError, type FileSystem, type FileStat, type FileStaging} from "@poe-code/safe-fs/contracts";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {encodePngFromStorage, type ImageByteSource} from "./codecs/png-storage.js";
import {orderImageNodes,splitPostScaleNodes,imageAlphaStages} from "./ops/order.js";
import {transformStoredImage, isStoredImageOperation} from "./ops/storage.js";
import type {SharpInputOptions, OutputEncodeOptions, OutputInfo, ImageAstNode} from "./ast.js";

/** Select retained codecs only when the injected filesystem supports safe publication. */
export async function tryImageFile(input: string, output: string, options: SharpInputOptions, encoding: OutputEncodeOptions, operations: readonly ImageAstNode[] = []): Promise<OutputInfo | undefined> {
  if (!operations.every(isStoredImageOperation)) return undefined;
  const supplied = options.filesystem;
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (!supplied?.capabilities || !supplied.openReadFile || !supplied.open || !supplied.removeFileConditional || !supplied.stat || !supplied.lstat) return undefined;
  const fs = supplied as FileSystem;
  const io = {signal};
  const reading = await fs.capabilitiesFor?.(input, io) ?? fs.capabilities;
  const writing = await fs.capabilitiesFor?.(output, io) ?? fs.capabilities;
  signal.throwIfAborted();
  const direct = writing.atomicFilePublication && fs.publishFileConditional;
  const staged = writing.atomicFileStaging && writing.retainedStagingCleanup && writing.retainedStagingWrite && fs.createStagedFile && fs.publishStagedFile && fs.removeStagedFile;
  if (!reading.retainedRead || (!direct && !staged)) return undefined;
  let expected: FileStat | null = null;
  try {expected = {...await fs.lstat(output,io)};}
  catch(error) {if (!isFsError(error) || error.code !== "ENOENT") throw error;}
  // The compatibility API follows symlinks. Keep that behavior until the
  // streaming publisher exposes an equivalent retained resolution capability.
  if (expected && expected.type !== "file") return undefined;
  const handle = await fs.openReadFile!(input,io);
  let handleClosed = false, failed = true;
  let staging: FileStaging | undefined;
  let storage: PagedStorage | undefined;
  let stream: AsyncGenerator<Uint8Array> | undefined;
  const cleanup = async (): Promise<void> => {
    let cleanupError: {error:unknown} | undefined;
    try {await stream?.return(undefined);} catch(error) {cleanupError={error};}
    try {await storage?.close();} catch(error) {cleanupError??={error};}
    if (staging?.cleanup) {
      try {await staging.cleanup.remove();} catch(error) {cleanupError??={error};}
      try {await staging.cleanup.close();} catch(error) {cleanupError??={error};}
    } else if (staging) {
      try {await fs.removeStagedFile!(staging);} catch(error) {cleanupError??={error};}
    }
    if (!handleClosed) {handleClosed=true; try {await handle.close();} catch(error) {cleanupError??={error};}}
    if (!failed && cleanupError) throw cleanupError.error;
  };
  try {
    signal.throwIfAborted();
    const initial = {...await handle.stat(io)};
    signal.throwIfAborted();
    if (initial.type !== "file" || !Number.isSafeInteger(initial.size) || initial.size < 0) throw new FsError("EINVAL",{path:input});
    if (compareIdentity(initial,expected ?? undefined) === "same") throw new Error("Cannot use same file for input and output");
    const source: ImageByteSource = {
      size: initial.size,
      async read(position,length) {
        const result = new Uint8Array(length);
        for(let offset=0;offset<length;) {
          signal.throwIfAborted();
          const bytes=await handle.read(position+offset,length-offset,io);
          signal.throwIfAborted();
          if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>length-offset) throw new FsError("EIO",{path:input});
          result.set(bytes,offset); offset+=bytes.length;
        }
        return result;
      }
    };
    const decoder=storedImageDecoder(await source.read(0,Math.min(54,initial.size),io));
    if (!decoder) {failed=false; return undefined;}
    const directory=dirname(output), parent={...await fs.stat(directory,io)};
    signal.throwIfAborted();
    storage=new PagedStorage({fs,cwd:directory,env:{},signal});
    let image=await decoder(source,storage,signal,options);
    const format=encoding.format??image.format;
    if(format!=="png"&&format!=="ppm"&&format!=="pgm"&&format!=="pbm"&&format!=="bmp"&&format!=="tiff"&&format!=="gif"&&format!=="jpeg") {failed=false;return undefined;}
    const final=await handle.stat(io);
    signal.throwIfAborted();
    if (compareIdentity(initial,final)==="distinct" || !compareFileVersion(initial,final)) throw new FsError("EAGAIN",{path:input,message:"Image source changed while decoding"});
    handleClosed=true; await handle.close();
    const resources={readImage:(input:Uint8Array|string|undefined,resourceOptions:SharpInputOptions|undefined,resourceSignal:AbortSignal)=>readImageResource(input,resourceOptions,fs,storage!,resourceSignal)};
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
          for(const node of postScale) scaled=await transformStoredImage(scaled,storage!,node,signal);
          return scaled;
        }:undefined);
        if(image.hasAlpha && !image.isPremultiplied) image=index<stages.last?await transformStoredPixels(image,storage,{kind:"premultiply"},signal):{...image,wasPremultiplied:true};
      } else image=await transformStoredImage(image,storage,splitGamma && operation.kind==="gamma"?{...operation,gamma:1}:operation,signal,resources);
      if(index===stages.last && image.isPremultiplied) image=await transformStoredPixels(image,storage,{kind:"unpremultiply"},signal);
    }
    const backing=storage;
    let complete=false, size=0;
    stream=(async function* () {
      for await (const bytes of format==="png"?encodePngFromStorage(image,backing,signal,encoding):format==="jpeg"?encodeJpegFromStorage(image,backing,signal,encoding):format==="gif"?encodeGifFromStorage(image,backing,signal,encoding):format==="tiff"?encodeTiffFromStorage(image,backing,signal,encoding):format==="bmp"?encodeBmpFromStorage(image,backing,signal):encodeNetpbmFromStorage(image,backing,signal,format)) {size+=bytes.length; yield bytes;}
      await backing.close();
      complete=true;
    })();
    if (direct) await fs.publishFileConditional!(output,stream,{expected,parent,maxBytes:Infinity,signal});
    else {
      staging=await fs.createStagedFile!(`${directory}/.image-${crypto.randomUUID()}`,"output",{type:"file",data:new Uint8Array()},{parent,retainCleanup:true,mode:expected ? expected.mode & 0o7777 : 0o666,signal});
      signal.throwIfAborted();
      if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP",{path:output,message:"Image output requires retained staging handles"});
      for await (const bytes of stream) await staging.writer.write(bytes,io);
      const sealed=await staging.writer.finish(io);
      signal.throwIfAborted();
      await fs.publishStagedFile!({...staging,file:{...staging.file,stat:sealed}},output,{parent,destination:expected,signal});
    }
    if (!complete) throw new FsError("EIO",{path:output,message:"Image publisher returned before consuming output"});
    failed=false;
    const gray=image.space==="b-w" || image.channels===1 || image.channels===2;
    return {format,width:image.width,height:image.height,channels:format==="tiff"||format==="gif"?4:format==="ppm"||format==="bmp"||format==="jpeg"?3:format==="pgm"||format==="pbm"?1:gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3,premultiplied:Boolean(image.wasPremultiplied),...(image.pageHeight===undefined?{}:{pageHeight:image.pageHeight}),...(image.pageHeight!==undefined&&(image.sourcePages??image.pages)!==undefined?{pages:image.sourcePages??image.pages}:{}),...(image.trimOffsetLeft===undefined?{}:{trimOffsetLeft:image.trimOffsetLeft}),...(image.trimOffsetTop===undefined?{}:{trimOffsetTop:image.trimOffsetTop}),size};
  } catch(error) {if(error instanceof UnsupportedStoredResource) {failed=false;return undefined;} throw error;} finally {await cleanup();}
}
