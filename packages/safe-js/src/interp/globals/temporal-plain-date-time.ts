import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { createSandboxTemporalPlainDateTime, temporalPlainDateTimeFields, temporalPlainDateTimeNumericFields, type TemporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { readTemporalStringOptions } from "./temporal-string-options.js";
import { readTemporalPlainTime } from "./temporal-plain-time-input.js";
import { createSandboxTemporalPlainTime } from "../temporal-plain-time.js";
import { readTemporalPlainDateTime } from "./temporal-plain-date-time-input.js";
import { readTemporalCalendarIdentifier } from "./temporal-calendar-identifier.js";
import { readTemporalRoundingOptions } from "./temporal-rounding-options.js";
import { addTemporalPlainDateTime } from "./temporal-plain-date-time-arithmetic.js";
import { readTemporalDifferenceOptions } from "./temporal-difference-options.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames } from "../temporal-duration.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { createSandboxTemporalPlainDate } from "../temporal-plain-date.js";
import { createSandboxTemporalZonedDateTime, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";

export function createTemporalPlainDateTimeConstructor(budget: Budget, plainTimePrototype: object, durationPrototype: object, plainDatePrototype: object, prototype: SandboxObject, zonedDateTimePrototype: object): SandboxClosure {
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "PlainDateTime", length: 3,
    call: () => { throw new TypeError("Temporal.PlainDateTime requires new."); },
    construct: async (args, context) => {
      const fields: Record<string, number> = Object.create(null);
      let result: SandboxValue;
      let selected: SandboxValue;
      const release = retainValues(budget, () => [...args, fields, result, selected]);
      try {
        for (const [index, name] of temporalPlainDateTimeNumericFields.entries()) {
          const input = args[index];
          const number = index >= 3 && input === undefined ? 0 : await sandboxNumber(input, budget, context);
          if (!Number.isFinite(number)) throw new RangeError("PlainDateTime fields must be finite numbers.");
          fields[name] = Math.trunc(number);
        }
        const calendar = args[9] === undefined ? "iso8601" : args[9];
        if (typeof calendar !== "string") throw new TypeError("PlainDateTime calendar must be a string.");
        budget.visitNode(calendar.length);
        result = createSandboxTemporalPlainDateTime({ ...fields, calendar } as TemporalPlainDateTimeFields);
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "Temporal.PlainDateTime", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.PlainDateTime", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  for (const name of ["calendarId", "era", "eraYear", "year", "month", "monthCode", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond", "dayOfWeek", "dayOfYear", "weekOfYear", "yearOfWeek", "daysInWeek", "daysInMonth", "daysInYear", "monthsInYear", "inLeapYear"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalPlainDateTimeFields(context?.thisValue);
        const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
          fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar)[name];
        return typeof value === "string" ? budget.allocateString(value) : value;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal.PlainDateTime does not support implicit primitive conversion."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const result = await readTemporalPlainDateTime(input, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  const withFields = createSandboxClosure({ guest: true, sandbox: true, name: "with", length: 1,
    call: async ([input, options], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      const result = await readTemporalPlainDateTime(input, options, budget, context, fields);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withFields, writable: true, configurable: true });
  const arithmetic: SandboxClosure[] = [];
  for (const name of ["until", "since"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([other, options], context) => {
        const fields = temporalPlainDateTimeFields(context?.thisValue);
        let otherFields: TemporalPlainDateTimeFields | undefined;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, other, options, otherFields, result]);
        try {
          otherFields = temporalPlainDateTimeFields(await readTemporalPlainDateTime(other, undefined, budget, context));
          if (fields.calendar !== otherFields.calendar) throw new RangeError("PlainDateTime difference requires matching calendars.");
          const normalized = await readTemporalDifferenceOptions(options, budget, context);
          const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
            fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
          const otherValue = new Backend.PlainDateTime(otherFields.isoYear, otherFields.isoMonth, otherFields.isoDay,
            otherFields.hour, otherFields.minute, otherFields.second, otherFields.millisecond, otherFields.microsecond, otherFields.nanosecond, otherFields.calendar);
          const duration = value[name](otherValue, normalized);
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
      call: async ([input, options], context) => {
        const fields = temporalPlainDateTimeFields(context?.thisValue);
        const result = await addTemporalPlainDateTime(fields, input, options, name, budget, context);
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    arithmetic.push(method);
  }
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two], context) => {
      let first: TemporalPlainDateTimeFields | undefined;
      let second: TemporalPlainDateTimeFields | undefined;
      const release = retainValues(budget, () => [one, two, first, second]);
      try {
        first = temporalPlainDateTimeFields(await readTemporalPlainDateTime(one, undefined, budget, context));
        second = temporalPlainDateTimeFields(await readTemporalPlainDateTime(two, undefined, budget, context));
        for (const name of temporalPlainDateTimeNumericFields) {
          if (first[name] !== second[name]) return first[name] < second[name] ? -1 : 1;
        }
        return 0;
      } finally { release(); }
    }
  });
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([input], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const other = temporalPlainDateTimeFields(await readTemporalPlainDateTime(input, undefined, budget, context));
        return fields.calendar === other.calendar && temporalPlainDateTimeNumericFields.every(name => fields[name] === other[name]);
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "compare", { value: compare, writable: true, configurable: true });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  const toPlainTime = createSandboxClosure({ guest: true, sandbox: true, name: "toPlainTime", length: 0,
    call: (_args, context) => {
      const result = createSandboxTemporalPlainTime(temporalPlainDateTimeFields(context?.thisValue));
      setSandboxPrototype(result, plainTimePrototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  const toZonedDateTime = createSandboxClosure({ guest: true, sandbox: true, name: "toZonedDateTime", length: 1,
    call: async ([input, options], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      let timeZone: string | undefined;
      let current: SandboxValue;
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, options, timeZone, current, result]);
      try {
        if (isSandboxTemporalZonedDateTime(input)) timeZone = temporalZonedDateTimeFields(input).timeZone;
        else {
          if (typeof input !== "string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
          budget.visitNode(input.length);
          timeZone = budget.allocateString(new Backend.ZonedDateTime(0n, parseTemporalTimeZoneString(input)).timeZoneId);
        }
        if (options !== undefined && (options === null || typeof options !== "object")) throw new TypeError("Zoned conversion options must be an object.");
        current = options === undefined ? undefined : await sandboxGetProperty(options, "disambiguation", options, budget, context);
        const disambiguation = current === undefined ? "compatible" : await sandboxString(current, budget, context);
        if (disambiguation !== "compatible" && disambiguation !== "earlier" && disambiguation !== "later" && disambiguation !== "reject")
          throw new RangeError("Invalid Temporal disambiguation.");
        const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
          fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
        const zoned = value.toZonedDateTime(timeZone, { disambiguation });
        result = createSandboxTemporalZonedDateTime({ epochNanoseconds: zoned.epochNanoseconds, timeZone, calendar: fields.calendar });
        setSandboxPrototype(result, zonedDateTimePrototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toZonedDateTime", { value: toZonedDateTime, writable: true, configurable: true });
  const toPlainDate = createSandboxClosure({ guest: true, sandbox: true, name: "toPlainDate", length: 0,
    call: (_args, context) => {
      const result = createSandboxTemporalPlainDate(temporalPlainDateTimeFields(context?.thisValue));
      setSandboxPrototype(result, plainDatePrototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  const withPlainTime = createSandboxClosure({ guest: true, sandbox: true, name: "withPlainTime", length: 0,
    call: async ([input], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      const release = retainValues(budget, () => [fields, input]);
      try {
        const time = input === undefined
          ? { hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }
          : await readTemporalPlainTime(input, undefined, budget, context);
        const result = createSandboxTemporalPlainDateTime({ ...fields, ...time });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  const withCalendar = createSandboxClosure({ guest: true, sandbox: true, name: "withCalendar", length: 1,
    call: ([input], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, result]);
      try {
        const calendar = readTemporalCalendarIdentifier(input, budget);
        result = createSandboxTemporalPlainDateTime({ ...fields, calendar });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperties(prototype, {
    toPlainTime: { value: toPlainTime, writable: true, configurable: true },
    toPlainDate: { value: toPlainDate, writable: true, configurable: true },
    withCalendar: { value: withCalendar, writable: true, configurable: true },
    withPlainTime: { value: withPlainTime, writable: true, configurable: true }
  });
  const round = createSandboxClosure({ guest: true, sandbox: true, name: "round", length: 1,
    call: async ([options], context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, options, result]);
      try {
        const normalized = await readTemporalRoundingOptions(options,
          ["day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"], budget, context);
        const rounded = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
          fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond).round(normalized);
        result = createSandboxTemporalPlainDateTime({
          isoYear: rounded.year, isoMonth: rounded.month, isoDay: rounded.day,
          hour: rounded.hour, minute: rounded.minute, second: rounded.second,
          millisecond: rounded.millisecond, microsecond: rounded.microsecond, nanosecond: rounded.nanosecond,
          calendar: fields.calendar
        });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "round", { value: round, writable: true, configurable: true });
  const formatting: SandboxClosure[] = [];
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: async (args, context) => {
      const fields = temporalPlainDateTimeFields(context?.thisValue);
      let locales: string[] = [];
      let options: Record<string, string | number | boolean> = Object.create(null);
      const release = retainValues(budget, () => [fields, ...args, locales, options]);
      try {
        locales = await canonicalizeGuestLocales(args[0], budget, context);
        options = await readDateTimeFormatOptions(args[1], budget, context);
        // The zone has been validated in guest read order. PlainDateTime
        // formats wall-clock fields, including on hosts without offset zones.
        delete options.timeZone;
        const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
          fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
        return budget.allocateString(value.toLocaleString(locales, options as Intl.DateTimeFormatOptions));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  formatting.push(toLocaleString);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: async ([options], context) => {
        const fields = temporalPlainDateTimeFields(context?.thisValue);
        const release = retainValues(budget, () => [fields, options]);
        try {
          const normalized = name === "toJSON" ? undefined : await readTemporalStringOptions(options, budget, context, true);
          const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
            fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
          return budget.allocateString(value.toString(normalized));
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    formatting.push(method);
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.PlainDateTime", prototype);
  for (const fn of [constructor, from, withFields, compare, equals, valueOf, toPlainTime, toPlainDate, toZonedDateTime, withPlainTime, withCalendar, round, ...arithmetic, ...getters, ...formatting]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
