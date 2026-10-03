import {resizeStoredImage} from "./ops/storage-resize.js";
import {compareIdentity, compareFileVersion, dirname, FsError, isFsError, type FileSystem, type FileStat, type FileStaging} from "@poe-code/safe-fs/contracts";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodePngToStorage, encodePngFromStorage, type ImageByteSource} from "./codecs/png-storage.js";
import {isPngBytes} from "./codecs/png.js";
import {orderImageNodes,splitPostScaleNodes} from "./ops/order.js";
import {transformStoredImage, isStoredImageOperation} from "./ops/storage.js";
import type {SharpInputOptions, OutputEncodeOptions, OutputInfo, ImageAstNode} from "./ast.js";

/** Select the retained PNG path only when the injected filesystem supports it. */
export async function tryPngFile(input: string, output: string, options: SharpInputOptions, encoding: OutputEncodeOptions, operations: readonly ImageAstNode[] = []): Promise<OutputInfo | undefined> {
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
    if (initial.size < 8 || !isPngBytes(await source.read(0,8,io))) {failed=false; return undefined;}
    const directory=dirname(output), parent={...await fs.stat(directory,io)};
    signal.throwIfAborted();
    storage=new PagedStorage({fs,cwd:directory,env:{},signal});
    let image=await decodePngToStorage(source,storage,signal,options);
    const final=await handle.stat(io);
    signal.throwIfAborted();
    if (compareIdentity(initial,final)==="distinct" || !compareFileVersion(initial,final)) throw new FsError("EAGAIN",{path:input,message:"Image source changed while decoding"});
    handleClosed=true; await handle.close();
    const gamma=operations.find(node=>node.kind==="gamma");
    const splitGamma=gamma && operations.some(node=>node.kind==="resize" || node.kind==="modulate" || node.kind==="recomb");
    let gammaInApplied=false;
    const {nodes,postScale}=splitPostScaleNodes(operations);
    for (const operation of orderImageNodes(nodes)) {
      if (splitGamma && !gammaInApplied && (operation.kind==="resize" || operation.kind==="modulate" || operation.kind==="recomb")) {
        image=await transformStoredImage(image,storage,{...gamma,gammaOut:1},signal);
        gammaInApplied=true;
      }
      if(operation.kind==="resize") {
        image=await resizeStoredImage(image,storage,operation,signal,postScale.length?async scaled=>{
          for(const node of postScale) scaled=await transformStoredImage(scaled,storage!,node,signal);
          return scaled;
        }:undefined);
        if(image.hasAlpha) image={...image,wasPremultiplied:true};
        continue;
      }
      image=await transformStoredImage(image,storage,splitGamma && operation.kind==="gamma"?{...operation,gamma:1}:operation,signal);
    }
    const backing=storage;
    let complete=false, size=0;
    stream=(async function* () {
      for await (const bytes of encodePngFromStorage(image,backing,signal,encoding)) {size+=bytes.length; yield bytes;}
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
    return {format:"png",width:image.width,height:image.height,channels:gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3,premultiplied:Boolean(image.wasPremultiplied),size};
  } finally {await cleanup();}
}
