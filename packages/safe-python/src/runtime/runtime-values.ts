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
import type { RuntimeBytesInputProtocol } from "./runtime-bytes-input.js";
import type { RuntimeBufferContext } from "./runtime-buffer-context.js";
import { RuntimeMethodDecoratorState } from "./runtime-method-decorator-state.js";
import { RuntimeInstanceState } from "./runtime-instance-state.js";
import type { RuntimeExceptionState } from "./runtime-exception-state.js";
import type { RuntimeGeneratorState,RuntimeCoroutineWrapperState,RuntimeAsyncGeneratorState,RuntimeAsyncGeneratorOperationState } from "./runtime-generator-state.js";
import type {RuntimeAnextAwaitableState} from "./runtime-anext-awaitable.js";
import type {RuntimeFrameLocalsProxyState} from "./runtime-frame-locals-proxy.js";
import type {RuntimeFrameState} from "./runtime-frame.js";
import type {RuntimeTracebackState} from "./runtime-traceback.js";
import type {RuntimeCodeState} from "./runtime-code.js";
import type {RuntimeUnionState} from "./runtime-union-state.js";
import { ExecutionIdentity } from "./execution-identity.js";
import type { IdentityContext } from "./builtin-id.js";

export interface ListValue {
  readonly kind: "list";
  readonly items: ListStorage<RuntimeValue>;
}

export interface RangeValue {
  readonly kind: "range";
  readonly value: IntegerProgression;
  readonly start: Extract<RuntimeValue, { kind: "int" }>;
  readonly stop: Extract<RuntimeValue, { kind: "int" }>;
  readonly step: Extract<RuntimeValue, { kind: "int" }>;
}

export interface IteratorValue {
  readonly kind: "iterator";
  readonly value: CompletionIterator<RuntimeValue>;
  /** Native cursor kind retained independently of exhaustion. Canonical type
   * object publication remains the runtime registry's responsibility. */
  readonly typeName?:string;
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
  readonly value: RuntimeValue;
}

export type DictionaryViewValue = { readonly value: DictionaryValue; readonly owner?: InstanceValue } & (
  | { readonly kind: "dict_keys" }
  | { readonly kind: "dict_values" }
  | { readonly kind: "dict_items" }
);

export function isRuntimeSetView(value: RuntimeValue): value is DictionaryViewValue & { kind: "dict_keys" | "dict_items" } {
  return value.kind === "dict_keys" || value.kind === "dict_items";
}

/** Original guest values retained by native operations for exception publication. */
export interface ExceptionPreparationValues {
  readonly syntaxFilename?:RuntimeValue;
  readonly unicodeObject?:RuntimeValue;
}

/** Trusted host implementation, installed explicitly by the runtime owner.
 * No payload fields are exposed through guest JavaScript property access. The
 * synchronous implementation owns its internal work and resource checkpoints.
 */
