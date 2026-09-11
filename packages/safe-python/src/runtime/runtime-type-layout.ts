import type { ExecutionMeter } from "./execution-budget.js";
import { linearizeMro } from "./mro.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { ClassAttribute } from "./instance-attributes.js";
import { resolveRuntimeClassAttribute, type RuntimeDescriptorContext } from "./runtime-descriptor.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";
import { PythonRuntimeError } from "./error.js";

export interface RuntimeTypeLayoutOptions {
  /** Native single positional class pattern matches the whole subject. */
  readonly matchSelf?:boolean;
  /** Trusted structural-pattern classification, independent of slot presence. */
  readonly patternKind?:"sequence"|"mapping";
  /** Native allocation family can remain compatible while added native fields
   * establish a distinct storage layout for multiple inheritance. */
  readonly nativeAllocator?: RuntimeTypeLayout;
  /** Static native types such as dictionary views cannot be allocated directly. */
  readonly instantiable?: boolean;
  /** Prepared, sorted/mangled own slot names; duplicates occupy separate cells. */
  readonly slots?: readonly string[];
  readonly weakReferences?: boolean;
  /** Variable-item native bases cannot add nonempty slot declarations. */
  readonly variableSized?: boolean;
  /** Native base-type permission, independent of mutability or payload layout.
   * Source annotations/decorators do not set this internal capability. */
  readonly subclassable?: boolean;
  /** Internal allocation boundary: publish metadata/class cells before C3 can
   * fail. The layout has no MRO yet; callbacks must not treat it as ready. */
  readonly beforeMro?: (layout: RuntimeTypeLayout) => void;
  /** Prepared lexical name; class builders extract this from __qualname__. */
  readonly qualifiedName?: string;
  /** Presence of the native sequence protocol table, not whether any slot is
   * implemented or whether the type is a Sequence. Heap types have a table even
   * when empty; static native types can omit it. This affects *= fallback. */
  readonly sequenceTable?: boolean;
  /** Heap instances normally have dictionaries. Inherited dictionary storage
   * cannot be removed by a derived dictionary-less layout. */
  readonly instanceDictionary?: boolean;
  /** False for native payload layouts that object.__new__ cannot allocate.
   * Derived layouts cannot turn an unsafe native base back into plain objects. */
  readonly objectLayout?: boolean;
}

/** Immutable inheritance metadata with an owned, live namespace. The class
 * builder supplies explicit bases (including object) and prepares the namespace.
 * This is not a guest type value; metaclass policy and mutable __bases__ belong
 * to class construction and the object layer.
 */
export class RuntimeTypeLayout {
  readonly matchSelf:boolean;
  readonly patternKind:"sequence"|"mapping"|undefined;
  readonly names: RuntimeTypeNames;
  readonly bases: readonly RuntimeTypeLayout[];
  #mro: readonly RuntimeTypeLayout[] = Object.freeze([]);
  readonly namespace: DictionaryValue;
  readonly hasSequenceTable: boolean;
  readonly hasInstanceDictionary: boolean;
  readonly hasObjectLayout: boolean;
  readonly isSubclassable: boolean;
  readonly isInstantiable: boolean;
  /** Defining native payload layout. Heap subclasses share it; introducing a
   * new native payload establishes a distinct layout even above a native base. */
  readonly nativeStorage: RuntimeTypeLayout | undefined;
  readonly nativeAllocator: RuntimeTypeLayout | undefined;
  readonly layoutBase: RuntimeTypeLayout | undefined;
  readonly solidLayout: RuntimeTypeLayout | undefined;
  readonly slotNames: readonly string[];
  readonly slotCount: number;
  readonly hasWeakReferences: boolean;
  readonly variableSized: boolean;

