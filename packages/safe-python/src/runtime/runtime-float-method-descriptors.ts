import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { floatAsIntegerRatio, floatToInteger } from "./numeric-conversion.js";
import { floatHex } from "./float-hex.js";
import { floatRound } from "./rounding.js";
import { integerIndex } from "./index-protocol.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { createFloatFormatDescriptor } from "./builtin-float-format.js";
import { createFloatFromhexDescriptor } from "./runtime-float-fromhex-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native float members inspect owned storage directly. Conversions produce
 * base values without invoking subclass overrides. */
export function installRuntimeFloatMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  owner.value.namespace.items.set(values.string("fromhex"),createFloatFromhexDescriptor(owner,values,meter));
  owner.value.namespace.items.set(values.string("__format__"),createFloatFormatDescriptor(owner,values,meter));
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__round__"),values.methodDescriptor({owner,name:"__round__",doc:"Return the Integral closest to x, rounding half toward even.\n\nWhen an argument is passed, work like built-in round(x, ndigits).",accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","float.__round__() takes no keyword arguments");
      if(positional.length>1)throw new PythonRuntimeError("TypeError",`__round__ expected at most 1 argument, got ${positional.length}`);
      const digits=positional[0];
      const places=digits===undefined||digits.kind==="none"?undefined:invocation?.integerIndex===undefined?runtimeIntegerIndex(digits,meter):integerIndex(digits,invocation.integerIndex,meter);
      // Binary64 ratios and decimal factors have a fixed bounded size.
      meter.checkpoint(128,8192);
      const payload=runtimeFloatPayload(receiver)!;
      return places===undefined?values.integer(floatRound(payload.value)):values.float(floatRound(payload.value,places));
    }
  }));
  for (const [name,doc] of [["real","the real part of a complex number"],["imag","the imaginary part of a complex number"]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,doc,accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
      get(receiver,meter) {
        meter.checkpoint();
        if(name==="imag")return values.float(0);
        return receiver.kind==="float"?receiver:values.float(runtimeFloatPayload(receiver)!.value);
      }
    }));
  }
  for (const [name,doc] of [
    ["conjugate","Return self, the complex conjugate of any float."],
    ["as_integer_ratio","Return a pair of integers, whose ratio is exactly equal to the original float.\n\nThe ratio is in lowest terms and has a positive denominator.  Raise\nOverflowError on infinities and a ValueError on NaNs.\n\n>>> (10.0).as_integer_ratio()\n(10, 1)\n>>> (0.0).as_integer_ratio()\n(0, 1)\n>>> (-.25).as_integer_ratio()\n(-1, 4)"],
    ["is_integer","Return True if the float is an integer."],
    ["hex","Return a hexadecimal representation of a floating-point number.\n\n>>> (-0.1).hex()\n'-0x1.999999999999ap-4'\n>>> 3.14159.hex()\n'0x1.921f9f01b866ep+1'"],
    ["__trunc__","Return the Integral closest to x between 0 and x."],
    ["__floor__","Return the floor as an Integral."],
    ["__ceil__","Return the ceiling as an Integral."],
    ["__getnewargs__",undefined]
  ] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.methodDescriptor({owner,name,doc,accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`float.${name}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`float.${name}() takes no arguments (${positional.length} given)`);
        const payload=runtimeFloatPayload(receiver)!;
        if(name==="is_integer")return values.boolean(Number.isInteger(payload.value));
        if(name==="hex")return values.string(floatHex(payload.value,meter));
        if(name==="as_integer_ratio") {
          const ratio=floatAsIntegerRatio(payload.value,meter);
          return values.tuple([values.integer(ratio.numerator),values.integer(ratio.denominator)]);
        }
        if(name==="__getnewargs__")return values.tuple([values.float(payload.value)]);
        if(name==="conjugate")return receiver.kind==="float"?receiver:values.float(payload.value);
        meter.checkpoint(16,512);
        const rounded=name==="__floor__"?Math.floor(payload.value):name==="__ceil__"?Math.ceil(payload.value):payload.value;
        return values.integer(floatToInteger(rounded));
      }
    }));
  }
}
