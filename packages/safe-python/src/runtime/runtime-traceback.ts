import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeFrame} from "./runtime-program.js";
import type {Traceback} from "./traceback.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export interface RuntimeTracebackState {
  readonly kind:"traceback";
  readonly traceback:Traceback<RuntimeFrame>;
  /** Interpreter code-location capability, never a host stack inspection. */
  readonly resolveLine:(frame:RuntimeFrame,instruction:number)=>number|null;
}

export function installRuntimeTracebackDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,
  frame:(frame:RuntimeFrame)=>RuntimeValue,
  expose:(traceback:Traceback<RuntimeFrame>,resolveLine:RuntimeTracebackState["resolveLine"])=>RuntimeValue):void {
  for(const name of ["tb_frame","tb_lasti","tb_lineno","tb_next"] as const){
    meter.checkpoint(0,96);
    const capability={owner,name,
      accepts:(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="traceback",
      get(receiver:RuntimeValue,meter:ExecutionMeter):RuntimeValue {
        meter.checkpoint();
        if(receiver.kind!=="instance"||receiver.native?.kind!=="traceback")throw Error("traceback descriptor requires native storage");
        const state=receiver.native,tb=state.traceback;
        try {
          if(name==="tb_frame")return frame(tb.frame);
          if(name==="tb_lasti")return values.integer(tb.lastInstruction);
          if(name==="tb_next")return tb.next===null?values.none:expose(tb.next,state.resolveLine);
          const line=tb.lineNumber(state.resolveLine,meter);
          return line===null?values.none:values.integer(line);
        }finally{meter.checkpoint();}
      }
    };
    const descriptor=name==="tb_frame"||name==="tb_lasti"?values.memberDescriptor(capability):values.getsetDescriptor(name==="tb_lineno"?capability:{...capability,
      set(receiver,value,meter,invocation){
        meter.checkpoint();
        if(receiver.kind!=="instance"||receiver.native?.kind!=="traceback")throw Error("traceback descriptor requires native storage");
        try {
          if(value.kind==="none"){receiver.native.traceback.setNext(null,meter);return;}
          if(value.kind!=="instance"||value.native?.kind!=="traceback"){
            const name=invocation?.typeName?.(value)??(value.kind==="instance"?value.type.value.name:value.kind==="not-implemented"?"NotImplementedType":value.kind);
            meter.checkpoint(1,128+name.length*2);
            throw new PythonRuntimeError("TypeError",`expected traceback object, got '${name}'`);
          }
          receiver.native.traceback.setNext(value.native.traceback,meter);
        }finally{meter.checkpoint();}
      },
      delete(_receiver,meter){meter.checkpoint();throw new PythonRuntimeError("TypeError","can't delete tb_next attribute");}
    });
    owner.value.namespace.items.set(values.string(name),descriptor);
  }
}
