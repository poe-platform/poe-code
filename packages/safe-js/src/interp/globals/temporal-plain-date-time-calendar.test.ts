import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "2020-01-01", "2020-01-01[u-ca=iso8601]", "2020-01-01T00:00:00.000000000",
  "2020-01-01T00:00:00.000000000[u-ca=iso8601]", "01-01", "01-01[u-ca=iso8601]",
  "2020-01", "2020-01[u-ca=iso8601]", "2016-12-31T23:59:60"
])("accepts ISO calendar string %s in property bags", async calendar => {
  expect(await run(`const value=Temporal.PlainDateTime.from({year:1976,monthCode:'M11',day:18,calendar:${JSON.stringify(calendar)}});
    return [value.toString(),value.calendarId]`)).toMatchObject({ok:true,returnValue:["1976-11-18T00:00:00","iso8601"]});
});

it("extracts a non-ISO calendar from a date string without applying its value range", async () => {
  expect(await run(`return Temporal.PlainDateTime.from({calendar:'+999999-01-01[u-ca=buddhist]',year:2543,month:2,day:29}).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-02-29T00:00:00[u-ca=buddhist]"});
});

it("uses an owned PlainDateTime calendar without reading its public properties", async () => {
  expect(await run(`const calendar=new Temporal.PlainDateTime(2000,1,1,0,0,0,0,0,0,'buddhist');
    for(const key of ['calendar','calendarId','toString'])Object.defineProperty(calendar,key,{get(){throw 'public read'}});
    return Temporal.PlainDateTime.from({calendar,year:2543,month:2,day:29}).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-02-29T00:00:00[u-ca=buddhist]"});
});

it.each(["2020-02-30","2020-13-01","2020-01-01T00:00+01:60","2020-01-01T24:00"])("rejects invalid calendar syntax before field reads: %s", async calendar => {
  expect(await run(`const reads=[];try{Temporal.PlainDateTime.from({calendar:${JSON.stringify(calendar)},get day(){reads.push('day');return 1},month:1,year:2000})}
    catch(error){return [error.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});
