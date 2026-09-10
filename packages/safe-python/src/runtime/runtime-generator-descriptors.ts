import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue,RuntimeValues,TypeValue } from "./runtime-values.js";

/** Exact native generator slots use ordinary instance descriptor dispatch.
 * Throw normalization, frame/code metadata and finalization are separate work. */
export function installRuntimeGeneratorDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  meter.checkpoint(0,256);
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="generator";
  for(const name of ["__iter__","__next__","send","close"] as const) {
    meter.checkpoint(0,96);
    const descriptor={owner,name,accepts,
      invoke(receiver:RuntimeValue,positional:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter) {
        meter.checkpoint();
        if(receiver.kind!=="instance"||receiver.native?.kind!=="generator")throw Error("generator descriptor requires native generator storage");
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`wrapper ${name}() takes no keyword arguments`:`generator.${name}() takes no keyword arguments`);
        const count=name==="send"?1:0;
        if(positional.length!==count)throw new PythonRuntimeError("TypeError",name.startsWith("__")?`expected ${count} arguments, got ${positional.length}`:`generator.${name}() takes ${count===0?"no arguments":"exactly one argument"} (${positional.length} given)`);
        if(name==="__iter__")return receiver;
        const state=receiver.native;
        const result=state.execution.resume(name==="close"?{kind:"close"}:{kind:"send",value:name==="send"?positional[0]:values.none});
        if(result.done&&name!=="close")throw state.exceptions.completion(result.value);
        return result.value;
      }
    };
    owner.value.namespace.items.set(values.string(name),name.startsWith("__")?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
  for(const name of ["gi_running","gi_suspended"] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts,
      get(receiver,meter) {
        meter.checkpoint();
        if(receiver.kind!=="instance"||receiver.native?.kind!=="generator")throw Error("generator state requires native generator storage");
        return values.boolean(receiver.native.execution.phase===(name==="gi_running"?"running":"suspended"));
      }
    }));
  }
}
