import type {FrameLocalsMapping} from "./frame-locals-mapping.js";
import type {RuntimeFrame} from "./runtime-program.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {runtimeDictionaryStorage} from "./runtime-dictionary-storage.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import {PythonKeyError,runtimeDictionaryAccess} from "./runtime-dictionary-access.js";
import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {collectIterator} from "./iterator-collection.js";
import {ProtocolIterator} from "./protocol-iterator.js";
import {nativeIteratorLengthHint} from "./native-iterator-length-hint.js";
import {runtimeGetItem} from "./runtime-subscription.js";
import {runtimeDictionaryCopySource} from "./runtime-dictionary-copy-source.js";
import {mergeRuntimeMapping} from "./runtime-mapping-merge.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export interface RuntimeFrameLocalsProxyState {
  readonly kind:"frame_locals_proxy";
  readonly mapping:FrameLocalsMapping<RuntimeValue,RuntimeValue>;
  readonly frame:RuntimeFrame;
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

/** PyMapping_Keys keeps exact lists live but materializes other iterables before
 * writing. Unlike dict copy, frame updates always honor subclass keys/items. */
function mergeLocals(state:RuntimeFrameLocalsProxyState,source:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):void {
  let keys:RuntimeValue;
  if(source.kind==="dict")keys=values.list(collectIterator(source.items.iterate(key=>key),meter));
  else {
    if(!invocation?.attribute)throw Error("frame locals update requires attribute lookup");
    const method=invocation.attribute(source,"keys");meter.checkpoint();
    keys=invocation.call(method,[]);meter.checkpoint();
    if(keys.kind!=="list"){
      let iterator:Iterator<RuntimeValue>;
      try{iterator=runtimeIterate(keys,values,meter,invocation.iteration);}
      catch(error){
        meter.checkpoint();if(!runtimeExceptionMatches(error,"TypeError",invocation))throw error;
        const sourceName=diagnosticTypeName(invocation.typeName?.(source)??source.kind,meter,200),keysName=diagnosticTypeName(invocation.typeName?.(keys)??keys.kind,meter,200);
        throw new PythonRuntimeError("TypeError",`${sourceName}.keys() returned a non-iterable (type ${keysName})`);
      }
      meter.checkpoint();
      if(iterator instanceof ProtocolIterator){const original=iterator;iterator=original.reacquire();original.lengthHint(8n);}
      else nativeIteratorLengthHint(iterator,meter);
      keys=values.list(collectIterator(iterator,meter));
    }
  }
  const iterator=runtimeIterate(keys,values,meter);
  for(let next=iterator.next();!next.done;next=iterator.next()){
    meter.checkpoint();const value=runtimeGetItem(source,next.value,values,meter,invocation);meter.checkpoint();
    state.mapping.set(next.value,value);
  }
  meter.checkpoint();
}

export function installRuntimeFrameLocalsProxyDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  meter.checkpoint(0,64);const representing=new WeakSet<RuntimeValue>();
  owner.value.namespace.items.set(values.string("__hash__"),values.none);
  const methods=["__getitem__","__setitem__","__delitem__","__contains__","__len__","__iter__","__eq__","__ne__","keys","values","items","copy","get","setdefault","pop","__reversed__","update","__or__","__ror__","__ior__","__repr__"] as const;
  for(const name of methods){
    meter.checkpoint(0,96);
    const wrapper=name.startsWith("__")&&name!=="__getitem__"&&name!=="__contains__"&&name!=="__reversed__";
    const descriptor={owner,name,accepts:(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="frame_locals_proxy",
      invoke(receiver:RuntimeValue,args:readonly RuntimeValue[],keywords:Extract<RuntimeValue,{kind:"dict"}>,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):RuntimeValue {
        meter.checkpoint();
        try {
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",wrapper?`wrapper ${name}() takes no keyword arguments`:`FrameLocalsProxy.${name}() takes no keyword arguments`);
        const count=name==="__setitem__"?2:["__getitem__","__delitem__","__contains__","__eq__","__ne__","update","__or__","__ror__","__ior__"].includes(name)?1:0;
        if(name==="get"||name==="setdefault"||name==="pop"){
          if(args.length<1||args.length>2)throw new PythonRuntimeError("TypeError",name==="pop"?`pop expected at ${args.length<1?"least 1 argument":"most 2 arguments"}, got ${args.length}`:`${name} expected 1 or 2 arguments`);
        }else if(args.length!==count)throw new PythonRuntimeError("TypeError",wrapper?`${name==="__setitem__"?"__setitem__ ":""}expected ${count} argument${count===1?"":"s"}, got ${args.length}`:`FrameLocalsProxy.${name}() takes ${count===1?"exactly one argument":"no arguments"} (${args.length} given)`);
        if(receiver.kind!=="instance"||receiver.native?.kind!=="frame_locals_proxy")throw Error("frame locals proxy requires native storage");
        const state=receiver.native,mapping=state.mapping;
        if(name==="__repr__"){
          if(representing.has(receiver))return values.string("{...}");
          if(!invocation?.formatting)throw Error("frame locals representation requires formatting");
          meter.checkpoint(0,32);representing.add(receiver);
          try{return representationObject(copyLocals(state,values,meter,invocation),"repr",invocation.formatting,meter);}
          finally{representing.delete(receiver);}
        }
        if(name==="update"||name==="__or__"||name==="__ror__"||name==="__ior__"){
          const source=args[0],supported=runtimeDictionaryPayload(source)!==undefined||(source.kind==="instance"&&source.native?.kind==="frame_locals_proxy");
          if(!supported&&name!=="__ror__"){if(name!=="update")return values.notImplemented;throw new PythonRuntimeError("TypeError","update() argument must be dict or another FrameLocalsProxy");}
          if(name==="__or__"||name==="__ror__"){
            const result=values.dictionary(new OrderedKeyMap(state.keys,meter,runtimeDictionaryStorage));
            for(const operand of name==="__or__"?[receiver,source]:[source,receiver]){
              meter.checkpoint();const native=runtimeDictionaryCopySource(operand,values,meter,invocation);
              if(native!==undefined)result.items.update(native.items);
              else mergeRuntimeMapping(result,operand,values,meter,invocation,invocation?.iteration);
            }
            return result;
          }
          try{mergeLocals(state,source,values,meter,invocation);}
          catch(error){
            meter.checkpoint();
            if(!runtimeExceptionMatches(error,"BaseException",invocation)&&!(error instanceof PythonRuntimeError))throw error;
            meter.checkpoint();
            if(name==="update")throw new PythonRuntimeError("TypeError","update() argument must be dict or another FrameLocalsProxy");
            if(!invocation?.causeException)throw error;
            throw invocation.causeException(error,"SystemError","<slot wrapper '__ior__' of 'FrameLocalsProxy' objects> returned a result with an exception set");
          }
          return name==="update"?values.none:receiver;
        }
        if(name==="__getitem__")return getLocal(state,args[0],values,meter,invocation);
        if(name==="get"||name==="setdefault"){
          try{return getLocal(state,args[0],values,meter,invocation);}
          catch(error){
            meter.checkpoint();if(!runtimeExceptionMatches(error,"KeyError",invocation))throw error;
            meter.checkpoint();const fallback=args[1]??values.none;
            if(name==="setdefault")mapping.set(args[0],fallback);
            return fallback;
          }
        }
        if(name==="pop"){
          const found=mapping.pop(args[0]);if(found!==undefined)return found.value;
          if(args.length===2)return args[1];
          throw new PythonKeyError(args[0],meter);
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
