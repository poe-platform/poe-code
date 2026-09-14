import type { ConstantValues, PrimitiveConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { rangeIndexOf } from "./integer-sequence.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { containsRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { runtimeSetAccess } from "./runtime-set.js";
import { protocolContains, type ContainmentContext } from "./containment-protocol.js";
import { validateIndexResult } from "./index-protocol.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { createRuntimeSearchEquality, type RuntimeSearchEqualityContext } from "./runtime-search-equality.js";

export interface RuntimeMembershipContext extends RuntimeSearchEqualityContext, Pick<BuiltinInvocationContext, "isException" | "actualType"> {
  readonly buffers?: RuntimeBufferContext;
}

/** Exact runtime membership. Integer/bool range searches use arithmetic; other
 * iterable searches consume only through the first identity/equality match.
 * Optional guest containment overrides native dispatch for this container.
 * Byte needles accept guest index slots before contiguous buffer exports.
 */
export function runtimeMembership(operator: string, needle: RuntimeValue, container: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, protocol?: ContainmentContext<RuntimeValue>, context?: RuntimeMembershipContext): Extract<PrimitiveConstant, { kind: "bool" }> {
  meter.checkpoint();
  if (operator !== "in" && operator !== "not in") throw new Error(`unsupported constant membership operator: ${operator}`);
  while (container.kind === "mappingproxy") { meter.checkpoint(); container = container.value; }
  if (protocol !== undefined) {
    const found = protocolContains(needle, container, protocol, meter);
    meter.checkpoint();
    return values.boolean(operator === "in" ? found : !found);
  }
  let found = false;
  if (container.kind === "set" || container.kind === "frozenset") {
    found = runtimeSetAccess(container, needle, "contains", values, meter, context);
  } else if (container.kind === "dict_keys" || container.kind === "dict_values" || container.kind === "dict_items") {
    const comparisons = containsRuntimeDictionaryView(container, needle, meter);
    const equal = createRuntimeSearchEquality(values, meter, context);
    let item = comparisons.next();
    while (!item.done) {
      meter.checkpoint();
      item = comparisons.next(equal(item.value[0], item.value[1]));
    }
    found = item.value;
  } else if (container.kind === "dict") {
    found = runtimeDictionaryAccess(container, needle, "contains", meter);
  } else if (container.kind === "range" && (needle.kind === "int" || needle.kind === "bool")) {
    const integer = needle.kind === "int" ? needle.value : needle.value ? 1n : 0n;
    found = rangeIndexOf(container.value, integer) !== undefined;
  } else if (container.kind === "tuple" || container.kind === "list" || container.kind === "iterator" || container.kind === "range") {
    const iterator = runtimeIterate(container, values, meter);
    const equal = createRuntimeSearchEquality(values, meter, context);
    while (true) {
      meter.checkpoint();
      const item = iterator.next();
      meter.checkpoint();
      if (item.done) break;
      const member = item.value;
      if (member === needle || equal(member, needle)) { found = true; break; }
    }
  } else if (container.kind === "str") {
    const text = runtimeStringPayload(needle);
    if (text === undefined) {
      const nativeName = needle.kind === "instance" ? needle.type.value.diagnosticName : needle.kind === "none" ? "NoneType" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind;
      const name = diagnosticTypeName(context?.actualType?.(needle).value.diagnosticName ?? nativeName, meter, 100);
      throw new PythonRuntimeError("TypeError", `'in <string>' requires string as left operand, not ${name}`);
    }
    found = container.value.search(text.value, "find", 0n, null, meter) !== -1;
  } else if (container.kind === "bytes") {
    if (needle.kind === "bytes") found = container.value.contains(needle.value, meter);
    else {
      const indices = context?.integerIndex;
      let integer = needle.kind === "int" ? needle.value : needle.kind === "bool" ? needle.value ? 1n : 0n : indices?.integer(needle);
      meter.checkpoint();
      if (integer === undefined && indices !== undefined) {
        // bytes containment clears failed index conversions before attempting
        // a buffer export, including guest BaseException subclasses. Sandbox
        // termination and host failures must still escape this conversion.
        try {
          const slot = indices.lookupIndex(needle); meter.checkpoint();
          if (slot !== undefined) integer = indices.integer(validateIndexResult(slot(), indices, meter));
        } catch (error) {
          if (!(error instanceof PythonRuntimeError) && !runtimeExceptionMatches(error, "BaseException", context)) throw error;
        }
        meter.checkpoint();
      }
      if (integer !== undefined) {
        if (integer < 0n || integer > 255n) throw new PythonRuntimeError("ValueError", "byte must be in range(0, 256)");
        found = container.value.contains(Number(integer), meter);
      } else {
        let lease: RuntimeBufferLease | undefined;
        try {
          lease = context?.buffers?.acquireSimple(needle); meter.checkpoint();
          if (lease === undefined) {
            const nativeName = needle.kind === "none" ? "NoneType" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind;
            const name = context?.buffers?.typeName === undefined ? nativeName : diagnosticTypeName(context.buffers.typeName(needle), meter);
            throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${name}'`);
          }
          const bytes = lease.copy(); meter.checkpoint();
          found = container.value.contains(bytes, meter);
        } finally {
          lease?.release(); meter.checkpoint();
        }
      }
    }
  } else {
    const name = container.kind === "none" ? "NoneType" : container.kind === "not-implemented" ? "NotImplementedType" : container.kind;
    throw new PythonRuntimeError("TypeError", `argument of type '${name}' is not a container or iterable`);
  }
  return values.boolean(operator === "in" ? found : !found);
}
