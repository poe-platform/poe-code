import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { percentCharacter, type PercentCharacterContext } from "./percent-character-conversion.js";
import { percentFloat, type PercentFloatContext } from "./percent-float-conversion.js";
import { percentInteger, type PercentIntegerContext } from "./percent-integer-conversion.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { unsupportedPercentConversion } from "./percent-format-error.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

export type TextPercentContext<Value> = PercentCharacterContext<Value> & PercentFloatContext<Value> & PercentIntegerContext<Value> & RepresentationContext<Value>;

/** Convert and render a bound text field, preserving unchanged representation
 * objects for the final percent wrapper's identity decisions. Binding must have
 * consumed the operand before dispatch (including unsupported conversions). */
export function textPercentField<Value>(field: Extract<BoundPercentFormatEvent<Value>, { kind: "conversion" }>, context: TextPercentContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  let storage: CodePointString;
  switch (field.code) {
    case 100: case 105: case 117: case 111: case 120: case 88:
      storage = CodePointString.fromIntegerPercentField(percentInteger(field.argument, field.code, context, meter), field, meter);
      break;
    case 101: case 69: case 102: case 70: case 103: case 71:
      storage = CodePointString.fromFloatPercentField(percentFloat(field.argument, false, context, meter), field, meter);
      break;
    case 99: {
      const point = percentCharacter(field.argument, false, context, meter);
      meter.checkpoint(0, Uint32Array.BYTES_PER_ELEMENT);
      storage = new CodePointString(Uint32Array.of(point), meter).formatField(field.width, null, field.flags.left ? "left" : "right", 32, meter);
      break;
    }
    case 115: case 114: case 97: {
      const value = representationObject(field.argument, field.code === 115 ? "str" : field.code === 114 ? "repr" : "ascii", context, meter);
      const original = context.string(value); meter.checkpoint();
      if (original === undefined) throw new TypeError("representation context lost string storage");
      storage = original.formatField(field.width, field.precision, field.flags.left ? "left" : "right", 32, meter);
      if (storage === original) return value;
      break;
    }
    default: return unsupportedPercentConversion(field.code, field.offset, false, meter);
  }
  const result = context.stringPoints(storage); meter.checkpoint();
  return result;
}
