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
import type { IntegerIndexContext } from "./index-protocol.js";
import type { RuntimePowerContext } from "./runtime-power-operation.js";
import type { RuntimeNumericContext } from "./runtime-numeric-slots.js";
import type { FormatContext } from "./format-protocol.js";
import { RuntimeMethodDecoratorState } from "./runtime-method-decorator-state.js";
import { RuntimeInstanceState } from "./runtime-instance-state.js";

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
  formatting?: FormatContext<RuntimeValue>;
  /** Type-MRO presence only, without binding a descriptor. */
  hasSpecial?(object: RuntimeValue, name: string): boolean;
  warn?(category: "DeprecationWarning", message: string): void;
  lookupSpecial?(object: RuntimeValue, name: string): RuntimeValue | undefined;
  /** Actual runtime type, bypassing instance attributes and virtual checks. */
  actualType?(value: RuntimeValue): TypeValue;
  /** Enter type.__call__ directly, bypassing metaclass __call__ overrides. */
  callTypeDefault?(type: TypeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue): RuntimeValue;
  /** Default type attribute slots, without metaclass overrides or getattr. */
  typeAttributeDefault?(type: TypeValue, name: string): RuntimeValue;
  mutateTypeAttributeDefault?(type: TypeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }): void;
  /** Base object slots, without guest attribute overrides or getattr fallback. */
  objectAttributeDefault?(object: RuntimeValue, name: string): RuntimeValue;
  mutateObjectAttributeDefault?(object: RuntimeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }): void;
  typeName?(value: RuntimeValue): string;
  setAttribute?(object: RuntimeValue, name: string, value: RuntimeValue): void;
  deleteAttribute?(object: RuntimeValue, name: string): void;
  attribute?(object: RuntimeValue, name: string): RuntimeValue;
  readonly power?: RuntimePowerContext;
  /** Prepared numeric slots shared by operators and numeric builtins. */
  numeric?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeNumericContext | undefined;
  isCallable?(value: RuntimeValue): boolean;
  /** Ordinary binary expression dispatch, never augmented assignment. */
  binary?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
  readonly integerIndex?: IntegerIndexContext<RuntimeValue>;
  readonly iteration?: IterationContext<RuntimeValue>;
  /** Reenter this execution's normal argument/callability/function call path. */
  call(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords?: DictionaryValue): RuntimeValue;
  isStopIteration(error: unknown): boolean;
  truth?(value: RuntimeValue): boolean;
  /** Rich comparison followed by the execution's guest truth conversion. */
  compareTruth?(operator: string, left: RuntimeValue, right: RuntimeValue): boolean;
  /** Raw rich comparison result, without a truth conversion. */
  compare?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
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
  /** Execution-owned native binding. The canonical implementation token may
   * differ from the accessed descriptor when native methods alias one callback. */
  readonly binding?: { readonly descriptor: NativeMethodDescriptorValue; readonly implementation: NativeMethodDescriptorValue; readonly instance: RuntimeValue };
}

export interface BoundMethodValue {
  readonly kind: "method";
  readonly value: { readonly function: RuntimeValue; readonly instance: RuntimeValue };
}

export type MethodDecoratorValue =
  | { readonly kind: "staticmethod"; readonly value: RuntimeValue; readonly state: RuntimeMethodDecoratorState; readonly type?: TypeValue }
  | { readonly kind: "classmethod"; readonly value: RuntimeValue; readonly state: RuntimeMethodDecoratorState; readonly type?: TypeValue };

export interface CellValue {
  readonly kind: "cell";
  readonly value: CellStorage<RuntimeValue>;
}

/** Concrete guest instance. Allocation/layout policy supplies its actual type
 * and optional owned dictionary; neither implies native-subclass payload storage. */
export interface InstanceValue {
  readonly kind: "instance";
  readonly type: TypeValue;
  readonly dictionary?: DictionaryValue;
  readonly state: RuntimeInstanceState;
}

/** Native wrappers with published ownership use the same ordinary attribute
 * protocol as heap instances, retaining their separate payload and storage. */
export type AttributeInstanceValue = InstanceValue | (MethodDecoratorValue & { readonly type: TypeValue });

