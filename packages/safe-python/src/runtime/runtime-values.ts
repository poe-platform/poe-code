import { ConstantValues, type PrimitiveConstant, type SliceConstant, type TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";
import { ListStorage } from "./list-storage.js";
import type { FunctionState } from "./function-state.js";
import type { OrderedKeyMap } from "./ordered-key-map.js";

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

export interface FunctionValue {
  readonly kind: "function";
  readonly value: FunctionState<RuntimeValue>;
}

export interface DictionaryValue {
  readonly kind: "dict";
  readonly items: OrderedKeyMap<RuntimeValue, RuntimeValue>;
}

/** Trusted host implementation, installed explicitly by the runtime owner.
 * No payload fields are exposed through guest JavaScript property access. The
 * synchronous implementation owns its internal work and resource checkpoints.
 */
export interface BuiltinFunctionCapability {
  readonly name: string;
  invoke(positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter): RuntimeValue;
}

export interface BuiltinFunctionValue {
  readonly kind: "builtin_function_or_method";
  readonly value: BuiltinFunctionCapability;
}

export type RuntimeValue =
  | PrimitiveConstant
  | TupleConstant<RuntimeValue>
  | SliceConstant<RuntimeValue>
  | ListValue
  | RangeValue
  | IteratorValue
  | FunctionValue
  | BuiltinFunctionValue
  | DictionaryValue;

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

  /** Retain already captured state; wrapping must never execute the function. */
  function(value: FunctionState<RuntimeValue>): FunctionValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "function", value });
  }

  /** Retain a prepared explicit capability; creation never invokes it. Bound
   * method descriptors and their self/function equality remain separate work. */
  builtinFunction(value: BuiltinFunctionCapability): BuiltinFunctionValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "builtin_function_or_method", value });
  }

  /** Adopt prepared ordered storage sharing this execution's key policy/meter. */
  dictionary(items: OrderedKeyMap<RuntimeValue, RuntimeValue>): DictionaryValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "dict", items });
  }
}
