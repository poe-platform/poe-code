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
type BytesConstant = Extract<PrimitiveConstant, { kind: "bytes" }>;
type StringConstant = Extract<PrimitiveConstant, { kind: "str" }>;

// Logical runtime allocation policy, not a measurement of JavaScript heap size.
const VALUE_BYTES = 32;
const REFERENCE_BYTES = 8;

/** CPython's constant interning rule is ASCII alphanumerics and underscore,
 * independent of Unicode identifier classification. Trusted frozen definitions
 * can prepare this name before per-interpreter materialization. */
export function literalStringInternName(points: Uint32Array, meter?: ExecutionMeter): string | undefined {
  let name = "";
  for (const point of points) {
    meter?.checkpoint();
    if (!(point >= 65 && point <= 90 || point >= 97 && point <= 122 || point >= 48 && point <= 57 || point === 95)) return undefined;
    meter?.checkpoint(0, 2);
    name += String.fromCharCode(point);
  }
  return name;
}

/** Concrete immutable value records for literals and compiled constants. These
 * host records must never be exposed through guest JavaScript property access.
 * Singleton identity is scoped to this factory/runtime. Tuples own only their
 * slots, permitting mutable guest members through the generic tuple factory.
 * The empty tuple is cached lazily and shared by all exact tuple operations.
 * Charge 32 bytes per tagged record and 8 per tuple slot; copied string/byte
 * buffers are charged separately. Existing bigint payloads are retained, not
 * copied: their creation must be charged by the parser/arithmetic caller.
 * Small integers (-5 through 256) and bytes are cached lazily (64-byte map
 * plus 32 bytes per cache entry);
 * empty/one-byte results can request fresh identity for operations such as
 * repetition, casing and strided slicing. Full
 * host heap accounting, guest type objects and methods remain unfinished.
 */
