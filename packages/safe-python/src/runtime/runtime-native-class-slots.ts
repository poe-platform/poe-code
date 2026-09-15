import {lookupMroAttribute} from "./class-attributes.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeTypeLayout} from "./runtime-type-layout.js";
import type {BuiltinInvocationContext, RuntimeValue, RuntimeValues} from "./runtime-values.js";

const comparisonNames = ["__lt__", "__le__", "__eq__", "__ne__", "__gt__", "__ge__"] as const;
const groups = [["__repr__"], ["__hash__"], ["__call__"], ["__str__"], comparisonNames, ["__iter__"], ["__next__"], ["__init__"], ["__new__"]] as const;
type SlotDefinition = {readonly method: string; readonly name: RuntimeValue; hash?: bigint};
const definitions = new WeakMap<RuntimeValues, readonly (readonly SlotDefinition[])[]>();

function slotDefinitions(values: RuntimeValues, meter: ExecutionMeter): readonly (readonly SlotDefinition[])[] {
  meter.checkpoint();
  let result = definitions.get(values);
  if (result === undefined) {
    meter.checkpoint(0, 128);
    result = groups.map(group => group.map(method => {
      meter.checkpoint(0, 48);
      return {method, name: values.internString(method)};
    }));
    definitions.set(values, result);
  }
  return result;
}

export type NativeClassSlot = {readonly kind: "native"; readonly value: RuntimeValue}
  | {readonly kind: "generic"} | {readonly kind: "absent"};

/** Per-layout dispatch state, distinct from the live class dictionary. A failed
 * fixup lookup can leave a NULL native slot even though its method is present.
 * Generic dispatch deliberately looks the method up again when invoked.
 */
export class RuntimeNativeClassSlots {
  readonly methods = new Map<RuntimeValue, NativeClassSlot>();
  readonly descendants = new Set<WeakRef<RuntimeTypeLayout>>();
  ready = false;

