import type {KeyOperations} from "./ordered-key-map.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {PythonRuntimeError} from "./error.js";
import {validateAttributeName} from "./attribute-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeUnionPayload} from "./runtime-union-state.js";
import {collectRuntimeTypeParameters} from "./runtime-type-parameters.js";
import type {TupleConstant} from "./constant-values.js";
import type {BuiltinInvocationContext,MethodDescriptorCapability,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Successful parameter discovery is cached per union; failing or cancelled
 * discovery leaves no partial result. Native type arguments bypass lookup. */
export function installRuntimeUnionMetadata(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>):void {
  meter.checkpoint(0,64);
  owner.value.namespace.items.set(values.string("__doc__"),values.string("Represent a union type\n\nE.g. for int | str"));
  const parameters=new WeakMap<RuntimeValue,TupleConstant<RuntimeValue>>();
  const getParameters=(receiver:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):TupleConstant<RuntimeValue>=>{
    meter.checkpoint();const cached=parameters.get(receiver);if(cached)return cached;
    const result=collectRuntimeTypeParameters(runtimeUnionPayload(receiver)!.args,values,meter,invocation);
    meter.checkpoint(0,48);parameters.set(receiver,result);return result;
  };
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__getattribute__"),values.wrapperDescriptor({owner,name:"__getattribute__",textSignature:"($self, name, /)",accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation){
      meter.checkpoint();
      if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __getattribute__() takes no keyword arguments");
      if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
      const key=positional[0];validateAttributeName(key,{typeName:invocation?.typeName,isString:value=>runtimeStringPayload(value)!==undefined},meter);
      let name="";
      for(const point of runtimeStringPayload(key)!.value){meter.checkpoint(1,point>0xffff?4:2);name+=String.fromCodePoint(point);}
      if(!invocation?.typeAttributeDefault||!invocation.objectAttributeDefault)throw Error("union attributes require attribute policies");
      try{
        meter.checkpoint(0,32);const lookupKey={value:key,hash:()=>keys.hash(key)};
        return name==="__module__"?invocation.typeAttributeDefault(owner,name,lookupKey):invocation.objectAttributeDefault(receiver,name,lookupKey);
      }finally{meter.checkpoint();}
    }
  }));
  for(const name of ["__name__","__qualname__","__origin__","__parameters__"] as const){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
      get(receiver,meter,invocation){meter.checkpoint();return name==="__origin__"?owner:name==="__parameters__"?getParameters(receiver,meter,invocation):values.string("Union");}
    }));
  }
  for(const name of ["__getitem__","__mro_entries__"] as const){
    meter.checkpoint(0,96);
    const capability:MethodDescriptorCapability={owner,name,doc:name==="__getitem__"?"Return self[key].":undefined,textSignature:name==="__getitem__"?"($self, key, /)":"($self, object, /)",accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",name==="__getitem__"?"wrapper __getitem__() takes no keyword arguments":"Union.__mro_entries__() takes no keyword arguments");
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",name==="__getitem__"?`expected 1 argument, got ${positional.length}`:`Union.__mro_entries__() takes exactly one argument (${positional.length} given)`);
        if(name==="__getitem__")getParameters(receiver,meter,invocation);
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