export class ConstantValues {
  #smallIntegers: Map<number, Extract<PrimitiveConstant, { kind: "int" }>> | undefined;
  #smallBytes: Map<number, BytesConstant> | undefined;
  #smallStrings: Map<number, StringConstant> | undefined;
  #internedStrings: Map<string, StringConstant> | undefined;
  #emptyTuple: TupleConstant<never> | undefined;
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
    // CPython's small integer interval. Cache per execution, lazily charging
    // the map and each entry; never allocate a fresh tag on a cache hit.
    const key = value >= -5 && value <= 256 ? Number(value) : undefined;
    if (key !== undefined) {
      const cached = this.#smallIntegers?.get(key);
      if (cached !== undefined) return cached;
      this.meter.checkpoint(0, (this.#smallIntegers === undefined ? 64 : 0) + 32);
    }
    this.meter.checkpoint(0, VALUE_BYTES);
    const result = Object.freeze({ kind: "int" as const, value: typeof value === "number" ? BigInt(value) : value });
    if (key !== undefined) {
      this.#smallIntegers ??= new Map();
      this.#smallIntegers.set(key, result);
    }
    return result;
  }

  float(value: number): Extract<PrimitiveConstant, { kind: "float" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "float", value });
  }

  complex(real: number, imaginary: number): Extract<PrimitiveConstant, { kind: "complex" }> {
    this.meter.checkpoint(1, VALUE_BYTES);
    return Object.freeze({ kind: "complex", real, imaginary });
  }

  /** Empty strings are canonical. Nonempty results select fresh identity by
   * default; canonical mode additionally caches Latin-1 single characters.
   * Trusted immutable storage is shared; mutable input is copied on a miss.
   * Each lazy cache costs 64 bytes plus 32 bytes per entry, as for small bytes. */
  stringPoints(points: Uint32Array | CodePointString, identity: "canonical" | "fresh" = "fresh"): StringConstant {
    this.meter.checkpoint();
    let key: number | undefined;
    if (points.length === 0) key = -1;
    else if (points.length === 1 && identity === "canonical") {
      const point = points instanceof CodePointString ? points.codePointAt(0n, this.meter) : points[0];
      if (point <= 255 && (!(points instanceof CodePointString) || points.compactWidth(this.meter) === 1)) key = point;
    }
    if (key !== undefined) {
      const cached = this.#smallStrings?.get(key);
      if (cached !== undefined) return cached;
      this.meter.checkpoint(0, (this.#smallStrings === undefined ? 64 : 0) + 32);
    }
    this.meter.checkpoint(0, VALUE_BYTES);
    const result: StringConstant = Object.freeze({ kind: "str", value: points instanceof CodePointString ? points : new CodePointString(points, this.meter) });
    if (key !== undefined) {
      this.#smallStrings ??= new Map();
      this.#smallStrings.set(key, result);
    }
    return result;
  }

  string(value: string, identity: "canonical" | "fresh" = "canonical"): Extract<PrimitiveConstant, { kind: "str" }> {
    return this.stringPoints(CodePointString.fromString(value, this.meter), identity);
  }

  /** Explicit interning for trusted names and compiler-selected constants.
   * Ordinary string construction never consults this interpreter-owned pool.
   * Codec cache invalidation must not discard interned string identities.
   * Frozen recipes may supply the immutable storage from which their name was
   * prepared; this avoids constructing a second payload on a pool miss. */
  internString(value: string, prepared?: CodePointString): StringConstant {
    this.meter.checkpoint(value.length + 1);
    const cached = this.#internedStrings?.get(value);
    if (cached !== undefined) return cached;
    this.meter.checkpoint(0, (this.#internedStrings === undefined ? 64 : 0) + 32 + value.length * 2);
    const result = prepared === undefined ? this.string(value) : this.stringPoints(prepared, "canonical");
    this.#internedStrings ??= new Map();
    this.#internedStrings.set(value, result);
    return result;
  }

  bytes(value: Uint8Array | ImmutableBytes, identity: "canonical" | "fresh" = "canonical"): BytesConstant {
    this.meter.checkpoint();
    let key: number | undefined;
    if (value.length <= 1 && identity === "canonical") {
      key = value.length === 0 ? -1 : value instanceof ImmutableBytes ? value.byteAt(0n, this.meter) : value[0];
      const cached = this.#smallBytes?.get(key);
      if (cached !== undefined) return cached;
      this.meter.checkpoint(0, (this.#smallBytes === undefined ? 64 : 0) + 32);
    }
    this.meter.checkpoint(0, VALUE_BYTES);
    const result: BytesConstant = Object.freeze({ kind: "bytes", value: value instanceof ImmutableBytes ? value : ImmutableBytes.copyOf(value, this.meter) });
    if (key !== undefined) {
      this.#smallBytes ??= new Map();
      this.#smallBytes.set(key, result);
    }
    return result;
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
    if (length === 0) {
      if (this.#emptyTuple === undefined) {
        this.meter.checkpoint(0, VALUE_BYTES);
        this.#emptyTuple = Object.freeze({ kind: "tuple", items: Object.freeze([]) });
      }
      return this.#emptyTuple;
    }
    this.meter.checkpoint(0, VALUE_BYTES + length * REFERENCE_BYTES);
    const items: Value[] = new Array(length);
    for (let index = 0; index < length; index++) { this.meter.checkpoint(); items[index] = typeof values === "number" ? readItem!(index) : values[index]; }
    return Object.freeze({ kind: "tuple", items: Object.freeze(items) });
  }

  /** Creating a slice never coerces or validates its component values. */
  slice<Value = ConstantValue>(parts: SliceValues<Value>): SliceConstant<Value | ConstantValues["none"]> {
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
      case "string": {
        const points = node.value as Uint32Array;
        const name = literalStringInternName(points, this.meter);
        return name === undefined ? this.stringPoints(points, "canonical") : this.internString(name);
      }
      case "bytes": return this.bytes(node.value as Uint8Array);
    }
  }
}
