import type { Budget } from "../budget.js";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { createSandboxTemporalPlainTime, temporalPlainTimeFieldNames, temporalPlainTimeFields, type TemporalPlainTimeFields } from "../temporal-plain-time.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { readTemporalPlainTime } from "./temporal-plain-time-input.js";
import { readTemporalDuration } from "./temporal-duration-input.js";
import { formatTemporalPlainTime } from "./temporal-plain-time-format.js";
import { roundTemporalPlainTime } from "./temporal-plain-time-round.js";
import { readTemporalDifferenceOptions } from "./temporal-difference-options.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames } from "../temporal-duration.js";
import { formatTemporalPlainTimeLocale } from "./temporal-plain-time-locale.js";

export function createTemporalPlainTimeConstructor(budget: Budget, durationPrototype: object): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "PlainTime", length: 0,
    call: () => { throw new TypeError("Temporal.PlainTime requires new."); },
    construct: async (args, context) => {
      const fields: Record<string, number> = Object.create(null);
      let result: SandboxValue;
      let selected: SandboxValue;
      const release = retainValues(budget, () => [...args, fields, result, selected]);
      try {
        for (const [index, name] of temporalPlainTimeFieldNames.entries()) {
          const input = args[index];
          const number = input === undefined ? 0 : await sandboxNumber(input, budget, context);
          if (!Number.isFinite(number)) throw new RangeError("PlainTime fields must be finite numbers.");
          fields[name] = Math.trunc(number);
        }
        result = createSandboxTemporalPlainTime(fields);
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "Temporal.PlainTime", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.PlainTime", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Use Temporal.PlainTime.compare() or equals() instead of implicit conversion."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  const toJSON = createSandboxClosure({ guest: true, sandbox: true, name: "toJSON", length: 0,
    call: (_args, context) => {
      const fields = temporalPlainTimeFields(context?.thisValue);
      return budget.allocateString(Backend.PlainTime.from(fields).toJSON());
    }
  });
  Object.defineProperty(prototype, "toJSON", { value: toJSON, writable: true, configurable: true });
  const toString = createSandboxClosure({ guest: true, sandbox: true, name: "toString", length: 0,
    call: ([options], context) => formatTemporalPlainTime(temporalPlainTimeFields(context?.thisValue), options, budget, context)
  });
  Object.defineProperty(prototype, "toString", { value: toString, writable: true, configurable: true });
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: (args, context) => formatTemporalPlainTimeLocale(temporalPlainTimeFields(context?.thisValue), args, budget, context)
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  const round = createSandboxClosure({ guest: true, sandbox: true, name: "round", length: 1,
    call: async ([options], context) => {
      const result = await roundTemporalPlainTime(temporalPlainTimeFields(context?.thisValue), options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "round", { value: round, writable: true, configurable: true });
  const withMethod = createSandboxClosure({ guest: true, sandbox: true, name: "with", length: 1,
    call: async ([input, options], context) => {
      const fields = temporalPlainTimeFields(context?.thisValue);
      const updated = await readTemporalPlainTime(input, options, budget, context, fields);
      const result = createSandboxTemporalPlainTime(updated);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withMethod, writable: true, configurable: true });
  const arithmetic: SandboxClosure[] = [];
  for (const name of ["until", "since"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([other, options], context) => {
        const fields = temporalPlainTimeFields(context?.thisValue);
        let otherFields: TemporalPlainTimeFields | undefined;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, other, options, otherFields, result]);
        try {
          otherFields = await readTemporalPlainTime(other, undefined, budget, context);
          const normalized = await readTemporalDifferenceOptions(options, budget, context);
          const duration = Backend.PlainTime.from(fields)[name](otherFields, normalized);
          result = createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(field => [field, duration[field]])));
          setSandboxPrototype(result, durationPrototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    arithmetic.push(method);
  }
  for (const name of ["add", "subtract"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([input], context) => {
        const fields = temporalPlainTimeFields(context?.thisValue);
        const release = retainValues(budget, () => [fields, input]);
        try {
          const duration = await readTemporalDuration(input, budget, context);
          const time = Backend.PlainTime.from(fields)[name](duration);
          const result = createSandboxTemporalPlainTime(Object.fromEntries(temporalPlainTimeFieldNames.map(field => [field, time[field]])));
          setSandboxPrototype(result, prototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    arithmetic.push(method);
  }
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const fields = await readTemporalPlainTime(input, options, budget, context);
      const result = createSandboxTemporalPlainTime(fields);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two], context) => {
      let first: TemporalPlainTimeFields | undefined;
      let second: TemporalPlainTimeFields | undefined;
      const release = retainValues(budget, () => [one, two, first, second]);
      try {
        first = await readTemporalPlainTime(one, undefined, budget, context);
        second = await readTemporalPlainTime(two, undefined, budget, context);
        return Backend.PlainTime.compare(first, second);
      } finally { release(); }
    }
  });
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainTimeFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const other = await readTemporalPlainTime(input, undefined, budget, context);
        return temporalPlainTimeFieldNames.every(name => fields[name] === other[name]);
      } finally { release(); }
    }
  });
  Object.defineProperties(materializeFunctionProperties(constructor), {
    from: { value: from, writable: true, configurable: true },
    compare: { value: compare, writable: true, configurable: true }
  });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  for (const name of temporalPlainTimeFieldNames) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => temporalPlainTimeFields(context?.thisValue)[name]
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.PlainTime", prototype);
  for (const fn of [constructor, from, compare, equals, valueOf, toJSON, toString, toLocaleString, round, withMethod, ...getters, ...arithmetic]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
