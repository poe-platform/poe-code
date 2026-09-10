import { UnsupportedExpressionError, type ExpressionContext } from "./expression-evaluation.js";
import type { ConstantUnaryContext } from "./constant-unary.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeNumericOperation } from "./runtime-numeric-operation.js";
import type { RuntimeNumericContext } from "./runtime-numeric-slots.js";
import { runtimePowerOperation, type RuntimePowerContext } from "./runtime-power-operation.js";
import { runtimeAddition, type AdditionContext } from "./runtime-addition.js";
import { runtimeMultiplication, type MultiplicationContext } from "./runtime-multiplication.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeRichComparison, type RuntimeRichComparisonContext } from "./runtime-rich-comparison.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeUnary, type RuntimeUnaryProtocol } from "./runtime-unary.js";
import { hasRuntimeInstanceAttributes, type AttributeInstanceValue, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";
import { beginRuntimeDictionary } from "./runtime-dictionary-display.js";
import type { KeyOperations } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { beginRuntimeSet } from "./runtime-set.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createRuntimeFormattedStringContext } from "./runtime-formatted-string.js";
import type { FormatContext } from "./format-protocol.js";
import type { ContainmentContext } from "./containment-protocol.js";
import type { IterationContext } from "./protocol-iterator.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { RuntimeBytesInputProtocol } from "./runtime-bytes-input.js";
import type { RuntimeStringTranslationContext } from "./runtime-string-translate-method.js";
import type { RuntimeBufferContext } from "./runtime-buffer-context.js";

/** Explicit scope/object capabilities, supplied by the surrounding runtime.
 * Attribute lookup defaults to implemented exact native container members;
 * an explicit hook replaces that policy. No host property lookup, callable
 * execution or mapping access is implicit.
 * Supplying a key policy enables native dictionary and set construction;
 * callers without one must supply both construction capabilities explicitly.
 * A truth hook replaces native truth for expressions and statement conditions;
 * it owns both native handling and guest bool/length protocol dispatch.
 * Hooks must implement guest semantics and charge their execution internally.
 */
export type RuntimeExpressionBindings = Pick<ExpressionContext<RuntimeValue>,
  "load" | "store" | "beginCall" | "createLambda"> &
  Partial<Pick<ExpressionContext<RuntimeValue>, "attribute" | "literal" | "constants" | "formattedString" | "truth">> &
  { readonly formatting?: FormatContext<RuntimeValue>;
    readonly integerIndex?: IntegerIndexContext<RuntimeValue>;
    readonly bytes?: RuntimeBytesInputProtocol;
    readonly translation?: RuntimeStringTranslationContext;
    readonly buffers?: RuntimeBufferContext;
    readonly power?: RuntimePowerContext;
    /** Type-level numeric unary methods; logical not remains truth-owned. */
    readonly unary?: RuntimeUnaryProtocol;
    readonly iteration?: IterationContext<RuntimeValue>;
    /** Default owned-instance lookup; an explicit attribute hook still wins. */
    instanceAttribute?(instance: AttributeInstanceValue, name: string): RuntimeValue;
    /** Default class lookup; an explicit attribute hook still wins. */
    typeAttribute?(type: Extract<RuntimeValue, { kind: "type" }>, name: string): RuntimeValue;
    /** Prepare type-level numeric addition slots for the evaluated pair.
     * Native sequence fallback runs only after those slots decline. */
    addition?(left: RuntimeValue, right: RuntimeValue): AdditionContext | undefined;
    /** Numeric negotiation must precede the supplied index repetition policy. */
    multiplication?(left: RuntimeValue, right: RuntimeValue): MultiplicationContext | undefined;
    /** Other ordinary numeric operators and divmod(); specialized +, * and ** hooks win. */
    numeric?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeNumericContext | undefined;
    richComparison?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeRichComparisonContext | undefined;
    /** Return undefined to retain native container handling. */
    containment?(container: RuntimeValue): ContainmentContext<RuntimeValue> | undefined;
  } &
  Pick<ConstantUnaryContext, "warn"> & (
    Pick<ExpressionContext<RuntimeValue>, "beginDictionary" | "beginSet"> |
    { readonly dictionaryKeys: KeyOperations<RuntimeValue> } & Partial<Pick<ExpressionContext<RuntimeValue>, "beginSet">>
  );

/** Assemble concrete exact-value operations with scope/object hooks. Setup runs
 * no guest code. The factory and hooks belong to the same metered execution.
 * Addition includes native fallback/diagnostics and optional guest negotiation.
 * Numeric operators use explicit protocols when supplied and native kernels otherwise.
 */
export function createRuntimeExpressionContext(values: RuntimeValues, bindings: RuntimeExpressionBindings, meter: ExecutionMeter): ExpressionContext<RuntimeValue> {
  meter.checkpoint(1, 960);
  const unary = { values, warn: bindings.warn.bind(bindings) };
  let formatting: FormatContext<RuntimeValue> | undefined;
  const getFormatting = () => {
    meter.checkpoint();
    formatting ??= bindings.formatting ?? createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("interpolated-string"); } });
    meter.checkpoint(); return formatting;
  };
  let formattedString: ExpressionContext<RuntimeValue>["formattedString"], resolved = false;
  const context: ExpressionContext<RuntimeValue> = {
    get formattedString() {
      meter.checkpoint();
      if (!resolved) {
        formattedString = bindings.formattedString ?? createRuntimeFormattedStringContext(values, getFormatting(), meter);
        meter.checkpoint(); resolved = true;
      }
      return formattedString;
    },
    set formattedString(value) { formattedString = value; resolved = true; },
    constants: bindings.constants,
    literal: bindings.literal?.bind(bindings) ?? values.literal.bind(values),
    boolean: values.boolean.bind(values),
    tuple: items => values.tuple(items),
    list: values.list.bind(values),
    slice: parts => values.slice(parts),
    load: bindings.load.bind(bindings),
    store: bindings.store.bind(bindings),
    attribute: bindings.attribute?.bind(bindings) ?? ((receiver, name) => hasRuntimeInstanceAttributes(receiver) && bindings.instanceAttribute !== undefined
      ? bindings.instanceAttribute(receiver, name) : receiver.kind === "type" && bindings.typeAttribute !== undefined
        ? bindings.typeAttribute(receiver, name) : runtimeNativeAttribute(receiver, name, values, meter, context.beginCall, getFormatting, methods)),
    beginCall: bindings.beginCall.bind(bindings),
    beginSet: "dictionaryKeys" in bindings
      ? bindings.beginSet?.bind(bindings) ?? (initial => beginRuntimeSet(initial, values, bindings.dictionaryKeys, meter))
      : bindings.beginSet.bind(bindings),
    beginDictionary: "beginDictionary" in bindings
      ? bindings.beginDictionary.bind(bindings)
      : initial => beginRuntimeDictionary(initial, values, bindings.dictionaryKeys, meter),
    unary: (operator, value) => operator === "not" ? values.boolean(!context.truth(value)) : runtimeUnary(operator, value, unary, meter, bindings.unary),
    binary(operator, left, right, augmented = false) {
      if (operator === "**") return runtimePowerOperation(left, right, values.none, values, meter, bindings.power, augmented);
      if (operator === "+") {
        const addition = bindings.addition?.(left, right);
        meter.checkpoint();
        return runtimeAddition(left, right, values, meter, addition, augmented, bindings.buffers, context);
      }
      if (operator === "*") {
        const multiplication = bindings.multiplication?.(left, right);
        meter.checkpoint();
        return runtimeMultiplication(left, right, values, meter, multiplication, augmented);
      }
      const numeric = bindings.numeric?.(operator, left, right);
      meter.checkpoint();
      return runtimeNumericOperation(operator, left, right, values, meter, numeric, augmented);
    },
    compare(operator, left, right) {
      if (operator === "in" || operator === "not in") {
        const containment = bindings.containment?.(right);
        meter.checkpoint();
        return runtimeMembership(operator, left, right, values, meter, containment, methods);
      }
      if (operator === "is" || operator === "is not") return runtimeComparison(operator, left, right, values, meter);
      const comparison = bindings.richComparison?.(operator, left, right);
      meter.checkpoint();
      return runtimeRichComparison(operator, left, right, values, meter, comparison, members);
    },
    truth(value) {
      meter.checkpoint();
      const result = bindings.truth === undefined ? runtimeTruth(value, meter) : bindings.truth(value);
      meter.checkpoint();
      return result;
    },
    getItem: (object, key) => runtimeIndex(object, key, values, meter, bindings.integerIndex),
    iterate: (value, notIterable, hint) => runtimeIterate(value, values, meter, bindings.iteration, notIterable, hint)
  };
  meter.checkpoint(0, 384);
  const methods = {
    attribute: context.attribute.bind(context),
    dictionaryKeys: "dictionaryKeys" in bindings ? bindings.dictionaryKeys : undefined,
    iterate: context.iterate.bind(context), compare: context.compare.bind(context),
    truth: context.truth.bind(context), get integerIndex() { return bindings.integerIndex; }, bytes: bindings.bytes,
    translation: bindings.translation, buffers: bindings.buffers
  };
  meter.checkpoint(0, 160);
  const members = {
    comparison(operator: string, left: RuntimeValue, right: RuntimeValue) {
      const comparison = bindings.richComparison?.(operator, left, right); meter.checkpoint();
      return comparison === undefined ? undefined : runtimeRichComparison(operator, left, right, values, meter, comparison);
    },
    truth: methods.truth
  };
  if (bindings.createLambda) context.createLambda = bindings.createLambda.bind(bindings);
  return context;
}
