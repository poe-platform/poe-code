import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { createBoundFunction } from "../bound-function.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { collatorState, compareCollatorStrings, createSandboxCollator, readCollatorOptions } from "../intl-collator.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty } from "../intl-options.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, registerIntrinsicFunction, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";

const supportedLocalesOf = Intl.Collator.supportedLocalesOf;

export function createCollatorConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const compareTarget = createSandboxClosure({
    guest: true, sandbox: true, name: "", length: 2,
    call: async ([first, second], context) => {
      let left = "";
      const release = retainValues(budget, () => [context?.thisValue, left]);
      try {
        left = await sandboxString(first, budget, context);
        const right = await sandboxString(second, budget, context);
        budget.visitNode(left.length + right.length);
        return compareCollatorStrings(context?.thisValue, left, right);
      } finally { release(); }
    }
  });
  registerBuiltinIdentities(budget, { "%CollatorCompare%": compareTarget });
  registerIntrinsicFunction(budget, compareTarget);
  const initialize = async ([input, options]: readonly SandboxValue[], context?: SandboxCallContext): Promise<SandboxValue> => {
    const target = context?.newTarget;
    let selected = target === undefined || target === constructor ? prototype
      : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
      : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
    if (selected === null || typeof selected !== "object")
      selected = getFunctionRealmPrototype(target, "Intl.Collator", prototype);
    let locales: string[] = [];
    const release = retainValues(budget, () => [selected, locales]);
    try {
      locales = await canonicalizeGuestLocales(input, budget, context);
      const converted = await readCollatorOptions(options, budget, context);
      const value = createSandboxCollator(locales, converted);
      setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
      return allocateProducedSandboxValue(value, budget);
    } finally { release(); }
  };
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "Collator", length: 0,
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
        const option = await readIntlProperty(source, "localeMatcher", budget, context);
        const matcher = option === undefined ? undefined : await convertIntlOption(option, "localeMatcher", ["lookup", "best fit"], budget, context);
        return allocateProducedSandboxValue(supportedLocalesOf(locales, { localeMatcher: matcher as "lookup" | "best fit" | undefined }), budget);
      } finally { release(); }
    }
  }), writable: true, configurable: true });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Intl.Collator", configurable: true },
    resolvedOptions: { value: createSandboxClosure({
      guest: true, sandbox: true, name: "resolvedOptions", length: 0,
      call: (_args, context) => allocateProducedSandboxValue({ ...collatorState(context?.thisValue).options }, budget)
    }), writable: true, configurable: true },
    compare: { get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get compare", length: 0,
      call: (_args, context) => {
        const receiver = context?.thisValue;
        const state = collatorState(receiver);
        if (state.compare === undefined) {
          state.compare = createBoundFunction({ target: compareTarget, thisValue: receiver, args: [] }, "", 2,
            (target, args, stack, thisValue) => invokeBuiltinClosure(target, args, budget, { stack, thisValue }, thisValue));
          allocateProducedSandboxValue(state.compare, budget);
        }
        return state.compare;
      }
    }), "get"), configurable: true }
  });
  return constructor;
}
