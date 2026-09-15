import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {RuntimeHashError} from "./runtime-hash-error.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeNativeRepresentation} from "./runtime-native-representation-method.js";
import {runtimeReceiverComparison} from "./runtime-receiver-comparison.js";
import {runtimeIndex} from "./runtime-index.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {runtimeMembership} from "./runtime-membership.js";
import {createRuntimeNativeFormatMethod} from "./runtime-native-format-method.js";
import type {RuntimeValues,TypeValue} from "./runtime-values.js";

const unaryAndSequenceSlots=[["__str__","Return str(self)."],["__repr__","Return repr(self)."],["__hash__","Return hash(self)."],
  ["__len__","Return len(self)."],["__iter__","Implement iter(self)."],["__contains__","Return bool(key in self)."],["__getitem__","Return self[key]."]] as const;
const comparisonSlots=[["__eq__","=="],["__ne__","!="],["__lt__","<"],["__le__","<="],["__gt__",">"],["__ge__",">="]] as const;
/** Only published descriptors require canonical type lookup. Other exact string
 * methods still use their existing bound-method capabilities. */
export const runtimeStringSlotNames:ReadonlySet<string>=new Set([...unaryAndSequenceSlots.map(([name])=>name),...comparisonSlots.map(([name])=>name),"__format__"]);

/** Native str slots inspect immutable payloads, leaving subtype overrides to
 * ordinary MRO dispatch. Hashing and index conversions remain execution-owned. */
export function installRuntimeStringSlots(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const [name,doc] of unaryAndSequenceSlots){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        let fatal=false;
        try {
          meter.checkpoint();
          if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
          const count=name==="__contains__"||name==="__getitem__"?1:0;
          if(positional.length!==count)throw new PythonRuntimeError("TypeError",`expected ${count} argument${count===1?"":"s"}, got ${positional.length}`);
          const payload=runtimeStringPayload(receiver)!;
          if(name==="__str__"&&receiver.kind==="instance")return values.stringPoints(payload.value);
          if(name==="__str__"||name==="__repr__")return runtimeNativeRepresentation(payload,name,values,meter);
          if(name==="__len__")return values.integer(payload.value.length);
          if(name==="__iter__")return values.iterator(runtimeIterate(payload,values,meter));
          if(name==="__getitem__"){
            const result=runtimeIndex(payload,positional[0],values,meter,invocation?.integerIndex);
            return receiver.kind==="instance"&&result===payload?values.stringPoints(payload.value):result;
          }
          if(name==="__contains__")return runtimeMembership("in",positional[0],payload,values,meter,undefined,invocation);
          if(invocation?.nativeHash===undefined)throw Error("string hashing requires a native hash policy");
          try{return values.integer(invocation.nativeHash(payload));}
          catch(error){throw error instanceof RuntimeHashError?error.original:error;}
        } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally{if(!fatal)meter.checkpoint();}
      }
    }));
  }
  for(const [name,operator] of comparisonSlots){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:`Return self${operator}value.`,accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        return runtimeReceiverComparison(operator,runtimeStringPayload(receiver)!,runtimeStringPayload(positional[0])??positional[0],values,meter,undefined,invocation);
      }
    }));
  }
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__format__"),values.methodDescriptor({owner,name:"__format__",accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation){
      const method=createRuntimeNativeFormatMethod(runtimeStringPayload(receiver)!,values,meter,invocation?.formatting);
      return method.value.invoke(positional,keywords,meter,invocation);
    }
  }));
}
