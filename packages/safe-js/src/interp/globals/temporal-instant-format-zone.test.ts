import { expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxTemporalZonedDateTime } from "../temporal-zoned-date-time.js";
import { formatTemporalInstant } from "./temporal-instant-format.js";

it.each([
  ["UTC", "1970-01-01T00:00:00+00:00"],
  ["+05:30", "1970-01-01T05:30:00+05:30"],
  ["America/New_York", "1969-12-31T19:00:00-05:00"]
])("formats with a ZonedDateTime's private %s zone", async (timeZone, expected) => {
  const zone = createSandboxTemporalZonedDateTime({epochNanoseconds:123n,timeZone});
  const read = vi.fn(() => { throw new Error("public field read"); });
  for (const key of ["timeZoneId", "timeZone", "epochNanoseconds", "calendarId", "toString", Symbol.toPrimitive])
    Object.defineProperty(zone,key,{get:read});
  await expect(formatTemporalInstant(0n,{timeZone:zone},new Budget())).resolves.toBe(expected);
  expect(read).not.toHaveBeenCalled();
});

it("rejects an unbranded object or proxy without coercion or property access", async () => {
  expect(await run(`const zone=new Temporal.ZonedDateTime(0n,'UTC');let reads=0;
    const errors=[];for(const timeZone of [Object.create(zone),new Proxy(zone,{
      get(){reads++;throw Error('property read')}
    })])try{new Temporal.Instant(0n).toString({timeZone})}catch(error){errors.push(error.name)}
    return [errors,reads]`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],0]});
});

it("accepts a guest ZonedDateTime subclass without reading shadowed public fields", async () => {
  expect(await run(`class Zone extends Temporal.ZonedDateTime {}
    const zone=new Zone(123n,'+05:30','buddhist');
    for(const key of ['timeZoneId','timeZone','epochNanoseconds','calendarId',Symbol.toPrimitive])
      Object.defineProperty(zone,key,{get(){throw Error('public field read')}});
    return new Temporal.Instant(0n).toString({timeZone:zone})`))
    .toMatchObject({ok:true,returnValue:"1970-01-01T05:30:00+05:30"});
});
