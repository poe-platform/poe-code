import {PythonRuntimeError} from "./error.js";
import {validateAttributeName} from "./attribute-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeUnionPayload} from "./runtime-union-state.js";
import type {MethodDescriptorCapability,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Current operator unions contain real types only: parameter collection skips
 * their __parameters__ attributes. Checked typing construction/generic aliases
 * must extend this policy when non-type arguments are introduced. */
export function installRuntimeUnionMetadata(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__getattribute__"),values.wrapperDescriptor({owner,name:"__getattribute__",accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation){
      meter.checkpoint();
      if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __getattribute__() takes no keyword arguments");
      if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
      const key=positional[0];validateAttributeName(key,{typeName:invocation?.typeName},meter);
      let name="";
      if(key.kind==="str")for(const point of key.value){meter.checkpoint(1,point>0xffff?4:2);name+=String.fromCodePoint(point);}
      if(!invocation?.attribute||!invocation.objectAttributeDefault)throw Error("union attributes require attribute policies");
      try{return name==="__module__"?invocation.attribute(owner,name):invocation.objectAttributeDefault(receiver,name);}finally{meter.checkpoint();}
    }
  }));
  for(const name of ["__name__","__qualname__","__origin__","__parameters__"] as const){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
      get(_receiver,meter){meter.checkpoint();return name==="__origin__"?owner:name==="__parameters__"?values.tuple([]):values.string("Union");}
    }));
  }
  for(const name of ["__getitem__","__mro_entries__"] as const){
    meter.checkpoint(0,96);
    const capability:MethodDescriptorCapability={owner,name,doc:name==="__getitem__"?"Return self[key].":undefined,accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",name==="__getitem__"?"wrapper __getitem__() takes no keyword arguments":"Union.__mro_entries__() takes no keyword arguments");
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",name==="__getitem__"?`expected 1 argument, got ${positional.length}`:`Union.__mro_entries__() takes exactly one argument (${positional.length} given)`);
        if(!invocation?.formatting)throw Error("union diagnostics require formatting");
        try{
          const repr=representationObject(receiver,"repr",invocation.formatting,meter);let text="";
          for(const point of invocation.formatting.string(repr)!){meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}
          meter.checkpoint(0,128+text.length*2);
          throw new PythonRuntimeError("TypeError",name==="__getitem__"?`${text} is not a generic class`:`Cannot subclass ${text}`);
        }finally{meter.checkpoint();}
      }
    };
    owner.value.namespace.items.set(values.string(name),name==="__getitem__"?values.wrapperDescriptor(capability):values.methodDescriptor(capability));
  }
}
