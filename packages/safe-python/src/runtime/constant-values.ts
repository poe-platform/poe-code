import type { Expression } from "../ast.js";
import type { SliceValues } from "./expression-evaluation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";

export type PrimitiveConstant =
  | { readonly kind: "none" }
  | { readonly kind: "ellipsis" }
  | { readonly kind: "not-implemented" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "complex"; readonly real: number; readonly imaginary: number }
  | { readonly kind: "str"; readonly value: CodePointString }
  | { readonly kind: "bytes"; readonly value: ImmutableBytes };

export interface TupleConstant<Value = ConstantValue> {
  readonly kind: "tuple";
  readonly items: readonly Value[];
}

export interface SliceConstant<Value = ConstantValue> {
  readonly kind: "slice";
  readonly start: Value;
  readonly stop: Value;
  readonly step: Value;
}

export type ConstantValue = PrimitiveConstant | TupleConstant<ConstantValue> | SliceConstant<ConstantValue>;

// Logical runtime allocation policy, not a measurement of JavaScript heap size.
const VALUE_BYTES = 32;
const REFERENCE_BYTES = 8;

/** Concrete immutable value records for literals and compiled constants. These
 * host records must never be exposed through guest JavaScript property access.
 * Singleton identity is scoped to this factory/runtime. Tuples own only their
 * slots, permitting mutable guest members through the generic tuple factory.
 * Charge 32 bytes per tagged record and 8 per tuple slot; copied string/byte
 * buffers are charged separately. Existing bigint payloads are retained, not
 * copied: their creation must be charged by the parser/arithmetic caller. Full
 * host heap accounting, guest type objects and methods remain unfinished.
 */
export class ConstantValues {
  readonly none: Extract<PrimitiveConstant, { kind: "none" }>;
  readonly true: Extract<PrimitiveConstant, { kind: "bool" }>;
  readonly false: Extract<PrimitiveConstant, { kind: "bool" }>;
  readonly ellipsis: Extract<PrimitiveConstant, { kind: "ellipsis" }>;
  readonly notImplemented: Extract<PrimitiveConstant, { kind: "not-implemented" }>;

  constructor(private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, VALUE_BYTES * 5);
    this.none = Object.freeze({ kind: "none" });
    this.true = Object.freeze({ kind: "bool", value: true });
    this.false = Object.freeze({ kind: "bool", value: false });
    this.ellipsis = Object.freeze({ kind: "ellipsis" });
    this.notImplemented = Object.freeze({ kind: "not-implemented" });
  }

  boolean(value: boolean): Extract<PrimitiveConstant, { kind: "bool" }> {
    this.meter.checkpoint();
    return value ? this.true : this.false;
  }

  integer(value: bigint | number): Extract<PrimitiveConstant, { kind: "int" }> {
    this.meter.checkpoint();
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError("integer constant requires a bigint or safe integer");
    this.meter.checkpoint(0, VALUE_BYTES);
    return Object.freeze({ kind: "int", value: typeof value === "number" ? BigInt(value) : value });
  }

  float(value: number): Extract<PrimitiveConstant, { kind: "float" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "float", value });
  }

  complex(real: number, imaginary: number): Extract<PrimitiveConstant, { kind: "complex" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "complex", real, imaginary });
  }

  /** Trusted immutable storage can be shared; mutable input is always copied. */
  stringPoints(points: Uint32Array | CodePointString): Extract<PrimitiveConstant, { kind: "str" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "str", value: points instanceof CodePointString ? points : new CodePointString(points, this.meter) });
  }

  string(value: string): Extract<PrimitiveConstant, { kind: "str" }> {
    this.meter.checkpoint(1, value.length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(value.length);
    let length = 0;
    for (const character of value) { this.meter.checkpoint(); points[length++] = character.codePointAt(0)!; }
    return this.stringPoints(points.subarray(0, length));
  }

  bytes(value: Uint8Array | ImmutableBytes): Extract<PrimitiveConstant, { kind: "bytes" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "bytes", value: value instanceof ImmutableBytes ? value : ImmutableBytes.copyOf(value, this.meter) });
  }

  tuple<Value>(values: readonly Value[]): TupleConstant<Value>;
  tuple<Value>(length: number, readItem: (index: number) => Value): TupleConstant<Value>;
  /** Indexed readers are trusted host construction callbacks, never guest
   * iteration. Allocate and charge final slots before visiting any item; the
   * partially constructed array is never passed to the reader or published.
   */
  tuple<Value>(values: readonly Value[] | number, readItem?: (index: number) => Value): TupleConstant<Value> {
    this.meter.checkpoint();
    const length = typeof values === "number" ? values : values.length;
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("tuple length must be a nonnegative safe integer");
    if (typeof values === "number" && typeof readItem !== "function") throw new TypeError("tuple item reader is required");
    this.meter.checkpoint(0, VALUE_BYTES + length * REFERENCE_BYTES);
    const items: Value[] = new Array(length);
    for (let index = 0; index < length; index++) { this.meter.checkpoint(); items[index] = typeof values === "number" ? readItem!(index) : values[index]; }
    return Object.freeze({ kind: "tuple", items: Object.freeze(items) });
  }

  /** Creating a slice never coerces or validates its component values. */
  slice(parts: SliceValues<ConstantValue>): SliceConstant {
    this.meter.checkpoint(1, VALUE_BYTES + 3 * REFERENCE_BYTES);
    return Object.freeze({ kind: "slice", start: parts.lower ?? this.none, stop: parts.upper ?? this.none, step: parts.step ?? this.none });
  }

  /** Materialize validated parser literals; explicit surrogate code points remain
   * separate. Unary signs and compound expressions belong to expression execution.
   */
  literal(node: Extract<Expression, { kind: "literal" }>): PrimitiveConstant {
    this.meter.checkpoint();
    switch (node.literalKind) {
      case "none": return this.none;
      case "ellipsis": return this.ellipsis;
      case "boolean": return this.boolean(node.value as boolean);
      case "integer": return this.integer(node.value as bigint);
      case "float": return this.float(node.value as number);
      case "imaginary": return this.complex(0, node.value as number);
      case "string": return this.stringPoints(node.value as Uint32Array);
      case "bytes": return this.bytes(node.value as Uint8Array);
    }
  }
}
