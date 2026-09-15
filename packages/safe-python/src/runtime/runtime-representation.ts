import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { hasNativeRepresentation, runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { listRepresentation } from "./list-representation.js";
import { tupleRepresentation } from "./tuple-representation.js";
import { dictionaryRepresentation } from "./dictionary-representation.js";
import { mappingProxyRepresentation } from "./mapping-proxy-representation.js";
import { RepresentationStack } from "./representation-stack.js";
import { runtimeDictionaryViewRepresentation } from "./runtime-dictionary-view-representation.js";
import { runtimeSetRepresentation } from "./runtime-set-representation.js";
import { runtimeSliceRepresentation } from "./runtime-slice-representation.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";

export interface RuntimeRepresentationHooks {
  /** Pure guest str-subclass storage inspection. */
  string?(value: RuntimeValue): CodePointString | undefined;
  lookupStr?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  lookupRepr?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  typeName?(value: RuntimeValue): string | undefined;
  /** Explicit default for unresolved types; the runtime owns identity/address
   * policy. Other native/container slots must be supplied through lookup hooks. */
  defaultRepr(value: RuntimeValue): RuntimeValue;
}

/** Execution-owned recursion state shared by frame-specific representation
 * policies. The stack is allocated only when a container is represented.
 * Never share this state between independently metered executions. */
export interface RuntimeRepresentationState {
  stack?: RepresentationStack<RuntimeValue>;
}

/** Implemented native slots plus explicit guest representation capabilities.
 * Does not invent generic strings for unfinished native/container types. */
export function createRuntimeRepresentationContext(values: RuntimeValues, meter: ExecutionMeter, hooks: RuntimeRepresentationHooks, state?: RuntimeRepresentationState): RepresentationContext<RuntimeValue> {
  meter.checkpoint(1, 384);
  // Conservative host-callback depth policy until execution is trampolined.
  // Lazily allocate the path guard so scalar-only formatting pays no stack cost.
  meter.checkpoint(0, state === undefined ? 16 : 0);
  const guards = state ?? {};
  const context: RepresentationContext<RuntimeValue> = {
    isExactString(value) { meter.checkpoint(); return value.kind === "str"; },
    string(value) { meter.checkpoint(); return runtimeStringPayload(value)?.value ?? hooks.string?.(value); },
    lookupStr(value) {
      meter.checkpoint();
      if (value.kind === "mappingproxy") {
        meter.checkpoint(0, 64);
        return () => {
          let mapping = value.value;
          while (mapping.kind === "mappingproxy") { meter.checkpoint(); mapping = mapping.value; }
          return representationObject(mapping, "str", context, meter);
        };
      }
      if (value.kind === "list" || value.kind === "tuple" || value.kind === "dict" || value.kind === "set" || value.kind === "frozenset") return undefined; // object.__str__ falls back to repr.
      if (value.kind === "slice" || value.kind === "dict_keys" || value.kind === "dict_values" || value.kind === "dict_items") return undefined;
      if (hasNativeRepresentation(value)) {
        meter.checkpoint(0, 64);
        return () => runtimeNativeRepresentation(value, "__str__", values, meter);
      }
      return hooks.lookupStr?.(value);
    },
    lookupRepr(value) {
      meter.checkpoint();
      if (value.kind === "slice") {
        meter.checkpoint(0, 64);
        return () => values.stringPoints(runtimeSliceRepresentation(value, context, meter));
      }
      if (value.kind === "set" || value.kind === "frozenset") {
        meter.checkpoint(0, 64);
        return () => {
          const stack = guards.stack ??= new RepresentationStack<RuntimeValue>(100, meter);
          return values.stringPoints(runtimeSetRepresentation(value, values, context, stack, meter));
        };
      }
      if (value.kind === "dict_keys" || value.kind === "dict_values" || value.kind === "dict_items") {
        meter.checkpoint(0, 64);
        return () => {
          const stack = guards.stack ??= new RepresentationStack<RuntimeValue>(100, meter);
          return values.stringPoints(runtimeDictionaryViewRepresentation(value, values, context, stack, meter));
        };
      }
      if (value.kind === "mappingproxy") {
        meter.checkpoint(0, 64);
        return () => {
          let mapping = value.value, depth = 1;
          while (mapping.kind === "mappingproxy") { meter.checkpoint(); depth++; mapping = mapping.value; }
          return values.stringPoints(mappingProxyRepresentation(mapping, context, meter, depth));
        };
      }
      if (value.kind === "list" || value.kind === "tuple" || value.kind === "dict") {
        meter.checkpoint(0, 64);
        return () => {
          const stack = guards.stack ??= new RepresentationStack<RuntimeValue>(100, meter);
          if (value.kind === "dict") {
            meter.checkpoint(1, 64);
            const text = dictionaryRepresentation(value, () => {
              meter.checkpoint(1, 96);
              let position = 0;
              return {
                next() {
                  meter.checkpoint(1, 64);
                  const row = value.items.nextDictionaryEntry(position);
                  if (row === undefined) return { done: true, value: undefined };
                  position = row.position;
                  return { done: false, value: [row.key, row.value] as const };
                }
              };
            }, context, stack, meter);
            return values.stringPoints(text);
          }
          const text = value.kind === "list"
            ? listRepresentation(value, value.items, context, stack, meter)
            : tupleRepresentation(value, value.items, context, stack, meter);
          return values.stringPoints(text);
        };
      }
      if (hasNativeRepresentation(value)) {
        meter.checkpoint(0, 64);
        return () => runtimeNativeRepresentation(value, "__repr__", values, meter);
      }
      return hooks.lookupRepr?.(value);
    },
    typeName(value) {
      meter.checkpoint();
      const custom = hooks.typeName?.(value); meter.checkpoint();
      return custom ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    },
    defaultRepr(value) { meter.checkpoint(); return hooks.defaultRepr(value); },
    stringPoints(value) { meter.checkpoint(); return values.stringPoints(value); }
  };
  return context;
}
