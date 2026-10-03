import {encodeStoredImage,isStoredOutputFormat} from "./image-encode.js";
import {prepareRawOutput} from "./codecs/raw-storage.js";
import type {ImageByteSource} from "./codecs/png-storage.js";
import {decodeRawResource} from "./codecs/resource-storage.js";
import {transformStoredPipeline} from "./ops/storage-pipeline.js";
import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {readImageResource,UnsupportedStoredResource,type ImageResourceInput} from "./image-resources.js";
import {compareIdentity, compareFileVersion, dirname, FsError, isFsError, type FileSystem, type FileStat, type FileStaging} from "@poe-code/safe-fs/contracts";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {isStoredImageOperation} from "./ops/storage.js";
import type {SharpInputOptions, OutputEncodeOptions, OutputInfo, ImageAstNode} from "./ast.js";

/** Select retained codecs only when the injected filesystem supports safe publication. */
export async function tryImageFile(input: ImageResourceInput, output: string, options: SharpInputOptions, encoding: OutputEncodeOptions, operations: readonly ImageAstNode[] = [], loadedFiles?:ReadonlyMap<string,Uint8Array>): Promise<OutputInfo | undefined> {
  if (!operations.every(isStoredImageOperation) || (input===undefined && !options.text && !options.create)) return undefined;
  const inputFile=typeof input==="string" && !options.text && !options.create?input:undefined;
  const supplied = options.filesystem;
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (!supplied?.capabilities || (inputFile!==undefined && !supplied.openReadFile) || !supplied.open || !supplied.removeFileConditional || !supplied.stat || !supplied.lstat) return undefined;
  const fs = supplied as FileSystem;
  const io = {signal};
  const reading = inputFile===undefined?undefined:await fs.capabilitiesFor?.(inputFile, io) ?? fs.capabilities;
  const writing = await fs.capabilitiesFor?.(output, io) ?? fs.capabilities;
  signal.throwIfAborted();
  const direct = writing.atomicFilePublication && fs.publishFileConditional;
  const staged = writing.atomicFileStaging && writing.retainedStagingCleanup && writing.retainedStagingWrite && fs.createStagedFile && fs.publishStagedFile && fs.removeStagedFile;
  if ((reading && !reading.retainedRead) || (!direct && !staged)) return undefined;
  let expected: FileStat | null = null;
  try {expected = {...await fs.lstat(output,io)};}
  catch(error) {if (!isFsError(error) || error.code !== "ENOENT") throw error;}
  // The compatibility API follows symlinks. Keep that behavior until the
  // streaming publisher exposes an equivalent retained resolution capability.
  if (expected && expected.type !== "file") return undefined;
  const handle = inputFile===undefined?undefined:await fs.openReadFile!(inputFile,io);
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
    if (handle && !handleClosed) {handleClosed=true; try {await handle.close();} catch(error) {cleanupError??={error};}}
    if (!failed && cleanupError) throw cleanupError.error;
  };
  try {
    signal.throwIfAborted();
    let initial:FileStat|undefined;
    let source:ImageByteSource|undefined,decoder:ReturnType<typeof storedImageDecoder>;
    if(handle && inputFile!==undefined){
    initial = {...await handle.stat(io)};
    signal.throwIfAborted();
    if (initial.type !== "file" || !Number.isSafeInteger(initial.size) || initial.size < 0) throw new FsError("EINVAL",{path:inputFile});
    if (compareIdentity(initial,expected ?? undefined) === "same") throw new Error("Cannot use same file for input and output");
    source = {
      size: initial.size,
      async read(position,length) {
        const result = new Uint8Array(length);
        for(let offset=0;offset<length;) {
          signal.throwIfAborted();
          const bytes=await handle.read(position+offset,length-offset,io);
          signal.throwIfAborted();
          if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>length-offset) throw new FsError("EIO",{path:inputFile});
          result.set(bytes,offset); offset+=bytes.length;
        }
        return result;
      }
    };
    const raw=options.raw;
    decoder=raw?(source,storage,signal)=>decodeRawResource(source,storage,{...options,raw},signal):storedImageDecoder(await source.read(0,Math.min(54,initial.size),io));
    if (!decoder) {failed=false; return undefined;}
    }
    const directory=dirname(output), parent={...await fs.stat(directory,io)};
    signal.throwIfAborted();
    storage=new PagedStorage({fs,cwd:options.workingDirectory??directory,env:{},signal});
    let image=source&&decoder?await decoder(source,storage,signal,options):await readImageResource(input,options,fs,storage,signal,loadedFiles);
    const format=encoding.format??image.format;
    if(!isStoredOutputFormat(format)) {failed=false;return undefined;}
    if(handle && initial && inputFile!==undefined){
    const final=await handle.stat(io);
    signal.throwIfAborted();
    if (compareIdentity(initial,final)==="distinct" || !compareFileVersion(initial,final)) throw new FsError("EAGAIN",{path:inputFile,message:"Image source changed while decoding"});
    handleClosed=true; await handle.close();
    }
    const resources={readImage:(input:Uint8Array|string|undefined,resourceOptions:SharpInputOptions|undefined,resourceSignal:AbortSignal)=>readImageResource(typeof input==="string"?loadedFiles?.get(input)??input:input,resourceOptions,fs,storage!,resourceSignal)};
    image=await transformStoredPipeline(image,storage,operations,signal,resources);
    if(format==="raw")image=prepareRawOutput(image,operations);
    const backing=storage;
    let complete=false,info:OutputInfo|undefined;
    stream=(async function* () {
      const encoded=encodeStoredImage(image,backing,signal,{...encoding,format});
      try {while(true){const next=await encoded.next();if(next.done){info=next.value;break;}yield next.value;}}
      finally {await encoded.return(undefined);}
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
    return info!;
  } catch(error) {if(error instanceof UnsupportedStoredResource) {failed=false;return undefined;} throw error;} finally {await cleanup();}
}
