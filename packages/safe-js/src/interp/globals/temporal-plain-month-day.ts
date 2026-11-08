import { recoverMissingIsoMonth } from "../intl-iso-month.js";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields } from "../temporal-plain-month-day.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { readTemporalPlainMonthDay } from "./temporal-plain-month-day-input.js";
import { createSandboxTemporalPlainDate, hostTemporalPlainDateFields } from "../temporal-plain-date.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales } from "../intl-options.js";

export function createTemporalPlainMonthDayConstructor(budget: Budget, plainDatePrototype: object, prototype: SandboxObject): SandboxClosure {
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "PlainMonthDay", length: 2,
    call: () => { throw new TypeError("Temporal.PlainMonthDay requires new."); },
    construct: async (args, context) => {
      const fields: number[] = [];
      let result: SandboxValue;
      let selected: SandboxValue;
      let calendar: SandboxValue;
      const release = retainValues(budget, () => [...args, ...fields, result, selected, calendar]);
      try {
        for (let index = 0; index < 2; index++) {
          const number = await sandboxNumber(args[index], budget, context);
          if (!Number.isFinite(number)) throw new RangeError("PlainMonthDay fields must be finite numbers.");
          fields.push(Math.trunc(number));
        }
        calendar = args[2] === undefined ? "iso8601" : args[2];
        if (typeof calendar !== "string") throw new TypeError("PlainMonthDay calendar must be a string.");
        budget.visitNode(calendar.length);
        calendar = budget.allocateString(new Backend.PlainMonthDay(1, 1, calendar).calendarId);
        const year = await sandboxNumber(args[3] === undefined ? 1972 : args[3], budget, context);
        if (!Number.isFinite(year)) throw new RangeError("PlainMonthDay reference year must be finite.");
        result = createSandboxTemporalPlainMonthDay({ isoYear: Math.trunc(year), isoMonth: fields[0], isoDay: fields[1], calendar });
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object") selected = getFunctionRealmPrototype(target, "Temporal.PlainMonthDay", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.PlainMonthDay", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  for (const name of ["calendarId", "monthCode", "day"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalPlainMonthDayFields(context?.thisValue);
        const value = name === "calendarId" ? fields.calendar
          : new Backend.PlainMonthDay(fields.isoMonth, fields.isoDay, fields.calendar, fields.isoYear)[name];
        return typeof value === "string" ? budget.allocateString(value) : value;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  const methods: SandboxClosure[] = [];
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: async (args, context) => {
      const fields = temporalPlainMonthDayFields(context?.thisValue);
      let locales: string[] = [];
      let options: Record<string, string | number | boolean> = Object.create(null);
      const release = retainValues(budget, () => [fields, ...args, locales, options]);
      try {
        locales = await canonicalizeGuestLocales(args[0], budget, context);
        options = await readDateTimeFormatOptions(args[1], budget, context);
        // Validate the requested zone in guest order, then format the owned
        // calendar date without shifting its month/day by that zone.
        delete options.timeZone;
        const value = new Backend.PlainMonthDay(fields.isoMonth, fields.isoDay, fields.calendar, fields.isoYear);
        const result = value.toLocaleString(locales, options as Intl.DateTimeFormatOptions);
        return budget.allocateString(recoverMissingIsoMonth(result, locales, { ...options, timeZone: "UTC" }, "format", () => [
          new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay).toZonedDateTime("UTC").epochMilliseconds
        ]));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  methods.push(toLocaleString);
  const toPlainDate = createSandboxClosure({ guest: true, sandbox: true, name: "toPlainDate", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainMonthDayFields(context?.thisValue);
      if (input === null || typeof input !== "object") throw new TypeError("PlainMonthDay toPlainDate requires a year object.");
      const normalized: Record<string, string | number> = Object.create(null);
      let current: SandboxValue;
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, normalized, current, result]);
      try {
        const calendar = new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar);
        for (const key of [...(calendar.era === undefined ? [] : ["era", "eraYear"]), "year"]) {
          current = await sandboxGetProperty(input, key, input, budget, context);
          if (current === undefined) continue;
          if (key === "era") normalized[key] = await sandboxString(current, budget, context);
          else {
            const number = Math.trunc(await sandboxNumber(current, budget, context));
            if (!Number.isFinite(number)) throw new RangeError("PlainMonthDay year fields must be finite.");
            normalized[key] = number === 0 ? 0 : number;
          }
        }
        const value = new Backend.PlainMonthDay(fields.isoMonth, fields.isoDay, fields.calendar, fields.isoYear)
          .toPlainDate(normalized as Backend.PlainMonthDayToPlainDateOptions & Record<string, string | number>);
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
      const fields = temporalPlainMonthDayFields(context?.thisValue);
      const result = await readTemporalPlainMonthDay(input, options, budget, context, fields);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withFields, writable: true, configurable: true });
  methods.push(withFields);
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const result = await readTemporalPlainMonthDay(input, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainMonthDayFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const other = temporalPlainMonthDayFields(await readTemporalPlainMonthDay(input, undefined, budget, context));
        return fields.isoYear === other.isoYear && fields.isoMonth === other.isoMonth && fields.isoDay === other.isoDay && fields.calendar === other.calendar;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  methods.push(from, equals);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: async ([options], context) => {
        const fields = temporalPlainMonthDayFields(context?.thisValue);
        let current: SandboxValue;
        const release = retainValues(budget, () => [fields, options, current]);
        try {
          if (name === "toString" && options !== undefined) {
            if (options === null || typeof options !== "object") throw new TypeError("PlainMonthDay formatting options must be an object.");
            current = await sandboxGetProperty(options, "calendarName", options, budget, context);
          }
          const calendarName = current === undefined ? "auto" : await sandboxString(current, budget, context);
          if (calendarName !== "auto" && calendarName !== "always" && calendarName !== "never" && calendarName !== "critical")
            throw new RangeError("Invalid Temporal calendarName option.");
          const value = new Backend.PlainMonthDay(fields.isoMonth, fields.isoDay, fields.calendar, fields.isoYear);
          return budget.allocateString(value.toString({ calendarName }));
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal PlainMonthDay cannot be converted to a primitive value."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.PlainMonthDay", prototype);
  for (const fn of [constructor, ...getters, ...methods, valueOf]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
