import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("creates a zoned ISO value preserving exact epoch and ignoring zone calendar", async () => {
  expect(await run(`const a=new Temporal.Instant(123456789n),zone=new Temporal.ZonedDateTime(0n,'+05:30','buddhist');
    Object.defineProperty(zone,'timeZoneId',{get(){throw 'shadow'}});
    const b=a.toZonedDateTimeISO(zone);return [b.toString(),b.calendarId,b.epochNanoseconds,a.toZonedDateTimeISO.length];`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T05:30:00.123456789+05:30[+05:30]","iso8601",123456789n,1]});
});

it("brands before zone validation and never coerces arbitrary zone objects", async () => {
  expect(await run(`const method=Temporal.Instant.prototype.toZonedDateTimeISO;if(typeof method!=='function')throw 'missing';
    const zone=new Proxy({},{get(){throw 'coercion'}}),errors=[];
    for(const receiver of [{},new Temporal.Instant(0n)])try{method.call(receiver,zone)}catch(e){errors.push(e.name)}
    return errors;`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

it("uses zoned private epochs across Instant input operations", async () => {
  expect(await run(`const zoned=new Temporal.ZonedDateTime(123456789n,'UTC');
    for(const key of ['epochNanoseconds','toString',Symbol.toPrimitive])Object.defineProperty(zoned,key,{get(){throw 'public read'}});
    const a=new Temporal.Instant(123456789n);return [Temporal.Instant.from(zoned).epochNanoseconds,
      Temporal.Instant.compare(a,zoned),a.equals(zoned),a.until(zoned).toString(),a.since(zoned).toString()];`))
    .toMatchObject({ok:true,returnValue:[123456789n,0,true,"PT0S","PT0S"]});
});

it("retains captured result prototypes and conversion methods across replay", async () => {
  const source=`const a=new Temporal.Instant(0n),method=a.toZonedDateTimeISO,proto=Temporal.ZonedDateTime.prototype;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'2000-01-01T00:00[Asia/Tokyo]');await 0;
    return [b.toString(),Object.getPrototypeOf(b)===proto];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["1970-01-01T09:00:00+09:00[Asia/Tokyo]",true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
