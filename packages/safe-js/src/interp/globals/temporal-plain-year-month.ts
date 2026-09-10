import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxTemporalPlainYearMonth, hostTemporalPlainYearMonthFields, temporalPlainYearMonthFields, type TemporalPlainYearMonthFields } from "../temporal-plain-year-month.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { readTemporalPlainYearMonth } from "./temporal-plain-year-month-input.js";
import { createSandboxTemporalPlainDate, hostTemporalPlainDateFields } from "../temporal-plain-date.js";
import { readTemporalDuration } from "./temporal-duration-input.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames } from "../temporal-duration.js";
import { readTemporalDifferenceOptions } from "./temporal-difference-options.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales } from "../intl-options.js";

export function createTemporalPlainYearMonthConstructor(budget: Budget, prototype: SandboxObject, plainDatePrototype: object, durationPrototype: object): SandboxClosure {
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "PlainYearMonth", length: 2,
    call: () => { throw new TypeError("Temporal.PlainYearMonth requires new."); },
    construct: async (args, context) => {
      const fields: number[] = [];
      let result: SandboxValue;
      let selected: SandboxValue;
      let calendar: SandboxValue;
      const release = retainValues(budget, () => [...args, ...fields, result, selected, calendar]);
      try {
        for (let index = 0; index < 2; index++) {
          const number = await sandboxNumber(args[index], budget, context);
          if (!Number.isFinite(number)) throw new RangeError("PlainYearMonth fields must be finite numbers.");
          fields.push(Math.trunc(number));
        }
        calendar = args[2] === undefined ? "iso8601" : args[2];
        if (typeof calendar !== "string") throw new TypeError("PlainYearMonth calendar must be a string.");
        budget.visitNode(calendar.length);
        calendar = budget.allocateString(new Backend.PlainYearMonth(2000, 1, calendar).calendarId);
        const day = await sandboxNumber(args[3] === undefined ? 1 : args[3], budget, context);
        if (!Number.isFinite(day)) throw new RangeError("PlainYearMonth reference day must be finite.");
        result = createSandboxTemporalPlainYearMonth({ isoYear: fields[0], isoMonth: fields[1], isoDay: Math.trunc(day), calendar });
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object") selected = getFunctionRealmPrototype(target, "Temporal.PlainYearMonth", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.PlainYearMonth", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  for (const name of ["calendarId", "era", "eraYear", "year", "month", "monthCode", "daysInMonth", "daysInYear", "monthsInYear", "inLeapYear"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalPlainYearMonthFields(context?.thisValue);
        const value = name === "calendarId" ? fields.calendar
          : new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay)[name];
        return typeof value === "string" ? budget.allocateString(value) : value;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  const methods: SandboxClosure[] = [];
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: async (args, context) => {
      const fields = temporalPlainYearMonthFields(context?.thisValue);
      let locales: string[] = [];
      let options: Record<string, string | number | boolean> = Object.create(null);
      const release = retainValues(budget, () => [fields, ...args, locales, options]);
      try {
        locales = await canonicalizeGuestLocales(args[0], budget, context);
        options = await readDateTimeFormatOptions(args[1], budget, context);
        // Validate the requested zone in guest order, then format the owned
        // calendar date without shifting its year/month by that zone.
        delete options.timeZone;
        const value = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay);
        return budget.allocateString(value.toLocaleString(locales, options as Intl.DateTimeFormatOptions));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  methods.push(toLocaleString);
  for (const name of ["until", "since"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([other, options], context) => {
        const fields = temporalPlainYearMonthFields(context?.thisValue);
        let otherFields: TemporalPlainYearMonthFields | undefined;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, other, options, otherFields, result]);
        try {
          otherFields = temporalPlainYearMonthFields(await readTemporalPlainYearMonth(other, undefined, budget, context));
          if (fields.calendar !== otherFields.calendar) throw new RangeError("PlainYearMonth difference requires matching calendars.");
          const normalized = await readTemporalDifferenceOptions(options, budget, context);
          const value = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay);
          const otherValue = new Backend.PlainYearMonth(otherFields.isoYear, otherFields.isoMonth, otherFields.calendar, otherFields.isoDay);
          const duration = value[name](otherValue, normalized);
          result = createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(field => [field, duration[field]])));
          setSandboxPrototype(result, durationPrototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  for (const name of ["add", "subtract"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([input, options], context) => {
        const fields = temporalPlainYearMonthFields(context?.thisValue);
        let durationFields: Record<string, number> | undefined;
        let current: SandboxValue;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, input, options, durationFields, current, result]);
        try {
          const duration = await readTemporalDuration(input, budget, context);
          durationFields = Object.fromEntries(temporalDurationFieldNames.map(field => [field, duration[field]]));
          if (options !== undefined && (options === null || typeof options !== "object"))
            throw new TypeError("PlainYearMonth arithmetic options must be an object.");
          current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
          const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
          if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
          const value = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay);
          result = createSandboxTemporalPlainYearMonth(hostTemporalPlainYearMonthFields(value[name](durationFields, { overflow }))!);
          setSandboxPrototype(result, prototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const toPlainDate = createSandboxClosure({ guest: true, sandbox: true, name: "toPlainDate", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainYearMonthFields(context?.thisValue);
      if (input === null || typeof input !== "object") throw new TypeError("PlainYearMonth toPlainDate requires a day object.");
      let current: SandboxValue;
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, current, result]);
      try {
        current = await sandboxGetProperty(input, "day", input, budget, context);
        if (current === undefined) throw new TypeError("PlainYearMonth toPlainDate requires day.");
        const day = Math.trunc(await sandboxNumber(current, budget, context));
        if (!Number.isFinite(day) || day <= 0) throw new RangeError("Invalid PlainYearMonth day.");
        const value = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay).toPlainDate({ day });
        result = createSandboxTemporalPlainDate(hostTemporalPlainDateFields(value)!);
        setSandboxPrototype(result, plainDatePrototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toPlainDate", { value: toPlainDate, writable: true, configurable: true });
  methods.push(toPlainDate);
  const withFields = createSandboxClosure({ guest: true, sandbox: true, name: "with", length: 1,
    call: async ([input, options], context) => {
      const fields = temporalPlainYearMonthFields(context?.thisValue);
      const result = await readTemporalPlainYearMonth(input, options, budget, context, fields);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withFields, writable: true, configurable: true });
  methods.push(withFields);
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const result = await readTemporalPlainYearMonth(input, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  methods.push(from);
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two], context) => {
      let first: SandboxValue;
      let second: SandboxValue;
      const release = retainValues(budget, () => [one, two, first, second]);
      try {
        first = await readTemporalPlainYearMonth(one, undefined, budget, context);
        second = await readTemporalPlainYearMonth(two, undefined, budget, context);
        const a = temporalPlainYearMonthFields(first), b = temporalPlainYearMonthFields(second);
        for (const key of ["isoYear", "isoMonth", "isoDay"] as const) {
          if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
        }
        return 0;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "compare", { value: compare, writable: true, configurable: true });
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainYearMonthFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const other = temporalPlainYearMonthFields(await readTemporalPlainYearMonth(input, undefined, budget, context));
        return fields.isoYear === other.isoYear && fields.isoMonth === other.isoMonth && fields.isoDay === other.isoDay && fields.calendar === other.calendar;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  methods.push(compare, equals);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: async ([options], context) => {
        const fields = temporalPlainYearMonthFields(context?.thisValue);
        let current: SandboxValue;
        const release = retainValues(budget, () => [fields, options, current]);
        try {
          if (name === "toString" && options !== undefined) {
            if (options === null || typeof options !== "object") throw new TypeError("PlainYearMonth formatting options must be an object.");
            current = await sandboxGetProperty(options, "calendarName", options, budget, context);
          }
          const calendarName = current === undefined ? "auto" : await sandboxString(current, budget, context);
          if (calendarName !== "auto" && calendarName !== "always" && calendarName !== "never" && calendarName !== "critical")
            throw new RangeError("Invalid Temporal calendarName option.");
          const value = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay);
          return budget.allocateString(value.toString({ calendarName }));
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal PlainYearMonth cannot be converted to a primitive value."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.PlainYearMonth", prototype);
  for (const fn of [constructor, ...getters, ...methods, valueOf]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
