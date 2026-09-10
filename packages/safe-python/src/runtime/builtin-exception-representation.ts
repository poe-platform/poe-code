import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Capture native args before guest formatting can replace them. KeyError's
 * single argument uses repr, while ordinary exception strings use str. */
export function createExceptionRepresentationDescriptor(name:"__str__"|"__repr__",owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,singleArgument:"str"|"repr"="str",stringMember?:string):WrapperDescriptorValue {
  meter.checkpoint(0,96);
  return values.wrapperDescriptor({owner,name,doc:name==="__str__"?"Return str(self).":"Return repr(self).",
    accepts(value,meter) {
      if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
      for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
      if(receiver.kind!=="instance")throw Error("exception representation requires an instance");
      const args=runtimeExceptionPayload(receiver)!.args;
      const context=invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("exception formatting requires a representation policy");}});
      if(name==="__str__"&&stringMember!==undefined) {
        const text=runtimeExceptionPayload(receiver)!.member(stringMember,meter);
        if(text!==undefined&&(text.kind==="str"||context.string(text)!==undefined))return text;
      }
      if(name==="__str__")return args.items.length===0?values.string(""):representationObject(args.items.length===1?args.items[0]:args,args.items.length===1?singleArgument:"repr",context,meter);
      const type=receiver.type.value.name;meter.checkpoint(0,type.length*2);
      if(args.items.length===0)return values.string(`${type}()`);
      const contents=representationObject(args.items.length===1?args.items[0]:args,"repr",context,meter),text=context.string(contents)!;
      const result=args.items.length===1?values.string(`${type}(`).value.concat(text,meter).concat(values.string(")").value,meter):values.string(type).value.concat(text,meter);
      return values.stringPoints(result);
    }
  });
}
