import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatFromHex } from "./float-from-hex.js";
import type { BuiltinFunctionValue, ClassMethodDescriptorValue, DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

function parseArguments(positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter, type = "float"): number {
  meter.checkpoint();
  if (keywords.items.size !== 0 || positional.length !== 1) {
    meter.checkpoint(0,128+type.length*2);
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${type}.fromhex() takes no keyword arguments`);
    throw new PythonRuntimeError("TypeError", `${type}.fromhex() takes exactly one argument (${positional.length} given)`);
  }
  const source = positional[0];
  if (source.kind !== "str") throw new PythonRuntimeError("TypeError", "bad argument type for built-in operation");
  return floatFromHex(source.value, meter);
}

/** Parse before invoking the bound class, preserving custom allocation results. */
export function createFloatFromhexDescriptor(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): ClassMethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.classMethodDescriptor({owner,name:"fromhex",doc:"Create a floating-point number from a hexadecimal string.\n\n>>> float.fromhex('0x1.ffffp10')\n2047.984375\n>>> float.fromhex('-0x1p-1074')\n-5e-324",
    accepts(receiver,meter) {
      if(receiver.kind!=="type")return false;
      for(const ancestor of receiver.value.mro){meter.checkpoint();if(ancestor===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,invocation) {
      if(receiver.kind!=="type")throw Error("float fromhex descriptor requires a bound type");
      const result=values.float(parseArguments(positional,keywords,meter,receiver.value.name));
      if(receiver===owner)return result;
      if(invocation===undefined)throw Error("float subclass hexadecimal construction requires an invocation policy");
      return invocation.call(receiver,[result]);
    }
  });
}

/** Legacy native attribute entry point without a canonical type registry. */
export function createRuntimeFloatFromhexMethod(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromhex",
    invoke(positional, keywords, meter) {
      return values.float(parseArguments(positional,keywords,meter));
    }
  });
}
