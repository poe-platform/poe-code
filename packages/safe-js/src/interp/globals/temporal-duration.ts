import type { Budget } from "../budget.js";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames, temporalDurationFields } from "../temporal-duration.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { readTemporalDuration, readTemporalPartialDuration } from "./temporal-duration-input.js";
import { formatTemporalDuration } from "./temporal-duration-format.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { readDurationOptions } from "../intl-duration-options.js";
import { formatDurationParts } from "../intl-duration-parts.js";
import type { DurationSettings } from "../intl-durationformat.js";
import { totalTemporalDuration } from "./temporal-duration-total.js";
import { readTemporalRelativeTo } from "./temporal-relative-to.js";
import { roundTemporalDuration } from "./temporal-duration-round.js";

export function createTemporalDurationConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "Duration", length: 0,
    call: () => { throw new TypeError("Temporal.Duration requires new."); },
    construct: async (args, context) => {
      const fields: Record<string, number> = Object.create(null);
      let result: SandboxValue;
      let selected: SandboxValue;
      const release = retainValues(budget, () => [...args, fields, result, selected]);
      try {
        for (const [index, name] of temporalDurationFieldNames.entries()) {
          const input = args[index];
          const number = input === undefined ? 0 : await sandboxNumber(input, budget, context);
          if (!Number.isInteger(number)) throw new RangeError("Duration fields must be finite integers.");
          fields[name] = number;
        }
        result = createSandboxTemporalDuration(fields);
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "Temporal.Duration", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.Duration", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  const methods: SandboxClosure[] = [];
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two, options], context) => {
      let first: TemporalBackend.Duration | undefined;
      let second: TemporalBackend.Duration | undefined;
      let current: SandboxValue;
      const release = retainValues(budget, () => [one, two, options, first, second, current]);
      try {
        first = await readTemporalDuration(one, budget, context);
        second = await readTemporalDuration(two, budget, context);
        if (options !== undefined && (options === null || typeof options !== "object"))
          throw new TypeError("Duration compare options must be an object.");
        current = options === undefined ? undefined : await sandboxGetProperty(options, "relativeTo", options, budget, context);
        const relativeTo = await readTemporalRelativeTo(current, budget, context);
        return TemporalBackend.Duration.compare(first, second, { relativeTo });
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "compare", { value: compare, writable: true, configurable: true });
  methods.push(compare);
  const total = createSandboxClosure({ guest: true, sandbox: true, name: "total", length: 1,
    call: ([options], context) => totalTemporalDuration(temporalDurationFields(context?.thisValue), options, budget, context)
  });
  Object.defineProperty(prototype, "total", { value: total, writable: true, configurable: true });
  methods.push(total);
  const round = createSandboxClosure({ guest: true, sandbox: true, name: "round", length: 1,
    call: async ([options], context) => {
      const fields = temporalDurationFields(context?.thisValue);
      const result = await roundTemporalDuration(fields, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "round", { value: round, writable: true, configurable: true });
  methods.push(round);
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: async ([input, options], context) => {
      const fields = temporalDurationFields(context?.thisValue);
      let locales: string[] = [];
      let settings: DurationSettings | undefined;
      const release = retainValues(budget, () => [input, options, locales, settings]);
      try {
        locales = await canonicalizeGuestLocales(input, budget, context);
        settings = await readDurationOptions(options, locales, budget, context);
        budget.visitNode(100);
        const parts = formatDurationParts(settings, fields, settings.separator);
        return budget.allocateString(parts.map(part => part.value).join(""));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  methods.push(toLocaleString);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: ([options], context) => formatTemporalDuration(temporalDurationFields(context?.thisValue),
        name === "toJSON" ? undefined : options, budget, context)
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  for (const name of ["add", "subtract"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([input], context) => {
        const fields = temporalDurationFields(context?.thisValue);
        const other = await readTemporalDuration(input, budget, context);
        const duration = TemporalBackend.Duration.from(fields)[name](other);
        const result = createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(field => [field, duration[field]])));
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const withMethod = createSandboxClosure({ guest: true, sandbox: true, name: "with", length: 1,
    call: async ([input], context) => {
      const fields = temporalDurationFields(context?.thisValue);
      const partial = await readTemporalPartialDuration(input, budget, context);
      const result = createSandboxTemporalDuration({ ...fields, ...partial });
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withMethod, writable: true, configurable: true });
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input], context) => {
      const duration = await readTemporalDuration(input, budget, context);
      const result = createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(name => [name, duration[name]])));
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  for (const name of ["negated", "abs"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: (_args, context) => {
        const fields = temporalDurationFields(context?.thisValue);
        const result = createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(field =>
          [field, name === "negated" ? -fields[field] : Math.abs(fields[field])])));
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal Duration cannot be converted to a primitive value."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  for (const name of [...temporalDurationFieldNames, "sign", "blank"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalDurationFields(context?.thisValue);
        if (name !== "sign" && name !== "blank") return fields[name];
        const sign = Math.sign(Object.values(fields).find(value => value !== 0) ?? 0);
        return name === "sign" ? sign : sign === 0;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.Duration", prototype);
  for (const fn of [constructor, from, withMethod, valueOf, ...getters, ...methods]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
