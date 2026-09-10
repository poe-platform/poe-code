import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxTemporalPlainDate, temporalPlainDateFields, temporalPlainDateNumericFields, type TemporalPlainDateFields } from "../temporal-plain-date.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { readTemporalCalendarIdentifier } from "./temporal-calendar-identifier.js";
import { readTemporalPlainDate } from "./temporal-plain-date-input.js";

export function createTemporalPlainDateConstructor(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "PlainDate", length: 3,
    call: () => { throw new TypeError("Temporal.PlainDate requires new."); },
    construct: async (args, context) => {
      const fields: Record<string, number> = Object.create(null);
      let result: SandboxValue;
      let selected: SandboxValue;
      const release = retainValues(budget, () => [...args, fields, result, selected]);
      try {
        for (const [index, name] of temporalPlainDateNumericFields.entries()) {
          const number = await sandboxNumber(args[index], budget, context);
          if (!Number.isFinite(number)) throw new RangeError("PlainDate fields must be finite numbers.");
          fields[name] = Math.trunc(number);
        }
        const calendar = args[3] === undefined ? "iso8601" : args[3];
        if (typeof calendar !== "string") throw new TypeError("PlainDate calendar must be a string.");
        budget.visitNode(calendar.length);
        result = createSandboxTemporalPlainDate({ ...fields, calendar } as TemporalPlainDateFields);
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "Temporal.PlainDate", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.PlainDate", configurable: true }
  });
  const methods: SandboxClosure[] = [];
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const result = await readTemporalPlainDate(input, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  methods.push(from);
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two], context) => {
      let first: TemporalPlainDateFields | undefined;
      let second: TemporalPlainDateFields | undefined;
      const release = retainValues(budget, () => [one, two, first, second]);
      try {
        first = temporalPlainDateFields(await readTemporalPlainDate(one, undefined, budget, context));
        second = temporalPlainDateFields(await readTemporalPlainDate(two, undefined, budget, context));
        for (const name of temporalPlainDateNumericFields) {
          if (first[name] !== second[name]) return first[name] < second[name] ? -1 : 1;
        }
        return 0;
      } finally { release(); }
    }
  });
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainDateFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const other = temporalPlainDateFields(await readTemporalPlainDate(input, undefined, budget, context));
        return fields.calendar === other.calendar && temporalPlainDateNumericFields.every(name => fields[name] === other[name]);
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "compare", { value: compare, writable: true, configurable: true });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  methods.push(compare, equals);
  for (const name of ["calendarId", "era", "eraYear", "year", "month", "monthCode", "day", "dayOfWeek", "dayOfYear", "weekOfYear", "yearOfWeek", "daysInWeek", "daysInMonth", "daysInYear", "monthsInYear", "inLeapYear"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalPlainDateFields(context?.thisValue);
        const value = new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar)[name];
        return typeof value === "string" ? budget.allocateString(value) : value;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    methods.push(getter);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal.PlainDate does not support implicit primitive conversion."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  const withCalendar = createSandboxClosure({ guest: true, sandbox: true, name: "withCalendar", length: 1,
    call: ([input], context) => {
      const fields = temporalPlainDateFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, result]);
      try {
        const calendar = readTemporalCalendarIdentifier(input, budget);
        result = createSandboxTemporalPlainDate({ ...fields, calendar });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "withCalendar", { value: withCalendar, writable: true, configurable: true });
  methods.push(withCalendar);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: async ([options], context) => {
        const fields = temporalPlainDateFields(context?.thisValue);
        let current: SandboxValue;
        const release = retainValues(budget, () => [fields, options, current]);
        try {
          if (name === "toString" && options !== undefined) {
            if (options === null || typeof options !== "object") throw new TypeError("PlainDate formatting options must be an object.");
            current = await sandboxGetProperty(options, "calendarName", options, budget, context);
          }
          const calendarName = current === undefined ? "auto" : await sandboxString(current, budget, context);
          if (calendarName !== "auto" && calendarName !== "always" && calendarName !== "never" && calendarName !== "critical")
            throw new RangeError("Invalid Temporal calendarName option.");
          const value = new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar);
          return budget.allocateString(value.toString({ calendarName }));
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.PlainDate", prototype);
  for (const fn of [constructor, valueOf, ...methods]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