  constructor(name: string, bases: readonly RuntimeTypeLayout[], namespace: DictionaryValue, meter: ExecutionMeter, options: RuntimeTypeLayoutOptions = {}) {
    meter.checkpoint(1, 232 + 8 * bases.length + 8 * (options.slots?.length ?? 0));
    const layoutBase = selectRuntimeLayoutBase(bases, meter);
    this.names = new RuntimeTypeNames(name, options.qualifiedName ?? name, meter);
    this.bases = Object.freeze([...bases]);
    this.namespace = namespace;
    this.hasSequenceTable = options.sequenceTable ?? true;
    this.patternKind=options.patternKind;
    this.matchSelf=options.matchSelf??layoutBase?.matchSelf??false;
    this.isSubclassable = options.subclassable ?? true;
    this.isInstantiable = options.instantiable ?? true;
    this.layoutBase = layoutBase;
    this.slotNames = Object.freeze([...(options.slots ?? [])]);
    this.slotCount = (layoutBase?.slotCount ?? 0) + this.slotNames.length;
    this.nativeStorage = options.objectLayout === false ? this : layoutBase?.nativeStorage;
    this.nativeAllocator = options.nativeAllocator ?? (options.objectLayout === false ? this : layoutBase?.nativeAllocator);
    this.solidLayout = options.objectLayout === false || this.slotNames.length !== 0 ? this : layoutBase?.solidLayout;
    this.variableSized = options.variableSized ?? layoutBase?.variableSized ?? false;
    let dictionary = options.instanceDictionary ?? true, objectLayout = options.objectLayout ?? true;
    let weakReferences = options.weakReferences ?? !this.variableSized;
    for (const base of bases) { meter.checkpoint(); dictionary ||= base.hasInstanceDictionary; objectLayout &&= base.hasObjectLayout; weakReferences ||= base.hasWeakReferences; }
    this.hasInstanceDictionary = dictionary;
    this.hasObjectLayout = objectLayout;
    this.hasWeakReferences = weakReferences;
    Object.freeze(this);
    options.beforeMro?.(this); meter.checkpoint();
    this.#mro = linearizeMro<RuntimeTypeLayout>(this, this.bases, base => base.mro, meter);
  }

  get name(): string { return this.names.name; }
  get mro(): readonly RuntimeTypeLayout[] { return this.#mro; }
}

/** Select the most-specific storage-bearing base while validating bases in
 * order. Native payloads and declared slots determine storage ancestry;
 * dictionary/weak-reference additions alone do not create a conflicting base. */
export function selectRuntimeLayoutBase(bases: readonly RuntimeTypeLayout[], meter: ExecutionMeter): RuntimeTypeLayout | undefined {
  let selected: RuntimeTypeLayout | undefined;
  for (const base of bases) {
    meter.checkpoint();
    if (!base.isSubclassable) {
      meter.checkpoint(0, 128 + 2 * base.name.length);
      throw new PythonRuntimeError("TypeError", `type '${base.name}' is not an acceptable base type`);
    }
    if (selected === undefined) { selected = base; continue; }
    const candidate = base.solidLayout, previous = selected.solidLayout;
    if (candidate === undefined || candidate === previous) continue;
    if (previous === undefined) { selected = base; continue; }
    let moreSpecific = false, lessSpecific = false;
    for (const ancestor of candidate.mro) { meter.checkpoint(); if (ancestor === previous) { moreSpecific = true; break; } }
    if (moreSpecific) { selected = base; continue; }
    for (const ancestor of previous.mro) { meter.checkpoint(); if (ancestor === candidate) { lessSpecific = true; break; } }
    if (!lessSpecific) throw new PythonRuntimeError("TypeError", "multiple bases have instance lay-out conflict");
  }
  return selected;
}

/** Strip subclasses that add no storage, then compare sibling additions. Equal
 * slot names on unrelated storage-bearing parent classes are not interchangeable. */
export function compatibleRuntimeLayouts(left: RuntimeTypeLayout, right: RuntimeTypeLayout, meter: ExecutionMeter): boolean {
  const sameStorage = (a: RuntimeTypeLayout, b: RuntimeTypeLayout) => a.nativeStorage === b.nativeStorage && a.slotCount === b.slotCount
    && a.hasInstanceDictionary === b.hasInstanceDictionary && a.hasWeakReferences === b.hasWeakReferences;
  while (left.layoutBase !== undefined && sameStorage(left, left.layoutBase)) { meter.checkpoint(); left = left.layoutBase; }
  while (right.layoutBase !== undefined && sameStorage(right, right.layoutBase)) { meter.checkpoint(); right = right.layoutBase; }
  if (left === right) return true;
  if (left.layoutBase !== right.layoutBase || !sameStorage(left, right) || left.slotNames.length !== right.slotNames.length) return false;
  for (let index = 0; index < left.slotNames.length; index++) { meter.checkpoint(); if (left.slotNames[index] !== right.slotNames[index]) return false; }
  return true;
}

/** Resolve only the winning MRO value's descriptor slots. No namespace cache is
 * used: mutations remain visible without rebuilding immutable inheritance data.
 */
export function resolveRuntimeTypeAttribute(
  layout: RuntimeTypeLayout,
  name: Extract<RuntimeValue, { kind: "str" }>,
  context: RuntimeDescriptorContext,
  values: RuntimeValues,
  meter: ExecutionMeter
): { readonly owner: RuntimeTypeLayout; readonly attribute: ClassAttribute<RuntimeValue, RuntimeValue, RuntimeValue> } | undefined {
  const found = lookupMroAttribute(layout.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter);
  if (found === undefined) return undefined;
  meter.checkpoint(1, 32);
  const attribute = resolveRuntimeClassAttribute(found.value, context, values, meter);
  meter.checkpoint();
  return Object.freeze({ owner: found.owner, attribute });
}
