import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { roundRuntimeInteger } from "./runtime-integer-round.js";
import { integerIndex } from "./index-protocol.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { createIntegerFormatDescriptor } from "./builtin-integer-format.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Numeric members consume owned integer storage, never guest conversion slots. */
export function installRuntimeIntegerMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  owner.value.namespace.items.set(values.string("__format__"), createIntegerFormatDescriptor(owner, values, meter));
  meter.checkpoint(0, 96);
  owner.value.namespace.items.set(values.string("__round__"), values.methodDescriptor({ owner, name: "__round__", doc: "Rounding an Integral returns itself.\n\nRounding with an ndigits argument also returns an integer.", accepts: receiver => runtimeIntegerPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "int.__round__() takes no keyword arguments");
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `__round__ expected at most 1 argument, got ${positional.length}`);
      const digits = positional[0];
      const places = digits === undefined || digits.kind === "none" ? undefined : invocation?.integerIndex === undefined ? runtimeIntegerIndex(digits, meter) : integerIndex(digits, invocation.integerIndex, meter);
      return roundRuntimeInteger(receiver, places, values, meter);
    }
  }));
  for (const [name, doc] of [
    ["real", "the real part of a complex number"],
    ["imag", "the imaginary part of a complex number"],
    ["numerator", "the numerator of a rational number in lowest terms"],
    ["denominator", "the denominator of a rational number in lowest terms"]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.getsetDescriptor({ owner, name, doc, accepts: receiver => runtimeIntegerPayload(receiver) !== undefined,
      get(receiver, meter) {
        meter.checkpoint();
        if (name === "imag") return values.integer(0);
        if (name === "denominator") return values.integer(1);
        if (receiver.kind === "int") return receiver;
        const payload = runtimeIntegerPayload(receiver)!;
        return values.integer(payload.kind === "int" ? payload.value : payload.value ? 1n : 0n);
      }
    }));
  }
  for (const [name, doc] of [
    ["bit_length", "Number of bits necessary to represent self in binary.\n\n>>> bin(37)\n'0b100101'\n>>> (37).bit_length()\n6"],
    ["bit_count", "Number of ones in the binary representation of the absolute value of self.\n\nAlso known as the population count.\n\n>>> bin(13)\n'0b1101'\n>>> (13).bit_count()\n3"],
    ["as_integer_ratio", "Return a pair of integers, whose ratio is equal to the original int.\n\nThe ratio is in lowest terms and has a positive denominator.\n\n>>> (10).as_integer_ratio()\n(10, 1)\n>>> (-10).as_integer_ratio()\n(-10, 1)\n>>> (0).as_integer_ratio()\n(0, 1)"],
    ["conjugate", "Returns self, the complex conjugate of any int."],
    ["__trunc__", "Truncating an Integral returns itself."],
    ["__floor__", "Flooring an Integral returns itself."],
    ["__ceil__", "Ceiling of an Integral returns itself."],
    ["__getnewargs__", undefined],
    ["is_integer", "Returns True. Exists for duck type compatibility with float.is_integer."]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => runtimeIntegerPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `int.${name}() takes no keyword arguments`);
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `int.${name}() takes no arguments (${positional.length} given)`);
        if (name === "is_integer") return values.true;
        const payload = runtimeIntegerPayload(receiver)!;
        const integer = payload.kind === "int" ? payload.value : payload.value ? 1n : 0n;
        if (name === "bit_length" || name === "bit_count") return values.integer(integerBitMetric(integer, name, meter));
        const result = receiver.kind === "int" ? receiver : values.integer(integer);
        if (name === "as_integer_ratio") return values.tuple([result, values.integer(1)]);
        if (name === "__getnewargs__") return values.tuple([result]);
        return result;
      }
    }));
  }
}
