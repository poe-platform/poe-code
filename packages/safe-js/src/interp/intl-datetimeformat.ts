import type { SandboxClosure, SandboxObject, SandboxValue } from "./values.js";
import { Intl as BackendIntl, Temporal as Backend } from "temporal-polyfill/full/implementation";
import { isSandboxTemporalInstant, temporalInstantEpoch } from "./temporal-instant.js";
import { isSandboxTemporalPlainTime, temporalPlainTimeFields } from "./temporal-plain-time.js";
import { isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "./temporal-plain-date-time.js";
import { isSandboxTemporalPlainDate, temporalPlainDateFields } from "./temporal-plain-date.js";

const NativeDateTimeFormat = Intl.DateTimeFormat;
const resolvedOptions = NativeDateTimeFormat.prototype.resolvedOptions;
const format = Object.getOwnPropertyDescriptor(NativeDateTimeFormat.prototype, "format")!.get!;
const methods = {
  formatToParts: NativeDateTimeFormat.prototype.formatToParts,
  formatRange: NativeDateTimeFormat.prototype.formatRange,
  formatRangeToParts: NativeDateTimeFormat.prototype.formatRangeToParts
};
export type DateTimeFormatOptions = Record<string, string | number | boolean>;
const states = new WeakMap<object, { native: Intl.DateTimeFormat; options: DateTimeFormatOptions; requestedOptions?: DateTimeFormatOptions; format?: SandboxClosure }>();

export function createSandboxDateTimeFormat(locales: string | string[], options: DateTimeFormatOptions, restoring = false, requestedOptions?: DateTimeFormatOptions): SandboxObject {
  const input = { ...options };
  // Resolved hour12 is derived from hourCycle. Reapplying it as a caller option
  // overrides the saved cycle with the locale's default h12/h23 alternative.
  if (restoring) delete input.hour12;
  const native = new NativeDateTimeFormat(locales, input);
  const value = Object.create(null) as SandboxObject;
  states.set(value, { native, options: { ...Reflect.apply(resolvedOptions, native, []) },
    ...(!restoring ? { requestedOptions: { ...options } } : requestedOptions === undefined ? {} : { requestedOptions: { ...requestedOptions } }) });
  return value;
}

export function isSandboxDateTimeFormat(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && states.has(value);
}

export function dateTimeFormatState(value: unknown) {
  if (!isSandboxDateTimeFormat(value)) throw new TypeError("Intl.DateTimeFormat requires a DateTimeFormat receiver.");
  return states.get(value)!;
}

export function isTemporalDateTimeInput(value: unknown): boolean {
  return isSandboxTemporalInstant(value) || isSandboxTemporalPlainTime(value) || isSandboxTemporalPlainDateTime(value) || isSandboxTemporalPlainDate(value);
}

export function formatDateTimeValue(receiver: unknown, method: "format" | keyof typeof methods, values: SandboxValue[]): SandboxValue {
  const state = dateTimeFormatState(receiver);
  const { native } = state;
  if (values.some(isTemporalDateTimeInput)) {
    const plain = isSandboxTemporalPlainTime(values[0]);
    const dateTime = isSandboxTemporalPlainDateTime(values[0]);
    const date = isSandboxTemporalPlainDate(values[0]);
    const matches = date ? isSandboxTemporalPlainDate : dateTime ? isSandboxTemporalPlainDateTime : plain ? isSandboxTemporalPlainTime : isSandboxTemporalInstant;
    if (values.some(value => !matches(value)))
      throw new TypeError("DateTimeFormat ranges require matching Temporal types.");
    const options: DateTimeFormatOptions = { ...(state.requestedOptions ?? state.options), timeZone: state.options.timeZone };
    if (plain) {
      const hasTime = ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"].some(key => options[key] !== undefined);
      const hasDate = ["weekday", "year", "month", "day"].some(key => options[key] !== undefined);
      if (options.timeStyle === undefined && (options.dateStyle !== undefined || hasDate && !hasTime))
        throw new TypeError("PlainTime formatting requires time components.");
      for (const key of ["weekday", "era", "year", "month", "day", "dateStyle"]) delete options[key];
    }
    const formatter = new BackendIntl.DateTimeFormat(state.options.locale as string, options as Intl.DateTimeFormatOptions);
    const converted = values.map(value => {
      if (date) {
        const fields = temporalPlainDateFields(value);
        return new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar);
      }
      if (dateTime) {
        const fields = temporalPlainDateTimeFields(value);
        return new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
          fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
      }
      return plain ? Backend.PlainTime.from(temporalPlainTimeFields(value)) : new Backend.Instant(temporalInstantEpoch(value));
    });
    return Reflect.apply(formatter[method], formatter, converted);
  }
  return method === "format" ? Reflect.apply(format, native, [])(values[0]) : Reflect.apply(methods[method], native, values);
}
