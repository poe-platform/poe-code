import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComplexPayload } from "./runtime-complex-payload.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimePowerSlot } from "./runtime-power.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { complexMagnitude } from "./complex-magnitude.js";
import { hashReal } from "./real-comparison.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { RuntimeValues,TypeValue } from "./runtime-values.js";

/** Complex slots inspect native storage, not conversion methods. The numeric
 * dispatcher remains responsible for reflected/subclass precedence. */
export function installRuntimeComplexSlots(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const [name,doc] of [["__pos__","+self"],["__neg__","-self"],["__abs__","abs(self)"],["__bool__","True if self else False"],["__repr__","Return repr(self)."],["__hash__","Return hash(self)."]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,accepts:receiver=>runtimeComplexPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
        const payload=runtimeComplexPayload(receiver)!;
        if(name==="__bool__")return values.boolean(payload.real!==0||payload.imaginary!==0);
        if(name==="__neg__")return values.complex(-payload.real,-payload.imaginary);
        if(name==="__abs__")return values.float(complexMagnitude(payload.real,payload.imaginary,meter));
        if(name==="__repr__")return runtimeNativeRepresentation(payload,name,values,meter,invocation);
        if(name==="__hash__") {
          if(receiver.kind!=="complex"&&(Number.isNaN(payload.real)||Number.isNaN(payload.imaginary))) {
            if(invocation?.identityHash===undefined)throw Error("owned complex NaN hashing requires an identity hash policy");
            const identity=invocation.identityHash(receiver);meter.checkpoint(1,128);
            const hash=BigInt.asIntN(64,(hashReal(payload.real)??identity)+1000003n*(hashReal(payload.imaginary)??identity));
            return values.integer(hash===-1n?-2n:hash);
          }
          if(invocation?.nativeHash===undefined)throw Error("complex hashing requires a native hash policy");
          let hash:bigint;try{hash=invocation.nativeHash(payload);}catch(error){throw error instanceof RuntimeHashError?error.original:error;}
          meter.checkpoint();return values.integer(hash);
        }
        return receiver.kind==="complex"?receiver:values.complex(payload.real,payload.imaginary);
      }
    }));
  }
  for(const [name,operator] of [["__eq__","=="],["__ne__","!="],["__lt__","<"],["__le__","<="],["__gt__",">"],["__ge__",">="]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:`Return self${operator}value.`,accepts:receiver=>runtimeComplexPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        const other=runtimeComplexPayload(positional[0])??runtimeFloatPayload(positional[0])??runtimeIntegerPayload(positional[0])??positional[0];
        return runtimeReceiverComparison(operator,runtimeComplexPayload(receiver)!,other,values,meter,undefined,invocation);
      }
    }));
  }
  for(const [suffix,operator] of [["add","+"],["sub","-"],["mul","*"],["truediv","/"],["pow","**"]] as const)for(const reflected of [false,true]) {
    const name=`__${reflected?"r":""}${suffix}__`,first=reflected?"value":"self",second=reflected?"self":"value";
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:operator==="**"?`Return pow(${first}, ${second}, mod).`:`Return ${first}${operator}${second}.`,accepts:receiver=>runtimeComplexPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(operator==="**") {if(positional.length<1||positional.length>2)throw new PythonRuntimeError("TypeError",`expected 1 or 2 arguments, got ${positional.length}`);}
        else if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        const payload=runtimeComplexPayload(receiver)!,other=runtimeComplexPayload(positional[0])??runtimeFloatPayload(positional[0])??runtimeIntegerPayload(positional[0]);
        if(other===undefined)return values.notImplemented;
        const left=reflected?other:payload,right=reflected?payload:other;
        if(operator==="**")return runtimePowerSlot(payload,left,right,positional[1]??values.none,values,meter);
        return runtimeBinary(operator,left,right,values,meter);
      }
    }));
  }
}
