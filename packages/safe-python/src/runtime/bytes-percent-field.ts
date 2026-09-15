import { ImmutableBytes } from "./immutable-bytes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { percentBytes, type PercentBytesContext } from "./percent-bytes-conversion.js";
import { percentCharacter, type PercentCharacterContext } from "./percent-character-conversion.js";
import { percentFloat, type PercentFloatContext } from "./percent-float-conversion.js";
import { percentInteger, type PercentIntegerContext } from "./percent-integer-conversion.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { unsupportedPercentConversion } from "./percent-format-error.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

export type BytesPercentContext<Value> = PercentBytesContext<Value> & PercentCharacterContext<Value> & PercentFloatContext<Value> & PercentIntegerContext<Value> & RepresentationContext<Value>;

/** Render an already-bound bytes field. b/s share bytes conversion, r/a share
 * ASCII repr, and c ignores precision. Guest output identity belongs to the
 * final wrapper; this kernel may alias unchanged immutable operand storage. */
export function bytesPercentField<Value>(field: Extract<BoundPercentFormatEvent<Value>, { kind: "conversion" }>, context: BytesPercentContext<Value>, meter: ExecutionMeter): ImmutableBytes {
  meter.checkpoint();
  switch (field.code) {
    case 100: case 105: case 117: case 111: case 120: case 88:
      return ImmutableBytes.fromIntegerPercentField(percentInteger(field.argument, field.code, context, meter), field, meter);
    case 101: case 69: case 102: case 70: case 103: case 71:
      return ImmutableBytes.fromFloatPercentField(percentFloat(field.argument, true, context, meter), field, meter);
    case 99: {
      const byte = percentCharacter(field.argument, true, context, meter);
      meter.checkpoint(0, 32);
      return ImmutableBytes.copyOf([byte], meter).formatField(field.width, null, field.flags.left, meter);
    }
    case 98: case 115:
      return percentBytes(field.argument, context, meter).formatField(field.width, field.precision, field.flags.left, meter);
    case 114: case 97: {
      const value = representationObject(field.argument, "ascii", context, meter);
      const storage = context.string(value); meter.checkpoint();
      if (storage === undefined) throw new TypeError("representation context lost string storage");
      return ImmutableBytes.fromAscii(storage, meter).formatField(field.width, field.precision, field.flags.left, meter);
    }
    default: return unsupportedPercentConversion(field.code, field.offset, true, meter);
  }
}