export interface BuiltinInvocationContext {
  /** Translate a native failure without rebuilding retained source/filename
   * objects from host diagnostic storage. */
  prepareException?(error:unknown,retained?:ExceptionPreparationValues):unknown;
  /** Execution-owned canonical base object type for native sentinel allocation. */
  readonly objectType?:TypeValue;
  /** Replace a guest protocol failure while retaining explicit cause/context. */
  causeException?(error:unknown,name:"SystemError",message:string):unknown;
  wrapAnext?(awaitable:RuntimeValue,defaultValue:RuntimeValue):RuntimeValue;
  /** Internal exception inheritance, never guest instance/subclass hooks.
   * Ordinary host failures must remain false. Native operation faults may also
   * match a parent exception class through the execution's builtin catalogue. */
  isException?(error: unknown, name: string): boolean;
  /** Borrow native exception args without virtual attribute lookup or copying.
   * Undefined means this execution does not expose arguments for this carrier. */
  exceptionArguments?(error: unknown): readonly RuntimeValue[] | undefined;
  /** Add a native diagnostic note, bypassing an overridable add_note method.
   * Preserve the handled scope during callbacks; chain their failures to error.
   * Return the exception to propagate (native faults may become guest carriers). */
  addExceptionNote?(error: unknown, build: () => string): unknown;
  /** Account for recursive native operations that do not enter a guest body.
   * Always invoke the returned unmetered restoration in a finally block. */
  enterRecursiveCall?(): () => void;
  /** Execution-local object IDs, shared with id(); never host addresses. */
  readonly identity?: IdentityContext;
  /** Trusted signed 64-bit identity hash, with -1 remapped to -2; no guest slots. */
  identityHash?(value: RuntimeValue): bigint;
  /** Native outer hash slot with normal guest hashing for nested members. */
  nativeHash?(value: RuntimeValue): bigint;
  /** Native list repr with active guest elements and shared recursion state. */
  nativeListRepr?(value: RuntimeValue): RuntimeValue;
  /** Native set repr with original receiver identity and active guest elements. */
  nativeSetRepr?(value: RuntimeValue): RuntimeValue;
  formatting?: FormatContext<RuntimeValue>;
  /** Type-MRO presence only, without binding a descriptor. */
  hasSpecial?(object: RuntimeValue, name: string): boolean;
  warn?(category: "DeprecationWarning", message: string): void;
  lookupSpecial?(object: RuntimeValue, name: string): RuntimeValue | undefined;
  /** Actual runtime type, bypassing instance attributes and virtual checks. */
  actualType?(value: RuntimeValue): TypeValue;
  /** Calling frame's live globals __name__, for native class allocation. */
  readonly moduleName?: RuntimeValue;
  /** Complete set-name and subclass hooks; never runs metaclass __init__. */
  finalizeType?(type: TypeValue, keywords: DictionaryValue): void;
  /** Execute a builder body against prepared locals, retaining its class cell.
   * Ordinary optimized functions still use their own local activation. */
  executeClassBody?(body: FunctionValue, namespace: RuntimeValue): CellStorage<RuntimeValue> | undefined;
  /** Enter type.__call__ directly, bypassing metaclass __call__ overrides. */
  callTypeDefault?(type: TypeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue): RuntimeValue;
  /** Default type attribute slots, without metaclass overrides or getattr. */
  typeAttributeDefault?(type: TypeValue, name: string): RuntimeValue;
  mutateTypeAttributeDefault?(type: TypeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }): void;
  /** Base object slots, without guest attribute overrides or getattr fallback. */
  objectAttributeDefault?(object: RuntimeValue, name: string): RuntimeValue;
  mutateObjectAttributeDefault?(object: RuntimeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }): void;
  /** Adopt a validated actual type for extension-owned native/opaque storage. */
  assignClassDefault?(object: RuntimeValue, type: TypeValue): void;
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
  /** Host-owned byte/buffer access, also shared by native byte constructors. */
  readonly bytes?: RuntimeBytesInputProtocol;
  /** Contiguous buffer leases, retaining acquisition/copy/release ownership. */
  readonly buffers?: RuntimeBufferContext;
  /** Reenter this execution's normal argument/callability/function call path. */
  call(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords?: DictionaryValue): RuntimeValue;
  isStopIteration(error: unknown): boolean;
  truth?(value: RuntimeValue): boolean;
  /** Rich comparison followed by the execution's guest truth conversion. */
  compareTruth?(operator: string, left: RuntimeValue, right: RuntimeValue): boolean;
  /** Raw rich comparison result, without a truth conversion. */
  compare?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
  /** Receiver slot only: no reflection, identity fallback or truth conversion. */
  compareSlot?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue;
}

export interface NativeDocumentation {
  /** Native documentation text, never a guest attribute lookup or evaluator. */
  readonly doc?: string;
}

export interface BuiltinFunctionCapability extends NativeDocumentation {
  readonly name: string;
  /** A fixed type receiver is metadata only; native allocators still receive
   * their requested allocation class explicitly in positional arguments. */
  readonly owner?: TypeValue;
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
 * and optional owned dictionary and native payload. Native payloads are not
 * guest attributes and do not replace ordinary instance protocol dispatch. */
export interface InstanceValue {
  readonly kind: "instance";
  readonly type: TypeValue;
  readonly dictionary?: DictionaryValue;
  readonly state: RuntimeInstanceState;
  readonly native?: ListValue | SetValue | FrozenSetValue | TupleConstant<RuntimeValue> | DictionaryValue | RuntimeExceptionState | RuntimeGeneratorState | RuntimeCoroutineWrapperState | RuntimeAsyncGeneratorState | RuntimeAsyncGeneratorOperationState | RuntimeAnextAwaitableState | RuntimeFrameLocalsProxyState | RuntimeFrameState | RuntimeTracebackState | RuntimeCodeState | RuntimeUnionState | Extract<PrimitiveConstant, { kind: "int" | "float" | "complex" }>;
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
  /** Native types may validate keyword dictionaries during construction. */
  readonly keywordValidation?: "callee";
  /** Trusted storage mutation after ownership and native layout validation. */
  assignMetaclass(metaclass: TypeValue, meter: ExecutionMeter): void;
}

/** Explicit native descriptor capability. Accessors receive a receiver already
 * accepted by the applicability policy; callbacks own their internal metering. */
export interface GetsetDescriptorCapability extends NativeDocumentation {
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
export interface MethodDescriptorCapability extends NativeDocumentation {
  readonly owner: TypeValue;
  readonly name: string;
  /** Bound native calls may validate keyword names after positional work.
   * Unbound descriptor calls retain normal call-site validation. */
  readonly boundKeywordValidation?: "callee";
  /** Native sequence fallback, not a numeric slot during operator negotiation. */
  readonly sequenceOperator?: "+" | "*";
  accepts(instance: RuntimeValue, meter: ExecutionMeter): boolean;
  /** Retained bound methods may use receiver-specific diagnostics; immediate
   * descriptor calls use the defining type's native calling convention. */
  invoke(instance: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter, context?: BuiltinInvocationContext, bound?: boolean): RuntimeValue;
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
export type NativeDescriptorValue = NativeMethodDescriptorValue | WrapperDescriptorValue | GetsetDescriptorValue | MemberDescriptorValue;

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
  #metaclass: TypeValue;

