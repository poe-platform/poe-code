import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { createIntrinsicObject, getSandboxPrototype, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createSandboxTemporalInstant } from "../temporal-instant.js";
import { createSandboxTemporalPlainDate, hostTemporalPlainDateFields } from "../temporal-plain-date.js";
import { createSandboxTemporalPlainDateTime, hostTemporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import { createSandboxTemporalPlainTime, hostTemporalPlainTimeFields } from "../temporal-plain-time.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { createSandboxTemporalZonedDateTime, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";

export function createTemporalNowNamespace(
  budget: Budget,
  clock: SandboxClosure,
  defaultTimeZone: SandboxClosure,
  prototypes: { Instant: object; ZonedDateTime: object; PlainDateTime: object; PlainDate: object; PlainTime: object }
) {
  const namespace = createIntrinsicObject();
  Object.defineProperty(namespace, Symbol.toStringTag, { value: "Temporal.Now", configurable: true });
  for (const name of ["timeZoneId", "instant", "plainDateTimeISO", "zonedDateTimeISO", "plainDateISO", "plainTimeISO"] as const) {
    const method = createSandboxClosure({ guest: true, sandbox: true, name, length: 0,
      retainedValues: () => [clock, defaultTimeZone],
      call: async ([input], context) => {
        let zone: SandboxValue;
        let result: SandboxValue;
        const release = retainValues(budget, () => [input, zone, result]);
        try {
          if (name === "timeZoneId") {
            zone = await defaultTimeZone.call([], context);
            if (typeof zone !== "string") throw new TypeError("Default time zone must be a string.");
            return budget.allocateString(zone);
          }
          if (name !== "instant") {
            zone = input === undefined ? await defaultTimeZone.call([], context) : input;
            if (isSandboxTemporalZonedDateTime(zone)) zone = temporalZonedDateTimeFields(zone).timeZone;
            else {
              if (typeof zone !== "string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
              budget.visitNode(zone.length);
              zone = budget.allocateString(parseTemporalTimeZoneString(zone));
            }
            // Resolve named identifiers before sampling time, including unknown IANA names.
            zone = new Backend.ZonedDateTime(0n, zone).timeZoneId;
          }
          // RunClock exposes integer milliseconds; conversion preserves its actual precision.
          const milliseconds = await clock.call([], context);
          if (typeof milliseconds !== "number") throw new TypeError("Temporal clock must return milliseconds.");
          const epoch = BigInt(milliseconds) * 1000000n;
          let prototype: object;
          if (name === "instant") {
            result = createSandboxTemporalInstant(epoch);
            prototype = prototypes.Instant;
          } else {
            const zoned = new Backend.ZonedDateTime(epoch, zone as string);
            if (name === "zonedDateTimeISO") {
              result = createSandboxTemporalZonedDateTime({ epochNanoseconds: epoch, timeZone: zoned.timeZoneId, calendar: "iso8601" });
              prototype = prototypes.ZonedDateTime;
            } else if (name === "plainDateTimeISO") {
              result = createSandboxTemporalPlainDateTime(hostTemporalPlainDateTimeFields(zoned.toPlainDateTime())!);
              prototype = prototypes.PlainDateTime;
            } else if (name === "plainDateISO") {
              result = createSandboxTemporalPlainDate(hostTemporalPlainDateFields(zoned.toPlainDate())!);
              prototype = prototypes.PlainDate;
            } else {
              result = createSandboxTemporalPlainTime(hostTemporalPlainTimeFields(zoned.toPlainTime())!);
              prototype = prototypes.PlainTime;
            }
          }
          setSandboxPrototype(result, prototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          return result;
        } finally { release(); }
      }
    });
    Object.defineProperty(namespace, name, { value: method, writable: true, configurable: true });
    registerIntrinsicFunction(budget, method);
  }
  setSandboxPrototype(namespace, getSandboxPrototype(namespace, budget), budget);
  registerIntrinsicObject(budget, namespace);
  return namespace;
}