  prepare(layout: RuntimeTypeLayout, values: RuntimeValues, meter: ExecutionMeter): void {
    const prepared = slotDefinitions(values, meter);
    for (const group of prepared) for (const {name} of group) {
      meter.checkpoint(0, 32);
      this.methods.set(name, {kind: "absent"});
    }
    const name = prepared[8][0].name, base = layout.layoutBase;
    if (base === undefined) return;
    let allocator = base.nativeSlots.methods.get(name);
    if (allocator === undefined) {
      const value = lookupMroAttribute(base.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
      if (value !== undefined) allocator = {kind: "native", value};
    }
    if (allocator !== undefined) this.methods.set(name, allocator);
  }

  initialize(layout: RuntimeTypeLayout, values: RuntimeValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException" | "nativeHash">): void {
    const prepared = slotDefinitions(values, meter);
    const eq = prepared[4][2].name, hash = prepared[1][0].name;
    let inheritedHash: NativeClassSlot | undefined, inheritedComparison: NativeClassSlot | undefined;
    // PyType_Ready inherits comparison and hash together only while both are
    // NULL. An override prevents inheritance at every remaining MRO base.
    for (const base of layout.mro.slice(1)) {
      meter.checkpoint();
      if (inheritedHash === undefined && inheritedComparison === undefined
        && layout.namespace.items.lookup(eq) === undefined && layout.namespace.items.lookup(hash) === undefined) {
        inheritedHash = base.nativeSlots.methods.get(hash);
        inheritedComparison = base.nativeSlots.methods.get(eq);
        if (!base.nativeSlots.ready) {
          const hashValue = lookupMroAttribute(base.mro, hash, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
          const eqValue = lookupMroAttribute(base.mro, eq, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
          if (hashValue !== undefined) inheritedHash = {kind: "native", value: hashValue};
          if (eqValue !== undefined) inheritedComparison = {kind: "native", value: eqValue};
        }
        if (inheritedHash?.kind === "absent") inheritedHash = undefined;
        if (inheritedComparison?.kind === "absent") inheritedComparison = undefined;
        if (inheritedHash !== undefined) this.methods.set(hash, inheritedHash);
        if (inheritedComparison !== undefined) {
          for (const {name} of prepared[4]) {
            let slot = name === eq ? inheritedComparison : base.nativeSlots.methods.get(name);
            if (slot === undefined) {
              const value = lookupMroAttribute(base.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
              if (value !== undefined) slot = {kind: "native", value};
            }
            if (slot !== undefined) this.methods.set(name, slot);
          }
        }
      }
      // inherit_slots copies iteration and initialization after comparison at
      // each MRO base. Namespace callbacks can use a published class before
      // fixup installs its own methods. Generic slots share a dispatcher;
      // native slots are distinguished by the descriptor they wrap.
      for (let index = 5; index <= 7; index++) {
        const definition = prepared[index][0], name = definition.name;
        if (this.methods.get(name)?.kind !== "absent") continue;
        const hash = definition.hash ??= invocation?.nativeHash?.(name);
        const slot = base.nativeSlots.inheritedMethod(base, name, meter, hash);
        if (slot !== undefined && slot.kind !== "absent") {
          const parent = base.layoutBase === undefined ? undefined : base.layoutBase.nativeSlots.inheritedMethod(base.layoutBase, name, meter, hash);
          if (parent?.kind !== slot.kind || (slot.kind === "native" && parent.kind === "native" && parent.value !== slot.value)) {
            this.methods.set(name, slot);
          }
        }
      }
    }
    if (inheritedHash === undefined && layout.namespace.items.lookup(hash) === undefined) {
      layout.namespace.items.set(hash, values.none);
      this.methods.set(hash, {kind: "native", value: values.none});
    }
    this.ready = true;
    for (const base of layout.bases) {
      meter.checkpoint(0, 32);
      base.nativeSlots.descendants.add(new WeakRef(layout));
    }
    for (const group of prepared) this.updateGroup(layout, group, meter, invocation);
  }

  private inheritedMethod(layout: RuntimeTypeLayout, name: RuntimeValue, meter: ExecutionMeter, hash?: bigint): NativeClassSlot | undefined {
    const slot = this.methods.get(name);
    if (slot !== undefined) return slot;
    // Bootstrap native layouts expose their slot descriptors directly; heap
    // layouts always use their initialized dispatch state, including NULL.
    const value = lookupMroAttribute(layout.mro, name, (owner, key) => owner.namespace.items.lookup(key, hash), meter)?.value;
    return value === undefined ? undefined : {kind: "native", value};
  }

  update(layout: RuntimeTypeLayout, name: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException" | "nativeHash">): void {
    const group = slotDefinitions(values, meter).find(group => group.some(definition => definition.name === name));
    if (group === undefined) return;
    const visit = (current: RuntimeTypeLayout) => {
      meter.checkpoint();
      if (current.nativeSlots.ready) current.nativeSlots.updateGroup(current, group, meter, invocation);
      for (const reference of current.nativeSlots.descendants) {
        meter.checkpoint();
        const child = reference.deref();
        if (child === undefined) { current.nativeSlots.descendants.delete(reference); continue; }
        if (child.namespace.items.lookup(name) === undefined) visit(child);
      }
    };
    visit(layout);
  }

  private updateGroup(layout: RuntimeTypeLayout, group: readonly SlotDefinition[], meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException" | "nativeHash">): void {
    const found = new Map<RuntimeValue, RuntimeValue>();
    let generic = false;
    let nativeOwner: RuntimeTypeLayout | undefined;
    for (const definition of group) {
      const {method, name} = definition;
      let value: RuntimeValue | undefined;
      // Intrinsic names are exact strings in this interpreter's hash domain.
      // Cache only the immutable intrinsic name's hash in this interpreter's
      // definitions. Every dictionary still performs its live lookup, including
      // subtype-key equality and mutation retries; no method result is cached.
      const hash = definition.hash ??= invocation?.nativeHash?.(name);
      meter.checkpoint(0);
      try { value = lookupMroAttribute(layout.mro, name, (owner, key) => owner.namespace.items.lookup(key, hash), meter)?.value; }
      catch (error) {
        meter.checkpoint();
        // find_name_in_mro clears guest failures during slot fixup only.
        // Fatal metering/cancellation and unsupported host faults escape.
        if (!(error instanceof PythonRuntimeError) && !invocation?.isException?.(error, "BaseException")) throw error;
      }
      if (value === undefined) continue;
      meter.checkpoint(0, 32);
      found.set(name, value);
      if (method === "__hash__" && value.kind === "none") continue;
      if (value.kind === "wrapper_descriptor" && value.value.name === method && layout.mro.includes(value.value.owner.value)) {
        if (nativeOwner !== undefined && nativeOwner !== value.value.owner.value) generic = true;
        nativeOwner = value.value.owner.value;
      } else if (!(method === "__new__" && value.kind === "builtin_function_or_method" && value.value.owner !== undefined && value.value.name === method)) generic = true;
    }
    for (const {name} of group) {
      // One rich-comparison pointer implements all six operations. If one
      // lookup fails, the other compatible wrappers can still select that
      // native family (e.g. tuple comparison for a CodecInfo subclass).
      const value = found.get(name) ?? (!generic && nativeOwner !== undefined && group.length > 1
        ? nativeOwner.namespace.items.lookup(name)?.value : undefined);
      meter.checkpoint(0, 32);
      this.methods.set(name, generic ? {kind: "generic"} : value === undefined ? {kind: "absent"} : {kind: "native", value});
    }
  }
}