  constructor(readonly value: RuntimeTypeLayout, metaclass: TypeValue | "self", readonly immutable: boolean, readonly keywordValidation?: "callee") {
    this.#metaclass = metaclass === "self" ? this : metaclass;
    Object.freeze(this);
  }

  get metaclass(): TypeValue { return this.#metaclass; }

  assignMetaclass(metaclass: TypeValue, meter: ExecutionMeter): void {
    meter.checkpoint(); this.#metaclass = metaclass;
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
  #identity?: ExecutionIdentity;
  #descriptorQualifiedNames?: WeakMap<NativeDescriptorValue, Extract<PrimitiveConstant, { kind: "str" }>>;
  #nativeImplementations?: WeakMap<MethodDescriptorCapability["invoke"], NativeMethodDescriptorValue>;
  constructor(private readonly runtimeMeter: ExecutionMeter) {
    super(runtimeMeter);
  }

  /** Lazy shared default for all programs and builtin namespaces using these
   * values. Explicit execution policies may replace it without touching guests. */
  get identity(): ExecutionIdentity {
    return this.#identity ??= new ExecutionIdentity(this.runtimeMeter);
  }

  /** Adopt explicitly allocated instance storage without running guest methods.
   * Missing dictionary denotes a dictionary-less layout; a trusted factory
   * supplies lazy storage without making ordinary reads allocate it. */
  instance(type: TypeValue, dictionary?: DictionaryValue | (() => DictionaryValue), native?: InstanceValue["native"]): InstanceValue {
    this.runtimeMeter.checkpoint(1, native === undefined ? 48 : 56);
    const state = new RuntimeInstanceState(type, dictionary, this.runtimeMeter);
    return Object.freeze({ kind: "instance", state, native, get type() { return state.type; }, get dictionary() { return state.dictionary; } });
  }

  /** Adopt trusted owned storage (for example, a slice) without a second copy. */
  list(items: readonly RuntimeValue[] | ListStorage<RuntimeValue>): ListValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "list", items: items instanceof ListStorage ? items : new ListStorage(items, this.runtimeMeter) });
  }

  range(value: IntegerProgression, components?: Partial<Pick<RangeValue, "start" | "stop" | "step">>): RangeValue {
    this.runtimeMeter.checkpoint(1, 56);
    return Object.freeze({ kind: "range", value,
      start: components?.start ?? this.integer(value.start), stop: components?.stop ?? this.integer(value.stop), step: components?.step ?? this.integer(value.step)
    });
  }

  iterator(value: CompletionIterator<RuntimeValue>,typeName?:string): IteratorValue {
    this.runtimeMeter.checkpoint(1, typeName===undefined?32:40);
    return Object.freeze(typeName===undefined?{ kind: "iterator", value }:{kind:"iterator",value,typeName});
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
    const state = new RuntimeMethodDecoratorState(value, this, this.runtimeMeter, type);
    return Object.freeze({ kind, state, get type() { return state.type; }, get value() { return state.value; } });
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
  type(layout: RuntimeTypeLayout, metaclass: TypeValue | "self", options: { readonly immutable?: boolean; readonly keywordValidation?: "callee" } = {}): TypeValue {
    this.runtimeMeter.checkpoint(1, 48);
    return new RuntimeTypeRecord(layout, metaclass, options.immutable ?? false, options.keywordValidation);
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

  /** Outer initialization replaces nested entries on success and clears them
   * on failure, matching native descriptor qualified-name caching. */
  descriptorQualifiedName(descriptor: NativeDescriptorValue, create: () => Extract<PrimitiveConstant, { kind: "str" }>): Extract<PrimitiveConstant, { kind: "str" }> {
    this.runtimeMeter.checkpoint();
    const cached = this.#descriptorQualifiedNames?.get(descriptor);
    if (cached !== undefined) return cached;
    try {
      const value = create();
      this.runtimeMeter.checkpoint(1, this.#descriptorQualifiedNames === undefined ? 112 : 48);
      this.#descriptorQualifiedNames ??= new WeakMap();
      this.#descriptorQualifiedNames.set(descriptor, value);
      return value;
    } catch (error) {
      this.#descriptorQualifiedNames?.delete(descriptor);
      throw error;
    }
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

  mappingProxy(value: RuntimeValue, owner?: InstanceValue): MappingProxyValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind: "mappingproxy", value: owner ?? value });
  }

  dictionaryView(value: DictionaryValue, kind: DictionaryViewValue["kind"], owner?: InstanceValue): DictionaryViewValue {
    this.runtimeMeter.checkpoint(1, 32);
    return Object.freeze({ kind, value, ...(owner === undefined ? {} : { owner }) });
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