export function hasRuntimeInstanceAttributes(value: RuntimeValue): value is AttributeInstanceValue {
  return value.kind === "instance" || ((value.kind === "staticmethod" || value.kind === "classmethod") && value.type !== undefined);
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
  get(instance: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValue;
  set?(instance: RuntimeValue, value: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): void;
  delete?(instance: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): void;
}

export interface GetsetDescriptorValue {
  readonly kind: "getset_descriptor";
  readonly value: GetsetDescriptorCapability;
}

export interface MemberDescriptorValue {
  readonly kind: "member_descriptor";
  readonly value: GetsetDescriptorCapability;
}

/** Native instance method: receiver applicability is separate from argument
 * validation. The implementation receives an accepted receiver, not self in args. */
export interface MethodDescriptorCapability {
  readonly owner: TypeValue;
  readonly name: string;
  accepts(instance: RuntimeValue, meter: ExecutionMeter): boolean;
  invoke(instance: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter, context?: BuiltinInvocationContext): RuntimeValue;
}

export interface MethodDescriptorValue {
  readonly kind: "method_descriptor";
  readonly value: MethodDescriptorCapability;
}

export interface ClassMethodDescriptorValue {
  readonly kind: "classmethod_descriptor";
  readonly value: MethodDescriptorCapability;
}

export type NativeMethodDescriptorValue = MethodDescriptorValue | ClassMethodDescriptorValue;

export interface WrapperDescriptorValue {
  readonly kind: "wrapper_descriptor";
  readonly value: MethodDescriptorCapability;
}

export interface MethodWrapperValue {
  readonly kind: "method-wrapper";
  readonly value: { readonly descriptor: WrapperDescriptorValue; readonly instance: RuntimeValue };
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
  | MethodDecoratorValue
  | CellValue
  | InstanceValue
  | TypeValue
  | GetsetDescriptorValue
  | MemberDescriptorValue
  | MethodDescriptorValue
  | ClassMethodDescriptorValue
  | WrapperDescriptorValue
  | MethodWrapperValue
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
  #nativeImplementations?: WeakMap<MethodDescriptorCapability["invoke"], NativeMethodDescriptorValue>;
  constructor(private readonly runtimeMeter: ExecutionMeter) {
    super(runtimeMeter);
  }

  /** Adopt explicitly allocated instance storage without running guest methods.
   * Missing dictionary denotes a dictionary-less layout, not lazy allocation. */
  instance(type: TypeValue, dictionary?: DictionaryValue): InstanceValue {
    this.runtimeMeter.checkpoint(1, 48);
    const state = new RuntimeInstanceState(dictionary, this.runtimeMeter);
    return Object.freeze({ kind: "instance", type, state, get dictionary() { return state.dictionary; } });
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

  /** Retain an explicit capability without calling it. Native bindings retain
   * one implementation-identity token per callback in this execution, allowing
   * the ordinary identity-hash policy to hash aliases consistently. */
  builtinFunction(value: BuiltinFunctionCapability, binding?: { readonly descriptor: NativeMethodDescriptorValue; readonly instance: RuntimeValue }): BuiltinFunctionValue {
    this.runtimeMeter.checkpoint(1, 32);
    if (binding === undefined) return Object.freeze({ kind: "builtin_function_or_method", value });
    if (this.#nativeImplementations === undefined) { this.runtimeMeter.checkpoint(0, 64); this.#nativeImplementations = new WeakMap(); }
    let implementation = this.#nativeImplementations.get(binding.descriptor.value.invoke);
    if (implementation === undefined) {
      this.runtimeMeter.checkpoint(0, 48);
      implementation = binding.descriptor;
      this.#nativeImplementations.set(binding.descriptor.value.invoke, implementation);
    }
    this.runtimeMeter.checkpoint(0, 48);
    return Object.freeze({ kind: "builtin_function_or_method", value, binding: Object.freeze({ descriptor: binding.descriptor, implementation, instance: binding.instance }) });
  }

  /** Raw method binding, also used by classmethod for non-callable payloads.
   * Public MethodType creation validates callability separately. */
  boundMethod(fn: RuntimeValue, instance: RuntimeValue): BoundMethodValue {
    this.runtimeMeter.checkpoint();
    if (instance.kind === "none") throw new PythonRuntimeError("TypeError", "instance must not be None");
    this.runtimeMeter.checkpoint(0, 64);
    return Object.freeze({ kind: "method", value: Object.freeze({ function: fn, instance }) });
  }

  /** Raw initialized wrapper. Public constructors additionally copy callable
   * metadata and support reinitialization; those policies are separate. */
  methodDecorator(kind: "staticmethod" | "classmethod", value: RuntimeValue, type?: TypeValue): MethodDecoratorValue {
    this.runtimeMeter.checkpoint(1, 32);
    const state = new RuntimeMethodDecoratorState(value, this, this.runtimeMeter);
    return Object.freeze({ kind, state, type, get value() { return state.value; } });
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

  memberDescriptor(value: GetsetDescriptorCapability): MemberDescriptorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "member_descriptor", value });
  }

  methodDescriptor(value: MethodDescriptorCapability): MethodDescriptorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "method_descriptor", value });
  }

  classMethodDescriptor(value: MethodDescriptorCapability): ClassMethodDescriptorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "classmethod_descriptor", value });
  }

  wrapperDescriptor(value: MethodDescriptorCapability): WrapperDescriptorValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "wrapper_descriptor", value });
  }

  /** Adopt a receiver already validated by the descriptor binding protocol. */
  methodWrapper(descriptor: WrapperDescriptorValue, instance: RuntimeValue): MethodWrapperValue {
    this.runtimeMeter.checkpoint(1, 64);
    return Object.freeze({ kind: "method-wrapper", value: Object.freeze({ descriptor, instance }) });
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
