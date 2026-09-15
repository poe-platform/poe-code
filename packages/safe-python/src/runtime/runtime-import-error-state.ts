import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { DictionaryValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Preserve dictionary identity unless native import metadata must be overlaid.
 * The message is reconstructed from args, not serialized as native state. */
export function installImportErrorStateDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__reduce__"),values.methodDescriptor({owner,name:"__reduce__",
    accepts(value,meter) {
      if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
      for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,_invocation,bound) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("import exception state requires an instance");
      const type=bound?receiver.type.value.name:owner.value.name;
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${type}.__reduce__() takes no keyword arguments`);
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`${type}.__reduce__() takes no arguments (${positional.length} given)`);
      const storage=runtimeExceptionPayload(receiver)!,original=receiver.state.dictionaryObject;
      let copy:DictionaryValue|undefined;
      for(const name of ["name","path","name_from"]) {
        const value=storage.member(name,meter);
        if(value===undefined)continue;
        copy??=values.dictionary(receiver.dictionary?.items.copy()??owner.value.namespace.items.emptyCopy());
        copy.items.set(values.string(name),value);
      }
      const state=copy??original;
      return state===undefined?values.tuple([receiver.type,storage.args]):values.tuple([receiver.type,storage.args,state]);
    }
  }));
}
