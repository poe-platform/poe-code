import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeStringConcat,runtimeStringRepeat} from "./runtime-string-arithmetic.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeBinary} from "./runtime-binary.js";
import type {RuntimeValues,TypeValue} from "./runtime-values.js";

const slots=[["__add__","Return self+value.","+"],["__mul__","Return self*value.","*"],["__rmul__","Return value*self.","*"],
  ["__mod__","Return self%value.",undefined],["__rmod__","Return value%self.",undefined]] as const;
export const runtimeStringArithmeticSlotNames:ReadonlySet<string>=new Set(slots.map(([name])=>name));

/** Explicit sequence descriptors bypass reflected numeric negotiation. Percent
 * formatting retains the original operand so guest conversion overrides run. */
export function installRuntimeStringArithmeticSlots(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const [name,doc,sequenceOperator] of slots){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,sequenceOperator,accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        let fatal=false;
        try {
          meter.checkpoint();
          if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
          if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
          const operand=positional[0];
          if(name==="__add__"){
            const result=runtimeStringConcat(receiver,operand,values,meter);
            if(result!==values.notImplemented)return result;
            const type=invocation?.typeName?.(operand)??(operand.kind==="none"?"NoneType":operand.kind==="not-implemented"?"NotImplementedType":operand.kind);meter.checkpoint();
            throw new PythonRuntimeError("TypeError",`can only concatenate str (not "${diagnosticTypeName(type,meter,200)}") to str`);
          }
          if(name==="__mul__"||name==="__rmul__"){
            const count=runtimeIntegerIndex(operand,meter,invocation?.integerIndex);
            if(BigInt.asIntN(64,count)!==count){
              const type=invocation?.typeName?.(operand)??operand.kind;meter.checkpoint();
              throw new PythonRuntimeError("OverflowError",`cannot fit '${diagnosticTypeName(type,meter)}' into an index-sized integer`);
            }
            return runtimeStringRepeat(receiver,count,values,meter);
          }
          const format=name==="__mod__"?receiver:operand,payload=runtimeStringPayload(format);
          if(payload===undefined)return values.notImplemented;
          const result=runtimeBinary("%",payload,name==="__mod__"?operand:receiver,values,meter,invocation?.iteration,invocation,invocation);
          return format.kind==="instance"&&result===payload&&payload.value.length!==0?format:result;
        } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally{if(!fatal)meter.checkpoint();}
      }
    }));
  }
}
