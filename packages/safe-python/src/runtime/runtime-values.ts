import { ConstantValues, type PrimitiveConstant, type SliceConstant, type TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";
import { ListStorage } from "./list-storage.js";

export interface ListValue {
  readonly kind: "list";
  readonly items: ListStorage<RuntimeValue>;
}

export interface RangeValue {
  readonly kind: "range";
  readonly value: IntegerProgression;
}

export interface IteratorValue {
  readonly kind: "iterator";
  readonly value: Iterator<RuntimeValue>;
}

export type RuntimeValue =
  | PrimitiveConstant
  | TupleConstant<RuntimeValue>
  | SliceConstant<RuntimeValue>
  | ListValue
  | RangeValue
  | IteratorValue;

/** Host-only records, never accessible through guest JavaScript properties.
 * Lists own their slots but share members, including cyclic references. Range
 * progressions must already be validated and immutable; iterators must already
 * be adapted to the host iterator protocol. Neither is consumed on wrapping.
 * Wrapper charges are logical allocations; storage and payload producers own
 * their separate charges. Guest types, dispatch and full heap accounting remain
 * separate concerns; this is not yet the complete Python object model.
 */
export class RuntimeValues extends ConstantValues {
  constructor(private readonly runtimeMeter: ExecutionMeter) {
    super(runtimeMeter);
  }

  /** Adopt trusted owned storage (for example, a slice) without a second copy. */
  list(items: readonly RuntimeValue[] | ListStorage<RuntimeValue>): ListValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "list", items: items instanceof ListStorage ? items : new ListStorage(items, this.runtimeMeter) });
  }

  range(value: IntegerProgression): RangeValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "range", value });
  }

  iterator(value: Iterator<RuntimeValue>): IteratorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "iterator", value });
  }
}
