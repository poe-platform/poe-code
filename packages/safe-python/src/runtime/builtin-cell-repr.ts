import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValues,TypeValue,WrapperDescriptorValue} from "./runtime-values.js";

/** Cell repr inspects only intrinsic type metadata and opaque execution identities,
 * never the contents' representation. Self-referential cells need no recursion. */
export function createCellReprWrapper(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):WrapperDescriptorValue {
  meter.checkpoint(1,96);
  return values.wrapperDescriptor({owner,name:"__repr__",doc:"Return repr(self).",accepts:receiver=>receiver.kind==="cell",
    invoke(receiver,positional,keywords,meter,invocation){
      meter.checkpoint();
      try {
        if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __repr__() takes no keyword arguments");
        if(positional.length)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
        if(receiver.kind!=="cell")throw Error("cell representation requires cell storage");
        const content=receiver.value.content;
        meter.checkpoint();
        const identity=invocation?.identity??values.identity;
        const address=identity.id(receiver);meter.checkpoint();
        const hex=address.toString(16);meter.checkpoint(0,32+hex.length*2);
        let description="empty";
        if(content!==undefined){
          if(invocation?.actualType===undefined)throw Error("cell representation requires an actual type policy");
          const type=invocation.actualType(content.value);meter.checkpoint();
          const name=diagnosticTypeName(type.value.diagnosticName,meter,80);
          const address=identity.id(content.value);meter.checkpoint();
          const hex=address.toString(16);meter.checkpoint(0,64+2*(name.length+hex.length));
          description=`${name} object at 0x${hex}`;
        }
        meter.checkpoint(0,64+2*(hex.length+description.length));
        return values.string(`<cell at 0x${hex}: ${description}>`);
      } finally {meter.checkpoint();}
    }
  });
}
