import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeNativeAttribute} from "./runtime-native-attribute.js";
import {runtimeNativeRepresentation} from "./runtime-native-representation-method.js";
import {runtimeReceiverComparison} from "./runtime-receiver-comparison.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {RuntimeBytesIterator} from "./runtime-bytes-iterator.js";
import {runtimeIndex} from "./runtime-index.js";
import {runtimeMembership} from "./runtime-membership.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeBinary} from "./runtime-binary.js";
import {runtimeAddition} from "./runtime-addition.js";
import {runtimeBytesRepeat} from "./runtime-bytes-arithmetic.js";
import {RuntimeHashError} from "./runtime-hash-error.js";
import {bytesMetadata,bytesDocumentation,bytesMaketransDocumentation} from "./runtime-bytes-metadata.js";
import {createRuntimeBytesFromhexMethod} from "./runtime-bytes-fromhex-method.js";
import {createRuntimeBytesMaketransMethod} from "./runtime-bytes-maketrans-method.js";
import type {RuntimeValues,TypeValue} from "./runtime-values.js";

const comparisons=new Map([["__eq__","=="],["__ne__","!="],["__lt__","<"],["__le__","<="],["__gt__",">"],["__ge__",">="]]);

/** Publish native bytes methods over owned storage. Descriptors retain the real
 * receiver; kernels bypass subtype overrides only after descriptor validation. */
export function installRuntimeBytesDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  owner.value.namespace.items.set(values.string("__doc__"),values.string(bytesDocumentation));
  for(const [name,metadata] of Object.entries(bytesMetadata)){
    if(name==="__new__"||name==="__buffer__")continue;
    meter.checkpoint(1,128);
    if(name==="maketrans"){
      const implementation=createRuntimeBytesMaketransMethod(values,meter);
      owner.value.namespace.items.set(values.string(name),values.methodDecorator("staticmethod",values.builtinFunction({...implementation.value,staticOwner:owner,doc:bytesMaketransDocumentation,textSignature:"(frm, to, /)",invoke:(positional,keywords,meter,invocation)=>createRuntimeBytesMaketransMethod(values,meter,invocation?.buffers).value.invoke(positional,keywords,meter,invocation)})));
      continue;
    }
    if(name==="fromhex"){
      owner.value.namespace.items.set(values.string(name),values.classMethodDescriptor({owner,name,doc:metadata.doc!,textSignature:metadata.signature??undefined,accepts(receiver,meter){if(receiver.kind!=="type")return false;for(const ancestor of receiver.value.mro){meter.checkpoint();if(ancestor===owner.value)return true;}return false;},
        invoke(receiver,positional,keywords,meter,invocation){
          const result=createRuntimeBytesFromhexMethod(values,meter,invocation?.buffers).value.invoke(positional,keywords,meter,invocation);
          if(receiver===owner)return result;
          if(invocation===undefined)throw Error("bytes.fromhex requires an invocation context");
          return invocation.call(receiver,[result]);
        }}));continue;
    }
    const sequenceOperator=name==="__add__"?"+":name==="__mul__"||name==="__rmul__"?"*":undefined;
    const capability={owner,name,sequenceOperator,doc:metadata.doc!,textSignature:metadata.signature??undefined,accepts:receiver=>runtimeBytesPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        let fatal=false;
        try {
          meter.checkpoint();const original=runtimeBytesPayload(receiver)!;
          const payload=receiver.kind==="instance"?values.bytes(original.value):original;
          if(metadata.kind!=="wrapper_descriptor"&&name!=="__bytes__"&&name!=="__getnewargs__"){
            const method=runtimeNativeAttribute(payload,name,values,meter,undefined,invocation?.formatting,{
              integerIndex:invocation?.integerIndex,buffers:invocation?.buffers,bytes:invocation?.bytes,truth:invocation?.truth,
              iterate:source=>runtimeIterate(source,values,meter,invocation?.iteration)
            });
            if(method.kind!=="builtin_function_or_method")throw Error("native bytes method must be callable");
            const result=method.value.invoke(positional,keywords,meter,invocation);
            // Translation may reuse an unchanged exact receiver, but a subtype
            // must retain a fresh nonempty result, including a single byte.
            if(receiver.kind==="instance"&&name==="translate"&&result===payload){
              return values.bytes(original.value,original.value.length===0?"canonical":"fresh");
            }
            if(receiver.kind==="instance"&&(name==="partition"||name==="rpartition")&&result.kind==="tuple"){
              // An empty middle component identifies a missing separator.
              // Canonical empty/one-byte objects can also occur in matched
              // components, so payload identity cannot identify this case.
              const separator=runtimeBytesPayload(result.items[1]);
              if(separator?.value.length===0){
                const side=name==="partition"?0:2;
                return values.tuple(result.items.map((item,index)=>index===side?receiver:item));
              }
            }
            return result;
          }
          const comparison=comparisons.get(name);
          const count=comparison!==undefined||["__getitem__","__contains__","__add__","__mul__","__rmul__","__mod__","__rmod__"].includes(name)?1:0;
          if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",metadata.kind==="wrapper_descriptor"?`wrapper ${name}() takes no keyword arguments`:`bytes.${name}() takes no keyword arguments`);
          if(positional.length!==count)throw new PythonRuntimeError("TypeError",metadata.kind==="wrapper_descriptor"?`expected ${count} argument${count===1?"":"s"}, got ${positional.length}`:`bytes.${name}() takes no arguments (${positional.length} given)`);
          if(comparison!==undefined)return runtimeReceiverComparison(comparison,payload,runtimeBytesPayload(positional[0])??positional[0],values,meter,undefined,invocation);
          switch(name){
            case "__bytes__":return receiver.kind==="bytes"?receiver:values.bytes(payload.value);
            // Reconstruction copies even an exact receiver. Only the empty and
            // single-byte canonical objects can retain their identity.
            case "__getnewargs__":return values.tuple([values.bytes(payload.value)]);
            case "__repr__":case "__str__":return runtimeNativeRepresentation(payload,name,values,meter);
            case "__len__":return values.integer(payload.value.length);
            case "__iter__":return values.iterator(new RuntimeBytesIterator(receiver,values,meter),"bytes_iterator");
            case "__getitem__":return runtimeIndex(payload,positional[0],values,meter,invocation?.integerIndex);
            case "__contains__":return runtimeMembership("in",positional[0],payload,values,meter,undefined,invocation);
            case "__hash__":{
              if(invocation?.nativeHash===undefined)throw Error("bytes hash requires a hash policy");
              try{return values.integer(invocation.nativeHash(payload));}catch(error){throw error instanceof RuntimeHashError?error.original:error;}
            }
            case "__add__":return runtimeAddition(receiver,positional[0],values,meter,{},false,invocation?.buffers);
            case "__mul__":case "__rmul__":{
              return runtimeBytesRepeat(receiver,runtimeIntegerIndex(positional[0],meter,invocation?.integerIndex),values,meter);
            }
            case "__mod__":case "__rmod__":{
              const format=name==="__mod__"?payload:runtimeBytesPayload(positional[0]);
              return format===undefined?values.notImplemented:runtimeBinary("%",format,name==="__mod__"?positional[0]:receiver,values,meter,invocation?.iteration,invocation,invocation);
            }
          }
          throw Error(`unimplemented bytes slot ${name}`);
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}finally{if(!fatal)meter.checkpoint();}
      }
    } satisfies Parameters<RuntimeValues["methodDescriptor"]>[0];
    owner.value.namespace.items.set(values.string(name),metadata.kind==="wrapper_descriptor"?values.wrapperDescriptor(capability):values.methodDescriptor(capability));
  }
}
