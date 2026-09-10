import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Shared native Unicode-error layout. Initialization validates all arguments
 * before publishing fields, but args and guest callback effects remain visible
 * on failure. Numeric member assignment deliberately does not call __index__. */
export function unicodeErrorState(mode:"encode"|"decode"|"translate") {
  return (owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void=>{
    meter.checkpoint(0,192);
    const accepts=(value:RuntimeValue,meter:ExecutionMeter)=>{
      if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
      for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
      return false;
    };
    for(const name of ["encoding","object","start","end","reason"]) {
      meter.checkpoint(0,96);
      const numeric=name==="start"||name==="end";
      owner.value.namespace.items.set(values.string(name),values.memberDescriptor({owner,name,doc:`exception ${name}`,accepts,
        get(value,meter){return runtimeExceptionPayload(value)!.member(name,meter)??(numeric?values.integer(0):values.none);},
        set(value,input,meter){
          if(numeric) {
            const payload=runtimeIntegerPayload(input);
            if(payload===undefined)throw new PythonRuntimeError("TypeError","an integer is required");
            input=values.integer(runtimeSizeIndex(payload,meter));
          }
          runtimeExceptionPayload(value)!.assignMember(name,input,meter);
        },
        delete(value,meter){
          if(numeric)throw new PythonRuntimeError("TypeError","can't delete numeric/char attribute");
          runtimeExceptionPayload(value)!.assignMember(name,undefined,meter);
        }
      }));
    }
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts,
      invoke(receiver,positional,keywords,meter,invocation) {
        if(receiver.kind!=="instance")throw Error("Unicode exception initialization requires an instance");
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(receiver.type.value.name,meter)}() takes no keyword arguments`);
        const storage=runtimeExceptionPayload(receiver)!;
        storage.assignArgs(values.tuple(positional),meter);
        const count=mode==="translate"?4:5,shift=count-4;
        if(positional.length!==count)throw new PythonRuntimeError("TypeError",`function takes exactly ${count} arguments (${positional.length} given)`);
        const string=(index:number)=>{
          meter.checkpoint();const value=positional[index];
          if(value.kind!=="str"&&invocation?.formatting?.string(value)===undefined)throw new PythonRuntimeError("TypeError",`argument ${index+1} must be str, not ${diagnosticTypeName(value.kind==="none"?"None":invocation?.typeName?.(value)??value.kind,meter)}`);
          return value;
        };
        meter.checkpoint(0,64);
        const encoding=shift?string(0):undefined;
        let object=mode==="decode"?positional[shift]:string(shift);
        const start=runtimeSizeIndex(positional[shift+1],meter,invocation?.integerIndex),end=runtimeSizeIndex(positional[shift+2],meter,invocation?.integerIndex);
        const reason=string(shift+3);
        if(mode==="decode"&&object.kind!=="bytes"&&invocation?.bytes?.byteString(object)===undefined) {
          const lease=invocation?.buffers?.acquireSimple(object);
          if(lease===undefined) {
            const bytes=invocation?.bytes?.bufferBytes?.(object);
            if(bytes===undefined)throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${diagnosticTypeName(invocation?.typeName?.(object)??(object.kind==="none"?"NoneType":object.kind),meter)}'`);
            object=values.bytes(bytes);
          } else {
            try {object=values.bytes(lease.copy());}finally{lease.release();}
          }
        }
        if(encoding!==undefined)storage.assignMember("encoding",encoding,meter);
        storage.assignMember("object",object,meter);storage.assignMember("start",values.integer(start),meter);
        storage.assignMember("end",values.integer(end),meter);storage.assignMember("reason",reason,meter);
        return values.none;
      }
    }));
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string("__str__"),values.wrapperDescriptor({owner,name:"__str__",doc:"Return str(self).",accepts,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __str__() takes no keyword arguments");
        if(positional.length)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
        const storage=runtimeExceptionPayload(receiver)!;
        if(storage.member("object",meter)===undefined)return values.string("");
        const context=invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("Unicode exception formatting requires a representation policy");}});
        meter.checkpoint(0,64);
        const render=(name:string)=>{
          const value=storage.member(name,meter);
          return value===undefined?values.string("<NULL>").value:context.string(representationObject(value,"str",context,meter))!;
        };
        const reason=render("reason"),encoding=mode==="translate"?undefined:render("encoding");
        const object=storage.member("object",meter);
        if(object===undefined)throw new PythonRuntimeError("TypeError","UnicodeError 'object' attribute is not set");
        const bytes=mode==="decode"?(object.kind==="bytes"?object.value:invocation?.bytes?.byteString(object)):undefined;
        const text=mode==="decode"?undefined:context.string(object);
        const data=bytes??text;
        if(data===undefined)throw new PythonRuntimeError("TypeError",`UnicodeError 'object' attribute must be ${mode==="decode"?"a bytes":"a string"}`);
        const startValue=storage.member("start",meter),endValue=storage.member("end",meter);
        const start=startValue?.kind==="int"?startValue.value:0n,end=endValue?.kind==="int"?endValue.value:0n;
        const single=start>=0n&&start<BigInt(data.length)&&end>=0n&&end<=BigInt(data.length)&&end===start+1n;
        // Native ssize_t positions and Unicode scalars have bounded spelling.
        meter.checkpoint(0,512);
        let location:string;
        if(single) {
          const point=bytes===undefined?text!.codePointAt(start,meter):bytes.byteAt(start,meter);
          const hex=point.toString(16).padStart(bytes!==undefined||point<=255?2:point<=65535?4:8,"0");
          location=bytes!==undefined?`byte 0x${hex} in position ${start}: `:`character '\\${point<=255?"x":point<=65535?"u":"U"}${hex}' in position ${start}: `;
        } else location=`${mode==="decode"?"bytes":"characters"} in position ${start}-${BigInt.asIntN(64,end-1n)}: `;
        let result=encoding===undefined?values.string("can't translate ").value:values.string("'").value.concat(encoding,meter).concat(values.string(`' codec can't ${mode} `).value,meter);
        result=result.concat(values.string(location).value,meter).concat(reason,meter);
        return values.stringPoints(result);
      }
    }));
  };
}
