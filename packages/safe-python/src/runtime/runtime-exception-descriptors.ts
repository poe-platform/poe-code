import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { installRuntimeExceptionLinkDescriptors } from "./runtime-exception-link-descriptors.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { RuntimeValues,TypeValue } from "./runtime-values.js";

/** Argument storage is captured before guest representation/iteration runs;
 * mutations through guest attributes cannot substitute for native args. */
export function installRuntimeExceptionDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  installRuntimeExceptionLinkDescriptors(owner,values,meter);
  meter.checkpoint(0,192);
  owner.value.namespace.items.set(values.string("args"),values.getsetDescriptor({owner,name:"args",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    get(value,meter){meter.checkpoint();return runtimeExceptionPayload(value)!.args;},
    set(value,input,meter,invocation) {
      const args=input.kind==="tuple"?input:values.tuple(collectIterator(runtimeIterate(input,values,meter,invocation?.iteration),meter));
      runtimeExceptionPayload(value)!.assignArgs(args,meter);
    },
    delete(){throw new PythonRuntimeError("TypeError","args may not be deleted");}
  }));
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    invoke(receiver,positional,keywords,meter) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("exception initializer requires an instance");
      if(keywords.items.size!==0){const name=diagnosticTypeName(receiver.type.value.name,meter);throw new PythonRuntimeError("TypeError",`${name}() takes no keyword arguments`);}
      runtimeExceptionPayload(receiver)!.assignArgs(values.tuple(positional),meter);
      return values.none;
    }
  }));
  for(const name of ["__str__","__repr__"] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:name==="__str__"?"Return str(self).":"Return repr(self).",accepts:value=>runtimeExceptionPayload(value)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
        if(receiver.kind!=="instance")throw Error("exception representation requires an instance");
        const args=runtimeExceptionPayload(receiver)!.args;
        const context=invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("exception formatting requires a representation policy");}});
        if(name==="__str__")return args.items.length===0?values.string(""):representationObject(args.items.length===1?args.items[0]:args,args.items.length===1?"str":"repr",context,meter);
        const type=receiver.type.value.name;meter.checkpoint(0,type.length*2);
        if(args.items.length===0)return values.string(`${type}()`);
        const contents=representationObject(args.items.length===1?args.items[0]:args,"repr",context,meter),text=context.string(contents)!;
        const result=args.items.length===1?values.string(`${type}(`).value.concat(text,meter).concat(values.string(")").value,meter):values.string(type).value.concat(text,meter);
        return values.stringPoints(result);
      }
    }));
  }
}
