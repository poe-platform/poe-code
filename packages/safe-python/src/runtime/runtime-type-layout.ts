import type { ExecutionMeter } from "./execution-budget.js";
import { linearizeMro } from "./mro.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { ClassAttribute } from "./instance-attributes.js";
import { resolveRuntimeClassAttribute, type RuntimeDescriptorContext } from "./runtime-descriptor.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";
import { PythonRuntimeError } from "./error.js";

export interface RuntimeTypeLayoutOptions {
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
  readonly names: RuntimeTypeNames;
  readonly bases: readonly RuntimeTypeLayout[];
  #mro: readonly RuntimeTypeLayout[] = Object.freeze([]);
  readonly namespace: DictionaryValue;
  readonly hasSequenceTable: boolean;
  readonly hasInstanceDictionary: boolean;
  readonly hasObjectLayout: boolean;
  readonly isSubclassable: boolean;
  /** Defining native payload layout. Heap subclasses share it; introducing a
   * new native payload establishes a distinct layout even above a native base. */
  readonly nativeStorage: RuntimeTypeLayout | undefined;

  constructor(name: string, bases: readonly RuntimeTypeLayout[], namespace: DictionaryValue, meter: ExecutionMeter, options: RuntimeTypeLayoutOptions = {}) {
    meter.checkpoint(1, 160 + 8 * bases.length);
    const nativeStorage = selectRuntimeNativeLayout(bases, meter);
    this.names = new RuntimeTypeNames(name, options.qualifiedName ?? name, meter);
    this.bases = Object.freeze([...bases]);
    this.namespace = namespace;
    this.hasSequenceTable = options.sequenceTable ?? true;
    this.isSubclassable = options.subclassable ?? true;
    this.nativeStorage = options.objectLayout === false ? this : nativeStorage;
    let dictionary = options.instanceDictionary ?? true, objectLayout = options.objectLayout ?? true;
    for (const base of bases) { meter.checkpoint(); dictionary ||= base.hasInstanceDictionary; objectLayout &&= base.hasObjectLayout; }
    this.hasInstanceDictionary = dictionary;
    this.hasObjectLayout = objectLayout;
    Object.freeze(this);
    options.beforeMro?.(this); meter.checkpoint();
    this.#mro = linearizeMro<RuntimeTypeLayout>(this, this.bases, base => base.mro, meter);
  }

  get name(): string { return this.names.name; }
  get mro(): readonly RuntimeTypeLayout[] { return this.#mro; }
}

/** Select compatible native payload ancestry while validating bases in order.
 * Eligibility/layout conflicts precede namespace processing and publication;
 * dictionary/slot signatures belong to the full heap storage layout layer. */
export function selectRuntimeNativeLayout(bases: readonly RuntimeTypeLayout[], meter: ExecutionMeter): RuntimeTypeLayout | undefined {
  let selected: RuntimeTypeLayout | undefined;
  for (const base of bases) {
    meter.checkpoint();
    if (!base.isSubclassable) {
      meter.checkpoint(0, 128 + 2 * base.name.length);
      throw new PythonRuntimeError("TypeError", `type '${base.name}' is not an acceptable base type`);
    }
    const candidate = base.nativeStorage;
    if (candidate === undefined || candidate === selected) continue;
    if (selected === undefined) { selected = candidate; continue; }
    let moreSpecific = false, lessSpecific = false;
    for (const ancestor of candidate.mro) { meter.checkpoint(); if (ancestor === selected) { moreSpecific = true; break; } }
    if (moreSpecific) { selected = candidate; continue; }
    for (const ancestor of selected.mro) { meter.checkpoint(); if (ancestor === candidate) { lessSpecific = true; break; } }
    if (!lessSpecific) throw new PythonRuntimeError("TypeError", "multiple bases have instance lay-out conflict");
  }
  return selected;
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
