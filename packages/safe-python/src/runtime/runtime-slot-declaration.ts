import { isIdentifierContinue, isIdentifierStart } from "../identifiers.js";
import { manglePrivateName } from "../private-names.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { hasRuntimeInstanceAttributes, type DictionaryValue, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

export interface RuntimeSlotDeclarationContext {
  readonly namespace: DictionaryValue;
  readonly dictionaryAllowed: boolean;
  readonly weakReferencesAllowed: boolean;
  readonly variableSizedBase?: string;
  readonly iteration?: IterationContext<RuntimeValue>;
}

export interface RuntimeSlotDeclaration {
  readonly names: readonly string[];
  readonly dictionary: boolean;
  readonly weakReferences: boolean;
}

/** Consume the declaration before validating entries, matching tuple conversion.
 * Keep the original namespace value intact. Names are mangled but never NFKC
 * normalized; duplicate ordinary slots retain distinct storage positions. */
export function prepareRuntimeSlotDeclaration(className: string, declaration: RuntimeValue, context: RuntimeSlotDeclarationContext, values: RuntimeValues, meter: ExecutionMeter): RuntimeSlotDeclaration {
  meter.checkpoint(1, 96);
  const entries: RuntimeValue[] = [];
  if (declaration.kind === "str") entries.push(declaration);
  else {
    const iterator = runtimeIterate(declaration, values, meter, context.iteration, undefined, true);
    for (let item = iterator.next(); !item.done; item = iterator.next()) { meter.checkpoint(1, 8); entries.push(item.value); }
  }
  meter.checkpoint();
  if (entries.length !== 0 && context.variableSizedBase !== undefined) throw new PythonRuntimeError("TypeError", `nonempty __slots__ not supported for subtype of '${context.variableSizedBase}'`);
  const names: { readonly text: string; readonly value: Extract<RuntimeValue, { kind: "str" }> }[] = [];
  let dictionary = false, weakReferences = false;
  for (const entry of entries) {
    meter.checkpoint();
    if (entry.kind !== "str") {
      const type = hasRuntimeInstanceAttributes(entry) ? entry.type.value.name : entry.kind === "type" ? entry.metaclass.value.name : entry.kind === "none" ? "NoneType" : entry.kind === "not-implemented" ? "NotImplementedType" : entry.kind;
      throw new PythonRuntimeError("TypeError", `__slots__ items must be strings, not '${type}'`);
    }
    let text = "", first = true;
    for (const point of entry.value) {
      meter.checkpoint(1, point > 0xffff ? 4 : 2);
      if (!(first ? isIdentifierStart(point) : isIdentifierContinue(point))) throw new PythonRuntimeError("TypeError", "__slots__ must be identifiers");
      first = false; text += String.fromCodePoint(point);
    }
    if (first) throw new PythonRuntimeError("TypeError", "__slots__ must be identifiers");
    if (text === "__dict__") {
      if (!context.dictionaryAllowed || dictionary) throw new PythonRuntimeError("TypeError", "__dict__ slot disallowed: we already got one");
      dictionary = true;
    } else if (text === "__weakref__") {
      if (!context.weakReferencesAllowed || weakReferences) throw new PythonRuntimeError("TypeError", "__weakref__ slot disallowed: we already got one");
      weakReferences = true;
    } else {
      text = manglePrivateName(text, className); const value = values.string(text);
      if (text !== "__classcell__" && text !== "__qualname__" && context.namespace.items.lookup(value) !== undefined) throw new PythonRuntimeError("ValueError", `'${text}' in __slots__ conflicts with class variable`);
      meter.checkpoint(1, 32 + 2 * text.length); names.push({ text, value });
    }
  }
  names.sort((left, right) => left.value.value.compare(right.value.value, meter));
  meter.checkpoint(1, 32 + names.length * 8);
  return Object.freeze({ names: Object.freeze(names.map(name => name.text)), dictionary, weakReferences });
}
