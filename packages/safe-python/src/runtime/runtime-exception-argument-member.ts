import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export interface ExceptionArgumentMember {
  readonly name:string;
  readonly doc:string;
  /** First-argument fields clear on empty initialization; all-argument fields
   * retain their prior value when called without arguments. */
  readonly arguments:"first"|"all";
}

export function installExceptionArgumentMember(owner:TypeValue,spec:ExceptionArgumentMember,values:RuntimeValues,meter:ExecutionMeter):void {
  const accepts=(value:RuntimeValue,meter:ExecutionMeter)=>{
    if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
    for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
    return false;
  };
  meter.checkpoint(0,192);
  owner.value.namespace.items.set(values.string(spec.name),values.memberDescriptor({owner,name:spec.name,doc:spec.doc,accepts,
    get(value,meter){return runtimeExceptionPayload(value)!.member(spec.name,meter)??values.none;},
    set(value,input,meter){runtimeExceptionPayload(value)!.assignMember(spec.name,input,meter);},
    delete(value,meter){runtimeExceptionPayload(value)!.assignMember(spec.name,undefined,meter);}
  }));
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts,
    invoke(receiver,positional,keywords,meter) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("exception initialization requires an instance");
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(receiver.type.value.name,meter)}() takes no keyword arguments`);
      const args=values.tuple(positional),storage=runtimeExceptionPayload(receiver)!;
      storage.assignArgs(args,meter);
      if(args.items.length!==0||spec.arguments==="first")storage.assignMember(spec.name,args.items.length===0?undefined:spec.arguments==="all"&&args.items.length>1?args:args.items[0],meter);
      return values.none;
    }
  }));
}
