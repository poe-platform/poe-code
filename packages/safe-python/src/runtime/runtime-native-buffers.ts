import type {ImmutableBytes} from "./immutable-bytes.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferContext,RuntimeBufferLease} from "./runtime-buffer-context.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import type {RuntimeValue} from "./runtime-values.js";

/** Exact bytes use their immutable storage. Subtypes first consult the export
 * service, which may override inherited storage; undefined retains the native
 * export. Each lease keeps the actual exporting guest object alive. */
export function createRuntimeNativeBuffers(meter:ExecutionMeter,extension?:RuntimeBufferContext):RuntimeBufferContext {
  // Invocation contexts retain this adapter and its exporter closures before
  // acquiring any bytes. Admit that storage before publishing the capability.
  meter.checkpoint(1,256);
  const native=(source:RuntimeValue):RuntimeBufferLease|undefined=>{
    const bytes=runtimeBytesPayload(source);
    if(bytes===undefined)return undefined;
    meter.checkpoint(1,96);
    let retained:ImmutableBytes|undefined=bytes.value;
    return {object:source,byteLength:retained.length,copy(){meter.checkpoint();if(retained===undefined)throw Error("buffer lease was released");return retained;},release(){retained=undefined;}};
  };
  const acquireExport=(source:RuntimeValue,full:boolean):RuntimeBufferLease|undefined=>{
    let lease:RuntimeBufferLease|undefined;
    try {
      lease=full&&extension?.acquireFull!==undefined?extension.acquireFull(source):extension?.acquireSimple(source);
      // Exporters may enter guest code or explicit services. Do not transfer
      // ownership or fall back to native storage after terminal cancellation.
      meter.checkpoint();
      return lease??native(source);
    }catch(error){
      lease?.release();
      if(!(error instanceof ExecutionLimitError))meter.checkpoint();
      throw error;
    }
  };
  return {
    ...(extension?.createReadOnlyView===undefined?{}:{
      createReadOnlyView(bytes:ImmutableBytes){
        let fatal=false;
        try {
          meter.checkpoint();
          // Text and source decoders need the provider's ownerless guest view.
          // Preserve its receiver and immutable storage; the provider owns the
          // view protocol and lifetime, while this boundary owns termination.
          return extension.createReadOnlyView!(bytes);
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally {if(!fatal)meter.checkpoint();}
      }
    }),
    typeName(source){
      let fatal=false;
      try {
        meter.checkpoint();
        return extension?.typeName?.(source)??(source.kind==="instance"?source.type.value.diagnosticName:source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind);
      }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      // Diagnostic services have the same termination boundary as exporters:
      // cancellation wins over an ordinary return/failure, but a fatal service
      // failure must retain identity without another checkpoint.
      finally {if(!fatal)meter.checkpoint();}
    },
    acquireSimple:source=>{
      meter.checkpoint();
      return source.kind==="bytes"?native(source):acquireExport(source,false);
    },
    acquireFull:source=>{
      meter.checkpoint();
      return source.kind==="bytes"?native(source):acquireExport(source,true);
    }
  };
}
