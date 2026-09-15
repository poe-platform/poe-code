import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeDivmod } from "./runtime-divmod.js";
import { runtimePowerSlot } from "./runtime-power.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { floatToInteger } from "./numeric-conversion.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Float slots consume owned payloads while the dispatcher owns reflection and
 * subclass precedence. Integer operands retain exact comparison semantics. */
export function installRuntimeFloatSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  for (const [name,doc] of [["__pos__","+self"],["__neg__","-self"],["__abs__","abs(self)"],["__bool__","True if self else False"],["__float__","float(self)"],["__int__","int(self)"],["__repr__","Return repr(self)."],["__hash__","Return hash(self)."]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
        const payload=runtimeFloatPayload(receiver)!;
        if(name==="__bool__")return values.boolean(payload.value!==0);
        if(name==="__int__")return values.integer(floatToInteger(payload.value));
        if(name==="__repr__")return runtimeNativeRepresentation(payload,name,values,meter,invocation);
        if(name==="__hash__") {
          if(receiver.kind!=="float"&&Number.isNaN(payload.value)) {
            if(invocation?.identityHash===undefined)throw Error("owned NaN hashing requires an identity hash policy");
            const hash=invocation.identityHash(receiver);meter.checkpoint();return values.integer(hash);
          }
          if(invocation?.nativeHash===undefined)throw Error("float hashing requires a native hash policy");
          let hash:bigint;
          try{hash=invocation.nativeHash(payload);}catch(error){throw error instanceof RuntimeHashError?error.original:error;}
          meter.checkpoint();return values.integer(hash);
        }
        if(name==="__neg__")return values.float(-payload.value);
        if(name==="__abs__")return values.float(Math.abs(payload.value));
        return receiver.kind==="float"?receiver:values.float(payload.value);
      }
    }));
  }
  for(const [name,operator] of [["__eq__","=="],["__ne__","!="],["__lt__","<"],["__le__","<="],["__gt__",">"],["__ge__",">="]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:`Return self${operator}value.`,accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        const other=runtimeFloatPayload(positional[0])??runtimeIntegerPayload(positional[0])??positional[0];
        return runtimeReceiverComparison(operator,runtimeFloatPayload(receiver)!,other,values,meter,undefined,invocation);
      }
    }));
  }
  for(const [suffix,operator] of [["add","+"],["sub","-"],["mul","*"],["truediv","/"],["floordiv","//"],["mod","%"],["divmod","divmod()"],["pow","**"]] as const)for(const reflected of [false,true]) {
    const name=`__${reflected?"r":""}${suffix}__`,first=reflected?"value":"self",second=reflected?"self":"value";
    const doc=operator==="**"?`Return pow(${first}, ${second}, mod).`:operator==="divmod()"?`Return divmod(${first}, ${second}).`:`Return ${first}${operator}${second}.`;
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(operator==="**") {if(positional.length<1||positional.length>2)throw new PythonRuntimeError("TypeError",`expected 1 or 2 arguments, got ${positional.length}`);}
        else if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        const payload=runtimeFloatPayload(receiver)!,other=runtimeFloatPayload(positional[0])??runtimeIntegerPayload(positional[0]);
        const modulus=positional[1]??values.none;
        if(operator==="**"&&modulus.kind!=="none")return runtimePowerSlot(payload,payload,positional[0],modulus,values,meter);
        if(other===undefined)return values.notImplemented;
        const left=reflected?other:payload,right=reflected?payload:other;
        if(operator==="divmod()")return runtimeDivmod(left,right,values,meter);
        return runtimeBinary(operator,left,right,values,meter);
      }
    }));
  }
}
