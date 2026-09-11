import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { buildLocaleTag, createSandboxLocale, localeMember, localeTag } from "../intl-locale.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";

export function createLocaleConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const create = (tag: string, selected: SandboxValue = prototype): SandboxValue => {
    const value = createSandboxLocale(tag);
    setSandboxPrototype(value, typeof selected === "object" && selected !== null ? selected : prototype, budget);
    return allocateProducedSandboxValue(value, budget);
  };
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "Locale", length: 1,
    call: () => { throw new TypeError("Intl.Locale requires new."); },
    construct: async ([tag, options], context) => {
      const target = context?.newTarget;
      let selected = target === undefined || target === constructor ? prototype
        : context?.getProperty !== undefined ? await context.getProperty(target, "prototype")
        : await readPropertyDescriptor(getSandboxPropertyDescriptor(target, "prototype", budget) ?? { value: undefined }, target, context);
      if (selected === null || typeof selected !== "object")
        selected = getFunctionRealmPrototype(target, "Intl.Locale", prototype);
      return create(await buildLocaleTag(tag, options, budget, context), selected);
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false, configurable: false });
  Object.defineProperty(prototype, "constructor", { value: constructor, writable: true, configurable: true });
  Object.defineProperty(prototype, Symbol.toStringTag, { value: "Intl.Locale", configurable: true });
  const methods = ["toString", "maximize", "minimize", "getCalendars", "getCollations", "getHourCycles", "getNumberingSystems", "getTimeZones", "getTextInfo", "getWeekInfo"];
  const getters = ["baseName", "language", "script", "region", "variants", "calendar", "collation", "firstDayOfWeek", "hourCycle", "caseFirst", "numeric", "numberingSystem"];
  for (const name of [...methods, ...getters]) {
    const getter = getters.includes(name);
    const closure = createSandboxClosure({
      guest: true, sandbox: true, name: getter ? `get ${name}` : name, length: 0,
      call: (_args, context) => {
        budget.visitNode();
        const receiver = context?.thisValue;
        const result = name === "toString" ? localeTag(receiver) : localeMember(receiver, name);
        if (name === "maximize" || name === "minimize") return create(result as string);
        return allocateProducedSandboxValue(result, budget);
      }
    });
    Object.defineProperty(prototype, name, getter
      ? { get: accessorAdapter(closure, "get"), configurable: true }
      : { value: closure, writable: true, configurable: true });
  }
  return constructor;
}
