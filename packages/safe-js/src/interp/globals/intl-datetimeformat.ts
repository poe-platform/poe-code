import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { createBoundFunction } from "../bound-function.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createSandboxDateTimeFormat, formatDateTimeValue, dateTimeFormatState, isTemporalDateTimeInput } from "../intl-datetimeformat.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";
import { sandboxNumber } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";

const supportedLocalesOf = Intl.DateTimeFormat.supportedLocalesOf;

export function createDateTimeFormatConstructor(budget: Budget, now: SandboxClosure): SandboxClosure {
  const prototype = createIntrinsicObject();
  const formatTarget = createSandboxClosure({
    guest: true, sandbox: true, name: "", length: 1,
    call: async ([input], context) => {
      dateTimeFormatState(context?.thisValue);
      let value: SandboxValue = 0;
      const release = retainValues(budget, () => [context?.thisValue, value]);
      try {
        value = input === undefined ? await now.call([], context) as number : isTemporalDateTimeInput(input) ? input : await sandboxNumber(input, budget, context);
        return allocateProducedSandboxValue(formatDateTimeValue(context?.thisValue, "format", [value]), budget);
      } finally { release(); }
    }
  });
  registerBuiltinIdentities(budget, { "%DateTimeFormatFormat%": formatTarget });
  registerIntrinsicFunction(budget, formatTarget);
  const initialize = async ([input, options]: readonly SandboxValue[], context?: SandboxCallContext): Promise<SandboxValue> => {
    const target = context?.newTarget;
    let selected = target === undefined || target === constructor ? prototype
      : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
      : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
    if (selected === null || typeof selected !== "object")
      selected = getFunctionRealmPrototype(target, "Intl.DateTimeFormat", prototype);
    let locales: string[] = [];
    const release = retainValues(budget, () => [selected, locales]);
    try {
      locales = await canonicalizeGuestLocales(input, budget, context);
      const converted = await readDateTimeFormatOptions(options, budget, context);
      const value = createSandboxDateTimeFormat(locales, converted);
      setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
      return allocateProducedSandboxValue(value, budget);
    } finally { release(); }
  };
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "DateTimeFormat", length: 0,
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
    [Symbol.toStringTag]: { value: "Intl.DateTimeFormat", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...dateTimeFormatState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true },
    format: { get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get format", length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        const state = dateTimeFormatState(receiver);
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
        dateTimeFormatState(context?.thisValue);
        if (range && (first === undefined || second === undefined)) throw new TypeError("DateTimeFormat range requires both values.");
        const values: SandboxValue[] = [];
        const release = retainValues(budget, () => [context?.thisValue, values]);
        try {
          values.push(!range && first === undefined ? await now.call([], context) as number : isTemporalDateTimeInput(first) ? first : await sandboxNumber(first, budget, context));
          if (range) values.push(isTemporalDateTimeInput(second) ? second : await sandboxNumber(second, budget, context));
          return allocateProducedSandboxValue(formatDateTimeValue(context?.thisValue, method, values), budget);
        } finally { release(); }
      }
    }), writable: true, configurable: true });
  }
  return constructor;
}
