import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { MethodDescriptorValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Attribute hooks see an empty list before native append; list overrides do
 * not participate and a setter need not retain the supplied list. */
export function createExceptionAddNoteDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):MethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.methodDescriptor({owner,name:"add_note",doc:"Add a note to the exception",accepts:receiver=>runtimeExceptionPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation,bound) {
      meter.checkpoint();
      const name=bound&&receiver.kind==="instance"?receiver.type.value.name:owner.value.name;
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}.add_note() takes no keyword arguments`);
      if(positional.length!==1)throw new PythonRuntimeError("TypeError",`${name}.add_note() takes exactly one argument (${positional.length} given)`);
      const note=positional[0];
      if(note.kind!=="str"&&invocation?.formatting?.string(note)===undefined) {
        const type=note.kind==="none"?"None":diagnosticTypeName(invocation?.typeName?.(note)??note.kind,meter,50);
        throw new PythonRuntimeError("TypeError",`add_note() argument must be str, not ${type}`);
      }
      if(!invocation?.attribute)throw Error("exception notes require an attribute policy");
      let notes:RuntimeValue;
      try {notes=invocation.attribute(receiver,"__notes__");}
      catch(error) {
        if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;
        if(!invocation.setAttribute)throw Error("exception notes require an attribute mutation policy");
        notes=values.list([]);
        invocation.setAttribute(receiver,"__notes__",notes);
      }
      const list=runtimeListPayload(notes);
      if(!list)throw new PythonRuntimeError("TypeError","Cannot add note: __notes__ is not a list");
      list.items.append(note);
      return values.none;
    }
  });
}
