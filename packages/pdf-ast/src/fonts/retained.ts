import { parseStoredType1Font } from "./stored-type1.js";
import { parseStoredCffFont } from "./stored-cff.js";
import { parseStoredTrueTypeFont } from "./stored-truetype.js";
import { cosNumber } from "../ast.js";
import {parseStoredCMap} from "./stored-cmap.js";
import {CosRangeLexer} from "../cos/lexer.js";
import {parseCharacterCMapSteps,parseToUnicodeCMapSteps} from "./cmap.js";
import type { PdfCosDict, PdfCosRef, PdfCosStream, PdfPixelStorage } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import { resolvePageFontsSteps, type FontResolutionResult, type ResolvedPageFont } from "./resolve.js";

export interface PdfRetainedFontOptions extends PdfFontAllocationOptions {
  /** Caller-owned resource backing, retained for the returned font lifetime. */
  readonly resourceStorage?: PdfPixelStorage;
  readonly maxStagingBytes?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
}

/** Resolve one font without loading the document or unrelated font programs.
 * Font programs and glyph scratch retain caller resource backing.
 * The caller owns font lifetime. */
export async function resolveRetainedFont(document: PdfRetainedDocument, storage: PdfIndexStorage,
  resources: PdfCosDict | undefined, name: string, options: PdfRetainedFontOptions = {}): Promise<ResolvedPageFont | undefined> {
  const chunkBytes = options.chunkBytes ?? 65536;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid font chunkBytes");
  const maxStagingBytes = options.maxStagingBytes ?? Infinity;
  if (maxStagingBytes !== Infinity && (!Number.isSafeInteger(maxStagingBytes) || maxStagingBytes < 0)) throw new RangeError("Invalid font maxStagingBytes");
  const { signal } = options;
  const allocation = new PdfFontAllocation({ ...options, onAllocation(bytes) { signal?.throwIfAborted(); options.onAllocation?.(bytes); } });
  signal?.throwIfAborted();
  allocation.admit(1024);
  const identities = new WeakMap<PdfCosStream, PdfCosRef>();
  const steps = resolvePageFontsSteps(document.crossReference.rootRef, resources, name, { onAllocation: bytes => allocation.admit(bytes) });
  let step = steps.next(); let requests = 0;
  try {
    while (!step.done) {
      signal?.throwIfAborted();
      if (++requests % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      let value: FontResolutionResult;
      if (step.value.kind === "resolve") {
        const retained = await document.lookup(step.value.node);
        value = retained?.value;
        if (retained?.stream) {
          if (retained.value.kind !== "dict" || !retained.reference) throw new PdfError("E_PARSE", "Font stream has no retained identity");
          allocation.admit(256);
          const stream: PdfCosStream = { kind: "stream", dict: retained.value, rawBytes: new Uint8Array() };
          identities.set(stream, retained.reference); value = stream;
        }
      } else if(step.value.kind==="truetype-map") {
        value=cosNumber(step.value.name!==undefined?await step.value.font.findGlyphName(step.value.name):await step.value.font.getGlyphId(step.value.code!));
      } else {
        const reference = identities.get(step.value.stream);
        if (!reference) throw new PdfError("E_CAPABILITY", "Font stream is not backed by the retained document");
        // Source cache, read result, backend response and detached staging write.
        allocation.admit(chunkBytes * 5);
        let staged: PdfFileSource | undefined; let failed = false;
        let malformed: PdfError | undefined;
        async function* decoded() {
          try { yield* document.objects.decodeStream(reference!.objectNumber, reference!.generationNumber); }
          catch (error) { if (error instanceof PdfError && error.code === "E_PARSE") malformed = error; throw error; }
        }
        try {
          staged = await PdfFileSource.fromStream(storage.fs, storage.directory,
            decoded(),
            { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: maxStagingBytes, ...(signal ? { signal } : {}) });
          if(step.value.purpose==="cid-map"&&options.resourceStorage){
            allocation.admit(64);
            const storage=options.resourceStorage,position=storage.allocate(staged.size);let offset=0;
            for await(const bytes of staged.stream(0,staged.size,signal)){await storage.write(position+offset,bytes,signal?{signal}:undefined);offset+=bytes.length;}
            value={storage,position,byteLength:staged.size};
          }else if(step.value.purpose==="unicode-cmap"||step.value.purpose==="encoding-cmap"){
            const input=staged;let readFailure:{reason:unknown}|undefined;
            const backing=options.resourceStorage;
            const mapStorage:PdfPixelStorage|undefined=backing?{
              allocate(length){try{return backing.allocate(length);}catch(reason){readFailure={reason};throw reason;}},
              async read(position,length,selected){try{return await backing.read(position,length,selected);}catch(reason){readFailure={reason};throw reason;}},
              async write(position,bytes,selected){try{await backing.write(position,bytes,selected);}catch(reason){readFailure={reason};throw reason;}},
            }:undefined;
            const lexer=new CosRangeLexer({size:input.size,chunkBytes:input.chunkBytes,async read(position,length,selected){try{return await input.read(position,length,selected);}catch(reason){readFailure={reason};throw reason;}}},{onTokenAllocation:bytes=>allocation.admit(bytes),...(signal?{signal}:{})});
            const program=step.value.purpose==="unicode-cmap"?parseToUnicodeCMapSteps({onAllocation:bytes=>allocation.admit(bytes)}):parseCharacterCMapSteps({onAllocation:bytes=>allocation.admit(bytes)});
            try{if(mapStorage)value=await parseStoredCMap(()=>lexer.nextToken(),mapStorage,{unicode:step.value.purpose==="unicode-cmap",onAllocation:bytes=>allocation.admit(bytes),...(signal?{signal}:{})});
            else {let parsed=program.next(),tokens=0;while(!parsed.done){signal?.throwIfAborted();if(++tokens%256===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}parsed=program.next(await lexer.nextToken());}value=parsed.value;}}
            catch(error){
              signal?.throwIfAborted();allocation.rethrowAllocationFailure(error);
              if(readFailure&&Object.is(readFailure.reason,error))throw error;
              step=steps.throw(error);continue;
            }
            finally{program.return(undefined as never);}
          }else{
            if((step.value.purpose==="truetype" || step.value.purpose==="cff" || step.value.purpose==="type1") && options.resourceStorage){
              const backing=options.resourceStorage,position=backing.allocate(staged.size);let offset=0;
              for await(const bytes of staged.stream(0,staged.size,signal)){await backing.write(position+offset,bytes,signal?{signal}:undefined);offset+=bytes.length;}
              if(step.value.purpose==="type1"){
                value=await parseStoredType1Font({storage:backing,position,byteLength:staged.size},step.value.type1Properties!,{onAllocation:bytes=>allocation.admit(bytes),...(signal?{signal}:{})});
                step=steps.next(value);continue;
              }
              if(step.value.purpose==="cff"){
                value=await parseStoredCffFont({storage:backing,position,byteLength:staged.size},step.value.encodingName,step.value.differences??new Map(),{onAllocation:bytes=>allocation.admit(bytes),...(signal?{signal}:{})});
                step=steps.next(value);continue;
              }
              const font=await parseStoredTrueTypeFont({storage:backing,position,byteLength:staged.size},{onAllocation:bytes=>allocation.admit(bytes),...(signal?{signal}:{})});
              if(font){step=steps.next(font);continue;}
            }
            allocation.admit(staged.size);
            value = new Uint8Array(staged.size);
            let offset = 0;
            for await (const bytes of staged.stream(0, staged.size, signal)) { value.set(bytes, offset); offset += bytes.length; }
          }
        } catch (error) {
          failed = true;
          if (malformed && error === malformed) { step = steps.throw(error); continue; }
          throw error;
        }
        finally { if (staged) { try { await staged.close(); } catch (error) { if (!failed) await Promise.reject(error); } } }
      }
      signal?.throwIfAborted();
      step = steps.next(value);
    }
    return step.value.get(name);
  } finally { if (!step.done) steps.return(new Map()); }
}
