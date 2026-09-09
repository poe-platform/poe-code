import { UnsupportedExpressionError, type ExpressionContext } from "./expression-evaluation.js";
import type { ConstantUnaryContext } from "./constant-unary.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeUnary } from "./runtime-unary.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { beginRuntimeDictionary } from "./runtime-dictionary-display.js";
import type { KeyOperations } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { beginRuntimeSet } from "./runtime-set.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createRuntimeFormattedStringContext } from "./runtime-formatted-string.js";
import type { FormatContext } from "./format-protocol.js";

/** Explicit scope/object capabilities, supplied by the surrounding runtime.
 * Attribute lookup defaults to implemented exact native container members;
 * an explicit hook replaces that policy. No host property lookup, callable
 * execution or mapping access is implicit.
 * Supplying a key policy enables native dictionary and set construction;
 * callers without one must supply both construction capabilities explicitly.
 * Hooks must implement guest semantics and charge their execution internally.
 */
export type RuntimeExpressionBindings = Pick<ExpressionContext<RuntimeValue>,
  "load" | "store" | "beginCall" | "createLambda"> &
  Partial<Pick<ExpressionContext<RuntimeValue>, "attribute" | "literal" | "formattedString">> &
  { readonly formatting?: FormatContext<RuntimeValue> } &
  Pick<ConstantUnaryContext, "warn"> & (
    Pick<ExpressionContext<RuntimeValue>, "beginDictionary" | "beginSet"> |
    { readonly dictionaryKeys: KeyOperations<RuntimeValue> } & Partial<Pick<ExpressionContext<RuntimeValue>, "beginSet">>
  );

/** Assemble concrete exact-value operations with scope/object hooks. Setup runs
 * no guest code. The factory and hooks belong to the same metered execution.
 * This is not yet a complete interpreter context: declined binary families fail
 * as host implementation gaps until full reflected dispatch/diagnostics exist.
 */
export function createRuntimeExpressionContext(values: RuntimeValues, bindings: RuntimeExpressionBindings, meter: ExecutionMeter): ExpressionContext<RuntimeValue> {
  meter.checkpoint(1, 768);
  const unary = { values, warn: bindings.warn.bind(bindings) };
  const formatting = bindings.formatting ?? createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("interpolated-string"); } });
  const context: ExpressionContext<RuntimeValue> = {
    literal: bindings.literal?.bind(bindings) ?? values.literal.bind(values),
    boolean: values.boolean.bind(values),
    tuple: items => values.tuple(items),
    list: values.list.bind(values),
    slice: parts => values.slice(parts),
    load: bindings.load.bind(bindings),
    store: bindings.store.bind(bindings),
    attribute: bindings.attribute?.bind(bindings) ?? ((receiver, name) => runtimeNativeAttribute(receiver, name, values, meter, context.beginCall, formatting)),
    beginCall: bindings.beginCall.bind(bindings),
    beginSet: "dictionaryKeys" in bindings
      ? bindings.beginSet?.bind(bindings) ?? (initial => beginRuntimeSet(initial, values, bindings.dictionaryKeys, meter))
      : bindings.beginSet.bind(bindings),
    beginDictionary: "beginDictionary" in bindings
      ? bindings.beginDictionary.bind(bindings)
      : initial => beginRuntimeDictionary(initial, values, bindings.dictionaryKeys, meter),
    unary: (operator, value) => runtimeUnary(operator, value, unary, meter),
    binary(operator, left, right) {
      const result = runtimeBinary(operator, left, right, values, meter);
      if (result === values.notImplemented) throw new UnsupportedExpressionError("binary");
      return result;
    },
    compare: (operator, left, right) => operator === "in" || operator === "not in"
      ? runtimeMembership(operator, left, right, values, meter)
      : runtimeComparison(operator, left, right, values, meter),
    truth: value => runtimeTruth(value, meter),
    getItem: (object, key) => runtimeIndex(object, key, values, meter),
    iterate: value => runtimeIterate(value, values, meter)
  };
  if (bindings.createLambda) context.createLambda = bindings.createLambda.bind(bindings);
  context.formattedString = bindings.formattedString ?? createRuntimeFormattedStringContext(values, formatting, meter);
  return context;
}
