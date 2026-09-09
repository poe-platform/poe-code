import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { selectTypeMetaclass } from "./metaclass.js";

export interface ClassPreparationContext<Value> {
  readonly defaultType: Value & object;
  tupleItems(value: Value): readonly Value[] | undefined;
  /** Internal type flags/MRO/type names, never virtual guest attribute access. */
  isType(value: Value): value is Value & object;
  typeOf(value: Value): Value & object;
  mro(type: Value & object): readonly (Value & object)[];
  typeName(type: Value & object): string;
  /** Ordinary bound attribute lookup; only AttributeError means absent. */
  lookupPrepare(metaclass: Value): { readonly value: Value } | undefined;
  /** Guest call with name and resolved bases as positional arguments. */
  callPrepare(hook: Value, name: string, bases: Value, keywords: ReadonlyMap<string, Value>): Value;
  emptyNamespace(): Value;
  /** Internal mapping/subscript protocol flag, not an ABC membership test. */
  isMapping(value: Value): boolean;
}

/** Select a metaclass and prepare its class-body namespace. Bases must already
 * have undergone __mro_entries__ resolution. Remove metaclass from a fresh header
 * keyword map, retaining all other keys/order for both prepare and construction.
 * Explicit non-type metaclasses bypass conflict selection and are not checked for
 * callability yet. Guest protocol operations/internal allocation are adapter-owned;
 * body execution, construction, decorators and full heap accounting are separate.
 */
export function prepareClass<Value>(
  name: string, bases: Value, keywords: ReadonlyMap<string, Value>,
  context: ClassPreparationContext<Value>, meter: ExecutionMeter
): { readonly metaclass: Value; readonly namespace: Value; readonly keywords: ReadonlyMap<string, Value> } {
  meter.checkpoint();
  const items = context.tupleItems(bases);
  if (items === undefined) throw new Error("class bases must be an assembled tuple");
  const remaining = new Map<string, Value>();
  for (const [key, value] of keywords) {
    meter.checkpoint();
    if (key !== "metaclass") remaining.set(key, value);
  }
  let metaclass = keywords.has("metaclass") ? keywords.get("metaclass")!
    : items.length ? context.typeOf(items[0]) : context.defaultType;
  if (context.isType(metaclass)) {
    const baseMetaclasses: (Value & object)[] = [];
    for (const base of items) { meter.checkpoint(); baseMetaclasses.push(context.typeOf(base)); }
    metaclass = selectTypeMetaclass(metaclass, baseMetaclasses, context.mro.bind(context), meter);
  }
  meter.checkpoint();
  const prepare = context.lookupPrepare(metaclass);
  meter.checkpoint();
  const namespace = prepare === undefined ? context.emptyNamespace() : context.callPrepare(prepare.value, name, bases, remaining);
  if (prepare !== undefined && !context.isMapping(namespace)) {
    // CPython's %.200s type-name diagnostics truncate UTF-8 at complete characters.
    const diagnosticName = (type: Value & object): string => {
      const name = context.typeName(type);
      let end = 0, bytes = 0;
      while (end < name.length) {
        meter.checkpoint();
        const point = name.codePointAt(end)!;
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (bytes > 200) break;
        end += point > 0xffff ? 2 : 1;
      }
      return name.slice(0, end);
    };
    const metaclassName = context.isType(metaclass) ? diagnosticName(metaclass) : "<metaclass>";
    throw new PythonRuntimeError("TypeError", `${metaclassName}.__prepare__() must return a mapping, not ${diagnosticName(context.typeOf(namespace))}`);
  }
  return { metaclass, namespace, keywords: remaining };
}
