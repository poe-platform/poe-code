import { ConstantValues, type PrimitiveConstant, type SliceConstant, type TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";
import { ListStorage } from "./list-storage.js";
import type { FunctionState } from "./function-state.js";
import type { OrderedKeyMap } from "./ordered-key-map.js";
import { PythonRuntimeError } from "./error.js";
import type { CellStorage } from "./lexical-frame.js";
import type { RuntimeTypeLayout } from "./runtime-type-layout.js";
import type { CompletionIterator } from "./iterator-completion.js";
import type { IterationContext } from "./protocol-iterator.js";

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
  readonly value: CompletionIterator<RuntimeValue>;
}

export interface FunctionValue {
  readonly kind: "function";
  readonly value: FunctionState<RuntimeValue>;
}

export interface DictionaryValue {
  readonly kind: "dict";
  readonly items: OrderedKeyMap<RuntimeValue, RuntimeValue>;
}

/** Mutable set keys; payload slots hold this execution's None singleton. */
export interface SetValue {
  readonly kind: "set";
  readonly items: OrderedKeyMap<RuntimeValue, RuntimeValue>;
}

/** Permanently sealed key storage, owned exclusively before publication. */
export interface FrozenSetValue {
  readonly kind: "frozenset";
  readonly items: OrderedKeyMap<RuntimeValue, RuntimeValue>;
}

export function isRuntimeSet(value: RuntimeValue): value is SetValue | FrozenSetValue {
  return value.kind === "set" || value.kind === "frozenset";
}

/** Live read-only guest view. Host storage is never exposed by guest attributes. */
export interface MappingProxyValue {
  readonly kind: "mappingproxy";
  readonly value: DictionaryValue;
}

export type DictionaryViewValue = { readonly value: DictionaryValue } & (
  | { readonly kind: "dict_keys" }
  | { readonly kind: "dict_values" }
  | { readonly kind: "dict_items" }
);

export function isRuntimeSetView(value: RuntimeValue): value is DictionaryViewValue & { kind: "dict_keys" | "dict_items" } {
  return value.kind === "dict_keys" || value.kind === "dict_items";
}

/** Trusted host implementation, installed explicitly by the runtime owner.
 * No payload fields are exposed through guest JavaScript property access. The
 * synchronous implementation owns its internal work and resource checkpoints.
 */
export interface BuiltinInvocationContext {
  readonly iteration?: IterationContext<RuntimeValue>;
  /** Reenter this execution's normal argument/callability/function call path. */
  call(callee: RuntimeValue, positional: readonly RuntimeValue[]): RuntimeValue;
  isStopIteration(error: unknown): boolean;
  truth?(value: RuntimeValue): boolean;
  /** Rich comparison followed by the execution's guest truth conversion. */
  compareTruth?(operator: string, left: RuntimeValue, right: RuntimeValue): boolean;
}

export interface BuiltinFunctionCapability {
  readonly name: string;
  /** Native keyword-dict calling conventions may validate names after their
   * positional work. Opted-in callees must perform their own keyword checks. */
  readonly keywordValidation?: "callee";
  invoke(positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter, context?: BuiltinInvocationContext): RuntimeValue;
}

export interface BuiltinFunctionValue {
  readonly kind: "builtin_function_or_method";
  readonly value: BuiltinFunctionCapability;
}

export interface BoundMethodValue {
  readonly kind: "method";
  readonly value: { readonly function: FunctionValue; readonly instance: RuntimeValue };
}

export interface CellValue {
  readonly kind: "cell";
  readonly value: CellStorage<RuntimeValue>;
}

export interface TypeValue {
  readonly kind: "type";
  readonly value: RuntimeTypeLayout;
  readonly metaclass: TypeValue;
  readonly immutable: boolean;
}

/** Explicit native descriptor capability. Accessors receive a receiver already
 * accepted by the applicability policy; callbacks own their internal metering. */
export interface GetsetDescriptorCapability {
  readonly owner: TypeValue;
  readonly name: string;
  accepts(instance: RuntimeValue, meter: ExecutionMeter): boolean;
  get(instance: RuntimeValue, meter: ExecutionMeter): RuntimeValue;
  set?(instance: RuntimeValue, value: RuntimeValue, meter: ExecutionMeter): void;
  delete?(instance: RuntimeValue, meter: ExecutionMeter): void;
}

export interface GetsetDescriptorValue {
  readonly kind: "getset_descriptor";
  readonly value: GetsetDescriptorCapability;
}

/** Finish the self-reference before publishing the immutable record. */
class RuntimeTypeRecord implements TypeValue {
  readonly kind = "type";
  readonly metaclass: TypeValue;

  constructor(readonly value: RuntimeTypeLayout, metaclass: TypeValue | "self", readonly immutable: boolean) {
    this.metaclass = metaclass === "self" ? this : metaclass;
    Object.freeze(this);
  }
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
  | BoundMethodValue
  | CellValue
  | TypeValue
  | GetsetDescriptorValue
  | MappingProxyValue
  | DictionaryViewValue
  | SetValue
  | FrozenSetValue
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

  iterator(value: CompletionIterator<RuntimeValue>): IteratorValue {
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

  /** Exact Python-function binding. General MethodType callable inputs and
   * descriptor __get__ argument handling belong to the later object layer. */
  boundMethod(fn: FunctionValue, instance: RuntimeValue): BoundMethodValue {
    this.runtimeMeter.checkpoint();
    if (instance.kind === "none") throw new PythonRuntimeError("TypeError", "instance must not be None");
    this.runtimeMeter.checkpoint(0, 64);
    return Object.freeze({ kind: "method", value: Object.freeze({ function: fn, instance }) });
  }

  /** Adopt prepared ordered storage sharing this execution's key policy/meter.
   * Does not reconstruct insertion history: host-provided maps that need raw
   * dictionary traversal must opt into positional storage when created. */
  dictionary(items: OrderedKeyMap<RuntimeValue, RuntimeValue>): DictionaryValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "dict", items });
  }

  /** Adopt shared closure storage, including an empty cell. The publishing
   * object layer retains this wrapper when exposing the same cell again. */
  cell(value: CellValue["value"]): CellValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "cell", value });
  }

  /** Adopt a validated layout and explicit metaclass. "self" is a host-only
   * bootstrap marker for type, not a guest metaclass argument or inferred default.
   * The object layer owns canonical publication and metaclass/layout validation. */
  type(layout: RuntimeTypeLayout, metaclass: TypeValue | "self", options: { readonly immutable?: boolean } = {}): TypeValue {
    this.runtimeMeter.checkpoint(1, 48);
    return new RuntimeTypeRecord(layout, metaclass, options.immutable ?? false);
  }

  getsetDescriptor(value: GetsetDescriptorCapability): GetsetDescriptorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "getset_descriptor", value });
  }

  mappingProxy(value: DictionaryValue): MappingProxyValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "mappingproxy", value });
  }

  dictionaryView(value: DictionaryValue, kind: DictionaryViewValue["kind"]): DictionaryViewValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind, value });
  }

  set(items: OrderedKeyMap<RuntimeValue, RuntimeValue>): SetValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "set", items });
  }

  /** Adopt fresh, exclusively owned storage without copying its entries. */
  frozenSet(items: OrderedKeyMap<RuntimeValue, RuntimeValue>): FrozenSetValue {
    this.runtimeMeter.checkpoint(1, 32);
    items.seal();
    return Object.freeze({ kind: "frozenset", items });
  }
}
