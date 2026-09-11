import { LexicalFrame } from "./lexical-frame.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeCompiledCode } from "./runtime-code.js";
import type { RuntimeFrame } from "./runtime-program.js";
import type { RuntimeValues, TypeValue, RuntimeValue } from "./runtime-values.js";

/** Shared immutable frame/code reflection for suspended Python body kinds.
 * Publication is lazy. A finished body retains code, never its former frame. */
export function installRuntimeSuspensionMetadata(owner:TypeValue,prefix:"gi"|"cr"|"ag",values:RuntimeValues,meter:ExecutionMeter,
  publishFrame:(frame:RuntimeFrame)=>RuntimeValue,publishCode:(code:RuntimeCompiledCode)=>RuntimeValue):void {
  for(const field of ["frame","code"] as const){
    meter.checkpoint(0,96);const name=`${prefix}_${field}`;
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,
      accepts:value=>value.kind==="instance"&&value.type===owner&&value.native?.kind===owner.value.name,
      get(receiver,meter){
        meter.checkpoint();
        const state=receiver.kind==="instance"?receiver.native:undefined;
        if(state?.kind!=="generator"&&state?.kind!=="coroutine"&&state?.kind!=="async_generator")throw Error("suspension metadata requires native storage");
        if(field==="code"){
          if(state.code===undefined)throw Error("suspension code reflection requires compiled metadata");
          return publishCode(state.code);
        }
        if(state.execution.phase==="closed")return values.none;
        const frame=state.execution.frame;
        if(!(frame instanceof LexicalFrame))throw Error("suspension frame reflection requires a lexical activation");
        return publishFrame(frame);
      }
    }));
  }
}
