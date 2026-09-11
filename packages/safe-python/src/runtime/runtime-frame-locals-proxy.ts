import type {FrameLocalsMapping} from "./frame-locals-mapping.js";
import type {LexicalFrame} from "./lexical-frame.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {runtimeDictionaryStorage} from "./runtime-dictionary-storage.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import {PythonKeyError,runtimeDictionaryAccess} from "./runtime-dictionary-access.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeIterate} from "./runtime-iteration.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export interface RuntimeFrameLocalsProxyState {
  readonly kind:"frame_locals_proxy";
  readonly mapping:FrameLocalsMapping<RuntimeValue,RuntimeValue>;
  readonly frame:LexicalFrame<RuntimeValue>;
  readonly keys:KeyOperations<RuntimeValue>;
}

function getLocal(state:RuntimeFrameLocalsProxyState,key:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):RuntimeValue {
  const found=state.mapping.lookup(key);if(found!==undefined)return found.value;
  if(invocation?.formatting===undefined)throw Error("frame locals missing-key diagnostics require representation");
  const rendered=representationObject(key,"repr",invocation.formatting,meter),text=invocation.formatting.string(rendered)!;
  const message=values.string("local variable '").value.concat(text,meter).concat(values.string("' is not defined").value,meter);
  throw new PythonKeyError(values.stringPoints(message),meter);
}

function copyLocals(state:RuntimeFrameLocalsProxyState,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext){
  const result=values.dictionary(new OrderedKeyMap(state.keys,meter,runtimeDictionaryStorage));
  // copy()/dict(proxy) acquire keys first and then perform live item lookups.
  for(const [key] of state.mapping.entries()){
    meter.checkpoint();runtimeDictionaryAccess(result,key,{kind:"set",value:getLocal(state,key,values,meter,invocation)},meter);
  }
  return result;
}

export function installRuntimeFrameLocalsProxyDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  owner.value.namespace.items.set(values.string("__hash__"),values.none);
  const methods=["__getitem__","__setitem__","__delitem__","__contains__","__len__","__iter__","__eq__","__ne__","keys","values","items","copy","get","__reversed__"] as const;
  for(const name of methods){
    meter.checkpoint(0,96);
    const wrapper=name.startsWith("__")&&name!=="__getitem__"&&name!=="__contains__"&&name!=="__reversed__";
    const descriptor={owner,name,accepts:(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="frame_locals_proxy",
      invoke(receiver:RuntimeValue,args:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):RuntimeValue {
        meter.checkpoint();
        try {
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",wrapper?`wrapper ${name}() takes no keyword arguments`:`FrameLocalsProxy.${name}() takes no keyword arguments`);
        const count=name==="__setitem__"?2:["__getitem__","__delitem__","__contains__","__eq__","__ne__"].includes(name)?1:0;
        if(name==="get"){
          if(args.length<1||args.length>2)throw new PythonRuntimeError("TypeError","get expected 1 or 2 arguments");
        }else if(args.length!==count)throw new PythonRuntimeError("TypeError",wrapper?`${name==="__setitem__"?"__setitem__ ":""}expected ${count} argument${count===1?"":"s"}, got ${args.length}`:`FrameLocalsProxy.${name}() takes ${count===1?"exactly one argument":"no arguments"} (${args.length} given)`);
        if(receiver.kind!=="instance"||receiver.native?.kind!=="frame_locals_proxy")throw Error("frame locals proxy requires native storage");
        const state=receiver.native,mapping=state.mapping;
        if(name==="__getitem__")return getLocal(state,args[0],values,meter,invocation);
        if(name==="get"){
          try{return getLocal(state,args[0],values,meter,invocation);}
          catch(error){meter.checkpoint();if(runtimeExceptionMatches(error,"KeyError",invocation))return args[1]??values.none;throw error;}
        }
        if(name==="__setitem__"){mapping.set(args[0],args[1]);return values.none;}
        if(name==="__delitem__"){if(!mapping.delete(args[0]))throw new PythonKeyError(args[0],meter);return values.none;}
        if(name==="__contains__")return values.boolean(mapping.lookup(args[0])!==undefined);
        if(name==="__len__")return values.integer(mapping.size);
        if(name==="copy")return copyLocals(state,values,meter,invocation);
        if(name==="__eq__"||name==="__ne__"){
          const other=args[0];
          if(other.kind==="instance"&&other.native?.kind==="frame_locals_proxy")return values.boolean((state.frame===other.native.frame)===(name==="__eq__"));
          if(runtimeDictionaryPayload(other)===undefined)return values.notImplemented;
          if(!invocation?.compare)throw Error("frame locals comparison requires comparison capability");
          return invocation.compare(name==="__eq__"?"==":"!=",copyLocals(state,values,meter,invocation),other);
        }
        const entries=mapping.entries();meter.checkpoint(0,32+entries.length*8);
        const items=entries.map(([key,value])=>{meter.checkpoint();return name==="values"?value:name==="items"?values.tuple([key,value]):key;});
        if(name==="__reversed__")items.reverse();
        const list=values.list(items);
        return name==="__iter__"?values.iterator(runtimeIterate(list,values,meter,invocation?.iteration,undefined,false),"list_iterator"):list;
        // Direct native calls must observe termination even when callbacks fail.
        } finally {meter.checkpoint();}
      }
    };
    owner.value.namespace.items.set(values.string(name),wrapper?values.wrapperDescriptor(descriptor):values.methodDescriptor(descriptor));
  }
}
