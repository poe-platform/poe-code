import { PythonRuntimeError } from "./error.js";
import { createExceptionAddNoteDescriptor } from "./builtin-exception-add-note.js";
import { createExceptionReduceDescriptor } from "./builtin-exception-reduce.js";
import { createExceptionSetstateDescriptor } from "./builtin-exception-setstate.js";
import { createInstanceDictionaryDescriptor } from "./runtime-instance-dictionary-descriptor.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { installRuntimeExceptionLinkDescriptors } from "./runtime-exception-link-descriptors.js";
import {installRuntimeExceptionTracebackDescriptors} from "./runtime-exception-traceback-descriptors.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { createExceptionRepresentationDescriptor } from "./builtin-exception-representation.js";
import type { RuntimeValues,TypeValue } from "./runtime-values.js";

/** Argument storage is captured before guest representation/iteration runs;
 * mutations through guest attributes cannot substitute for native args. */
export function installRuntimeExceptionDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  installRuntimeExceptionLinkDescriptors(owner,values,meter);
  installRuntimeExceptionTracebackDescriptors(owner,values,meter);
  owner.value.namespace.items.set(values.string("__setstate__"),createExceptionSetstateDescriptor(owner,values,meter));
  owner.value.namespace.items.set(values.string("__reduce__"),createExceptionReduceDescriptor(owner,values,meter));
  owner.value.namespace.items.set(values.string("__dict__"),createInstanceDictionaryDescriptor(owner,values,meter,{deleteError:"cannot delete __dict__"}));
  owner.value.namespace.items.set(values.string("add_note"),createExceptionAddNoteDescriptor(owner,values,meter));
  meter.checkpoint(0,192);
  owner.value.namespace.items.set(values.string("args"),values.getsetDescriptor({owner,name:"args",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    get(value,meter){meter.checkpoint();return runtimeExceptionPayload(value)!.args;},
    set(value,input,meter,invocation) {
      const args=input.kind==="tuple"?input:values.tuple(collectIterator(runtimeIterate(input,values,meter,invocation?.iteration),meter));
      runtimeExceptionPayload(value)!.assignArgs(args,meter);
    },
    delete(){throw new PythonRuntimeError("TypeError","args may not be deleted");}
  }));
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",textSignature:"($self, /, *args, **kwargs)",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    invoke(receiver,positional,keywords,meter) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("exception initializer requires an instance");
      if(keywords.items.size!==0){const name=diagnosticTypeName(receiver.type.value.name,meter);throw new PythonRuntimeError("TypeError",`${name}() takes no keyword arguments`);}
      runtimeExceptionPayload(receiver)!.assignArgs(values.tuple(positional),meter);
      return values.none;
    }
  }));
  for(const name of ["__str__","__repr__"] as const) {
    owner.value.namespace.items.set(values.string(name),createExceptionRepresentationDescriptor(name,owner,values,meter));
  }
}
