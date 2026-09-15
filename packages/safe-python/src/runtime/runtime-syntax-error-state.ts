import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { collectIterator } from "./iterator-collection.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Location members are native object references, independent of args and the
 * guest dictionary. Detail collection precedes location writes; a five-item
 * detail sequence fails only after those writes. No callback effects roll back. */
export function installSyntaxErrorState(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  meter.checkpoint(0,256);
  const fields=["filename","lineno","offset","text","end_lineno","end_offset","_metadata"] as const;
  const accepts=(value:RuntimeValue,meter:ExecutionMeter)=>{
    if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
    for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
    return false;
  };
  for(const name of ["msg",...fields,"print_file_and_line"]) {
    meter.checkpoint(0,96);
    const label=name==="_metadata"?"private metadata":name.replaceAll("_"," ");
    owner.value.namespace.items.set(values.string(name),values.memberDescriptor({owner,name,doc:`exception ${label}`,accepts,
      get(value,meter){return runtimeExceptionPayload(value)!.member(name,meter)??values.none;},
      set(value,input,meter){runtimeExceptionPayload(value)!.assignMember(name,input,meter);},
      delete(value,meter){runtimeExceptionPayload(value)!.assignMember(name,undefined,meter);}
    }));
  }
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts,
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("syntax exception initialization requires an instance");
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(receiver.type.value.name,meter)}() takes no keyword arguments`);
      const storage=runtimeExceptionPayload(receiver)!;
      storage.assignArgs(values.tuple(positional),meter);
      if(positional.length)storage.assignMember("msg",positional[0],meter);
      if(positional.length!==2)return values.none;
      const source=positional[1],details=source.kind==="tuple"?source.items:source.kind==="list"?source.items.snapshot():collectIterator(runtimeIterate(source,values,meter,invocation?.iteration),meter);
      if(details.length<4)throw new PythonRuntimeError("TypeError",`function takes at least 4 arguments (${details.length} given)`);
      if(details.length>7)throw new PythonRuntimeError("TypeError",`function takes at most 7 arguments (${details.length} given)`);
      storage.assignMember("end_lineno",undefined,meter);storage.assignMember("end_offset",undefined,meter);storage.assignMember("_metadata",undefined,meter);
      for(let index=0;index<details.length;index++){meter.checkpoint();storage.assignMember(fields[index],details[index],meter);}
      if(details.length===5)throw new PythonRuntimeError("TypeError","end_offset must be provided when end_lineno is provided");
      return values.none;
    }
  }));
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__str__"),values.wrapperDescriptor({owner,name:"__str__",doc:"Return str(self).",accepts,
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","wrapper __str__() takes no keyword arguments");
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
      const storage=runtimeExceptionPayload(receiver)!;
      const context=invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("syntax exception formatting requires a representation policy");}});
      const file=storage.member("filename",meter),line=storage.member("lineno",meter);
      const filename=file===undefined?undefined:context.string(file);
      let basename=filename;
      if(filename!==undefined) {
        let offset=0,index=0;
        for(const point of filename){meter.checkpoint();if(point===47)offset=index+1;index++;}
        if(offset)basename=filename.slice(BigInt(offset),null,null,meter);
      }
      // CPython uses exact integers and a signed native long; overflow prints -1.
      const lineno=line?.kind==="int"?(line.value<-(1n<<63n)||line.value>=(1n<<63n)?-1n:line.value):undefined;
      const message=representationObject(storage.member("msg",meter)??values.none,"str",context,meter);
      if(basename===undefined&&lineno===undefined)return message;
      let text=context.string(message)!;
      text=text.concat(values.string(basename===undefined?" (line ":" (").value,meter);
      if(basename!==undefined)text=text.concat(basename,meter);
      if(lineno!==undefined) {
        if(basename!==undefined)text=text.concat(values.string(", line ").value,meter);
        meter.checkpoint(0,64);text=text.concat(values.string(lineno.toString()).value,meter);
      }
      return values.stringPoints(text.concat(values.string(")").value,meter));
    }
  }));
}
