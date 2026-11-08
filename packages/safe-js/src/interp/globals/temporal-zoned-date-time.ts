import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import { createSandboxTemporalZonedDateTime, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields, type TemporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { sandboxBigInt } from "./bigint.js";
import { readTemporalZonedDateTime } from "./temporal-zoned-date-time-input.js";
import { readTemporalCalendarIdentifier } from "./temporal-calendar-identifier.js";
import { readTemporalStringOptions } from "./temporal-string-options.js";
import { readTemporalPlainTime } from "./temporal-plain-time-input.js";
import { readTemporalDuration } from "./temporal-duration-input.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames } from "../temporal-duration.js";
import { readTemporalRoundingOptions } from "./temporal-rounding-options.js";
import { readTemporalDifferenceOptions } from "./temporal-difference-options.js";
import { createSandboxTemporalInstant } from "../temporal-instant.js";
import { createSandboxTemporalPlainDate, hostTemporalPlainDateFields } from "../temporal-plain-date.js";
import { createSandboxTemporalPlainTime, hostTemporalPlainTimeFields } from "../temporal-plain-time.js";
import { createSandboxTemporalPlainDateTime, hostTemporalPlainDateTimeFields } from "../temporal-plain-date-time.js";

export function createTemporalZonedDateTimeConstructor(budget: Budget, instantPrototype: object, datePrototype: object, timePrototype: object, dateTimePrototype: object, durationPrototype: object, prototype = createIntrinsicObject()): SandboxClosure {
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "ZonedDateTime", length: 2,
    call: () => { throw new TypeError("Temporal.ZonedDateTime requires new."); },
    construct: async (args, context) => {
      let result: SandboxValue;
      let selected: SandboxValue;
      let epochNanoseconds: bigint | undefined;
      const release = retainValues(budget, () => [...args, result, selected, epochNanoseconds]);
      try {
        epochNanoseconds = await sandboxBigInt(args[0], budget, context);
        // Range validation precedes both time-zone and calendar validation.
        new Backend.Instant(epochNanoseconds);
        const timeZone = args[1];
        if (typeof timeZone !== "string") throw new TypeError("ZonedDateTime time zone must be a string.");
        budget.visitNode(timeZone.length);
        // Validate the identifier before inspecting the calendar argument.
        const validated = new Backend.ZonedDateTime(epochNanoseconds, timeZone);
        const calendar = args[2] === undefined ? "iso8601" : args[2];
        if (typeof calendar !== "string") throw new TypeError("ZonedDateTime calendar must be a string.");
        budget.visitNode(calendar.length);
        result = createSandboxTemporalZonedDateTime({ epochNanoseconds, timeZone: validated.timeZoneId, calendar });
        const target = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(target, "prototype", target, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "Temporal.ZonedDateTime", prototype);
        setSandboxPrototype(result, selected, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "Temporal.ZonedDateTime", configurable: true }
  });
  const methods: SandboxClosure[] = [];
  const from = createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
    call: async ([input, options], context) => {
      const result = await readTemporalZonedDateTime(input, options, budget, context);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "from", { value: from, writable: true, configurable: true });
  methods.push(from);
  const withFields = createSandboxClosure({ guest: true, sandbox: true, name: "with", length: 1,
    call: async ([input, options], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      const result = await readTemporalZonedDateTime(input, options, budget, context, fields);
      setSandboxPrototype(result, prototype, budget);
      createDataCheckpoint(budget, context)(result, 0, true);
      return result;
    }
  });
  Object.defineProperty(prototype, "with", { value: withFields, writable: true, configurable: true });
  methods.push(withFields);
  const compare = createSandboxClosure({ guest: true, sandbox: true, name: "compare", length: 2,
    call: async ([one, two], context) => {
      let first: TemporalZonedDateTimeFields | undefined;
      let second: TemporalZonedDateTimeFields | undefined;
      const release = retainValues(budget, () => [one, two, first, second]);
      try {
        first = temporalZonedDateTimeFields(await readTemporalZonedDateTime(one, undefined, budget, context));
        second = temporalZonedDateTimeFields(await readTemporalZonedDateTime(two, undefined, budget, context));
        return first.epochNanoseconds === second.epochNanoseconds ? 0 : first.epochNanoseconds < second.epochNanoseconds ? -1 : 1;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "compare", { value: compare, writable: true, configurable: true });
  methods.push(compare);
  const equals = createSandboxClosure({ guest: true, sandbox: true, name: "equals", length: 1,
    call: async ([other], context) => {
      const first = temporalZonedDateTimeFields(context?.thisValue);
      let second: TemporalZonedDateTimeFields | undefined;
      const release = retainValues(budget, () => [first, other, second]);
      try {
        second = temporalZonedDateTimeFields(await readTemporalZonedDateTime(other, undefined, budget, context));
        return new Backend.ZonedDateTime(first.epochNanoseconds, first.timeZone, first.calendar)
          .equals(new Backend.ZonedDateTime(second.epochNanoseconds, second.timeZone, second.calendar));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "equals", { value: equals, writable: true, configurable: true });
  methods.push(equals);
  const withTimeZone = createSandboxClosure({ guest: true, sandbox: true, name: "withTimeZone", length: 1,
    call: ([input], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      let timeZone: string | undefined;
      const release = retainValues(budget, () => [fields, input, timeZone, result]);
      try {
        if (isSandboxTemporalZonedDateTime(input)) timeZone = temporalZonedDateTimeFields(input).timeZone;
        else {
          if (typeof input !== "string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
          budget.visitNode(input.length);
          timeZone = budget.allocateString(parseTemporalTimeZoneString(input));
        }
        result = createSandboxTemporalZonedDateTime({ epochNanoseconds: fields.epochNanoseconds, timeZone, calendar: fields.calendar });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "withTimeZone", { value: withTimeZone, writable: true, configurable: true });
  methods.push(withTimeZone);
  const withCalendar = createSandboxClosure({ guest: true, sandbox: true, name: "withCalendar", length: 1,
    call: ([input], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, result]);
      try {
        const calendar = readTemporalCalendarIdentifier(input, budget);
        result = createSandboxTemporalZonedDateTime({ ...fields, calendar });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "withCalendar", { value: withCalendar, writable: true, configurable: true });
  methods.push(withCalendar);
  const startOfDay = createSandboxClosure({ guest: true, sandbox: true, name: "startOfDay", length: 0,
    call: (_args, context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, result]);
      try {
        const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar).startOfDay();
        result = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds: value.epochNanoseconds });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "startOfDay", { value: startOfDay, writable: true, configurable: true });
  methods.push(startOfDay);
  const withPlainTime = createSandboxClosure({ guest: true, sandbox: true, name: "withPlainTime", length: 0,
    call: async ([input], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, result]);
      try {
        const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
        const local = value.toPlainDateTime();
        const time = input === undefined ? undefined : await readTemporalPlainTime(input, undefined, budget, context);
        // Resolve the changed local time with compatible disambiguation, not
        // the backend withPlainTime shortcut, which can preserve a later offset.
        const changed = time === undefined ? value.startOfDay()
          : local.withPlainTime(time).toZonedDateTime(fields.timeZone, { disambiguation: "compatible" });
        result = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds: changed.epochNanoseconds });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "withPlainTime", { value: withPlainTime, writable: true, configurable: true });
  methods.push(withPlainTime);
  const getTimeZoneTransition = createSandboxClosure({ guest: true, sandbox: true, name: "getTimeZoneTransition", length: 1,
    call: async ([input], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let current: SandboxValue;
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, input, current, result]);
      try {
        if (typeof input === "string") current = input;
        else {
          if (input === null || typeof input !== "object") throw new TypeError("Transition direction requires a string or options object.");
          current = await sandboxGetProperty(input, "direction", input, budget, context);
        }
        if (current === undefined) throw new RangeError("Transition direction is required.");
        const direction = await sandboxString(current, budget, context);
        if (direction !== "next" && direction !== "previous") throw new RangeError("Invalid transition direction.");
        const transition = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar).getTimeZoneTransition(direction);
        if (transition === null) return null;
        result = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds: transition.epochNanoseconds });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "getTimeZoneTransition", { value: getTimeZoneTransition, writable: true, configurable: true });
  methods.push(getTimeZoneTransition);
  const round = createSandboxClosure({ guest: true, sandbox: true, name: "round", length: 1,
    call: async ([options], context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let result: SandboxValue;
      const release = retainValues(budget, () => [fields, options, result]);
      try {
        const normalized = await readTemporalRoundingOptions(options, ["day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"], budget, context);
        const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar).round(normalized);
        result = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds: value.epochNanoseconds });
        setSandboxPrototype(result, prototype, budget);
        createDataCheckpoint(budget, context)(result, 0, true);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "round", { value: round, writable: true, configurable: true });
  methods.push(round);
  for (const name of ["until", "since"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 1,
      call: async ([other, options], context) => {
        const fields = temporalZonedDateTimeFields(context?.thisValue);
        let otherFields: TemporalZonedDateTimeFields | undefined;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, other, options, otherFields, result]);
        try {
          otherFields = temporalZonedDateTimeFields(await readTemporalZonedDateTime(other, undefined, budget, context));
          if (fields.calendar !== otherFields.calendar) throw new RangeError("ZonedDateTime difference requires matching calendars.");
          const normalized = await readTemporalDifferenceOptions(options, budget, context);
          const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
          const otherValue = new Backend.ZonedDateTime(otherFields.epochNanoseconds, otherFields.timeZone, otherFields.calendar);
          const duration = value[name](otherValue, normalized);
          // The backend's equal-epoch shortcut can bypass the required zone
          // check. Perform it after backend option validation, before returning.
          const calendarUnits = ["year", "month", "week", "day"];
          const largestUnit = normalized.largestUnit === undefined || normalized.largestUnit === "auto"
            ? normalized.smallestUnit : normalized.largestUnit;
          if (calendarUnits.includes(String(largestUnit)) &&
              !value.equals(new Backend.ZonedDateTime(fields.epochNanoseconds, otherFields.timeZone, fields.calendar)))
            throw new RangeError("Calendar differences require matching time zones.");
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
        const fields = temporalZonedDateTimeFields(context?.thisValue);
        let durationFields: Record<string, number> | undefined;
        let current: SandboxValue;
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, input, options, durationFields, current, result]);
        try {
          const duration = await readTemporalDuration(input, budget, context);
          durationFields = Object.fromEntries(temporalDurationFieldNames.map(key => [key, duration[key]]));
          if (options !== undefined && (options === null || typeof options !== "object"))
            throw new TypeError("ZonedDateTime arithmetic options must be an object.");
          current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
          const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
          if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
          const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
          const changed = value[name](durationFields, { overflow });
          result = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds: changed.epochNanoseconds });
          setSandboxPrototype(result, prototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  const toLocaleString = createSandboxClosure({ guest: true, sandbox: true, name: "toLocaleString", length: 0,
    call: async (args, context) => {
      const fields = temporalZonedDateTimeFields(context?.thisValue);
      let locales: string[] = [];
      let options: Record<string, string | number | boolean> = Object.create(null);
      const release = retainValues(budget, () => [fields, ...args, locales, options]);
      try {
        locales = await canonicalizeGuestLocales(args[0], budget, context);
        options = await readDateTimeFormatOptions(args[1], budget, context, true);
        const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
        return budget.allocateString(value.toLocaleString(locales, options as Intl.DateTimeFormatOptions));
      } finally { release(); }
    }
  });
  Object.defineProperty(prototype, "toLocaleString", { value: toLocaleString, writable: true, configurable: true });
  methods.push(toLocaleString);
  for (const name of ["toString", "toJSON"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: async ([options], context) => {
        const fields = temporalZonedDateTimeFields(context?.thisValue);
        const release = retainValues(budget, () => [fields, options]);
        try {
          const normalized = name === "toJSON" ? undefined : await readTemporalStringOptions(options, budget, context, true, true);
          const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
          return budget.allocateString(value.toString(normalized));
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  for (const [name, targetPrototype] of [
    ["toInstant", instantPrototype], ["toPlainDate", datePrototype],
    ["toPlainTime", timePrototype], ["toPlainDateTime", dateTimePrototype]
  ] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      call: (_args, context) => {
        const fields = temporalZonedDateTimeFields(context?.thisValue);
        let result: SandboxValue;
        const release = retainValues(budget, () => [fields, result]);
        try {
          if (name === "toInstant") result = createSandboxTemporalInstant(fields.epochNanoseconds);
          else {
            const zoned = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
            if (name === "toPlainDate") result = createSandboxTemporalPlainDate(hostTemporalPlainDateFields(zoned.toPlainDate())!);
            else if (name === "toPlainTime") result = createSandboxTemporalPlainTime(hostTemporalPlainTimeFields(zoned.toPlainTime())!);
            else result = createSandboxTemporalPlainDateTime(hostTemporalPlainDateTimeFields(zoned.toPlainDateTime())!);
          }
          setSandboxPrototype(result, targetPrototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    methods.push(method);
  }
  for (const name of ["calendarId", "timeZoneId", "epochMilliseconds", "epochNanoseconds", "offset", "offsetNanoseconds", "hoursInDay",
    "era", "eraYear", "year", "month", "monthCode", "day", "dayOfWeek", "dayOfYear", "weekOfYear", "yearOfWeek", "daysInWeek",
    "daysInMonth", "daysInYear", "monthsInYear", "inLeapYear", "nanosecond", "microsecond", "millisecond", "second", "minute", "hour"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        const fields = temporalZonedDateTimeFields(context?.thisValue);
        const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar)[name];
        return typeof value === "string" ? budget.allocateString(value) : value;
      }
    });
    Object.defineProperty(prototype, name, { get: accessorAdapter(getter, "get"), configurable: true });
    methods.push(getter);
  }
  const valueOf = createSandboxClosure({ guest: true, sandbox: true, name: "valueOf", length: 0,
    call: () => { throw new TypeError("Temporal.ZonedDateTime does not support implicit primitive conversion."); }
  });
  Object.defineProperty(prototype, "valueOf", { value: valueOf, writable: true, configurable: true });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerRealmPrototype(budget, "Temporal.ZonedDateTime", prototype);
  for (const fn of [constructor, valueOf, ...methods]) registerIntrinsicFunction(budget, fn);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
