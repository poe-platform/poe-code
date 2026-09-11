import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { createBoundFunction } from "../bound-function.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createSandboxNumberFormat, formatNumberValue, numberFormatState, numberFormatValue } from "../intl-numberformat.js";
import { readNumberFormatOptions } from "../number-locale.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";

const supportedLocalesOf = Intl.NumberFormat.supportedLocalesOf;

export function createNumberFormatConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const formatTarget = createSandboxClosure({
    guest: true, sandbox: true, name: "", length: 1,
    call: async ([input], context) => {
      numberFormatState(context?.thisValue);
      let value: string | number | bigint = 0;
      const release = retainValues(budget, () => [context?.thisValue, value]);
      try {
        value = await numberFormatValue(input, budget, context);
        return allocateProducedSandboxValue(formatNumberValue(context?.thisValue, "format", [value]), budget);
      } finally { release(); }
    }
  });
  registerBuiltinIdentities(budget, { "%NumberFormatFormat%": formatTarget });
  registerIntrinsicFunction(budget, formatTarget);
  const initialize = async ([input, options]: readonly SandboxValue[], context?: SandboxCallContext): Promise<SandboxValue> => {
    const target = context?.newTarget;
    let selected = target === undefined || target === constructor ? prototype
      : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
      : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
    if (selected === null || typeof selected !== "object")
      selected = getFunctionRealmPrototype(target, "Intl.NumberFormat", prototype);
    let locales: string[] = [];
    const release = retainValues(budget, () => [selected, locales]);
    try {
      locales = await canonicalizeGuestLocales(input, budget, context);
      const converted = await readNumberFormatOptions(options, locales, budget, context);
      const value = createSandboxNumberFormat(locales, converted);
      setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
      return allocateProducedSandboxValue(value, budget);
    } finally { release(); }
  };
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "NumberFormat", length: 0,
    construct: initialize,
    call: (args, context) => initialize(args, { ...context, stack: context?.stack ?? [], thisValue: context?.thisValue, newTarget: undefined })
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype, writable: false, configurable: false });
  Object.defineProperty(properties, "supportedLocalesOf", { value: createSandboxClosure({
    guest: true, sandbox: true, name: "supportedLocalesOf", length: 1,
    call: async ([input, options], context) => {
      const locales = await canonicalizeGuestLocales(input, budget, context);
      const release = retainValues(budget, () => [locales]);
      try {
        const source = intlOptionsObject(options, budget);
        const raw = await readIntlProperty(source, "localeMatcher", budget, context);
        const matcher = raw === undefined ? undefined : await convertIntlOption(raw, "localeMatcher", ["lookup", "best fit"], budget, context);
        return allocateProducedSandboxValue(supportedLocalesOf(locales, { localeMatcher: matcher as "lookup" | "best fit" | undefined }), budget);
      } finally { release(); }
    }
  }), writable: true, configurable: true });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Intl.NumberFormat", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...numberFormatState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true },
    format: { get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get format", length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        const state = numberFormatState(receiver);
        if (state.format === undefined) {
          state.format = createBoundFunction({ target: formatTarget, thisValue: receiver, args: [] }, "", 1,
            (target, args, stack, thisValue, _construct, _newTarget, callContext) => invokeBuiltinClosure(target, args, budget, { ...callContext, stack, thisValue }, thisValue));
          allocateProducedSandboxValue(state.format, budget);
        }
        return state.format;
      }
    }), "get"), configurable: true }
  });
  for (const method of ["formatToParts", "formatRange", "formatRangeToParts"] as const) {
    const range = method !== "formatToParts";
    Object.defineProperty(prototype, method, { value: createSandboxClosure({
      guest: true, sandbox: true, name: method, length: range ? 2 : 1,
      call: async ([first, second], context) => {
        numberFormatState(context?.thisValue);
        if (range && (first === undefined || second === undefined)) throw new TypeError("NumberFormat range requires both values.");
        const values: Array<string | number | bigint> = [];
        const release = retainValues(budget, () => [context?.thisValue, values]);
        try {
          values.push(await numberFormatValue(first, budget, context));
          if (range) values.push(await numberFormatValue(second, budget, context));
          return allocateProducedSandboxValue(formatNumberValue(context?.thisValue, method, values), budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  }
  return constructor;
}
