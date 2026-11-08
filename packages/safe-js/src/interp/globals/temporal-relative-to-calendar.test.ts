import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["2020-01-01", "2020-01", "01-01", "2016-12-31T23:59:60"])("accepts calendar string %s in relativeTo bags", async calendar => {
  expect(await run(`const relativeTo={year:2000,month:1,day:31,calendar:${JSON.stringify(calendar)}};
    return [Temporal.Duration.from({months:1}).total({relativeTo,unit:'days'}),
      Temporal.Duration.compare({months:1},{days:29},{relativeTo}),
      Temporal.Duration.from({days:29}).round({relativeTo,smallestUnit:'month'}).toString()]`))
    .toMatchObject({ok:true,returnValue:[29,0,"P1M"]});
});

it("uses the private calendar of an owned PlainDateTime in a relativeTo bag", async () => {
  expect(await run(`const calendar=new Temporal.PlainDateTime(2000,1,1,0,0,0,0,0,0,'buddhist');
    for(const key of ['calendarId','calendar','toString'])Object.defineProperty(calendar,key,{get(){throw 'public read'}});
    return Temporal.Duration.from({months:1}).total({unit:'days',relativeTo:{calendar,year:2543,month:1,day:31}})`))
    .toMatchObject({ok:true,returnValue:29});
});

it("extracts a non-ISO calendar without applying the source string's representable range", async () => {
  expect(await run(`return Temporal.Duration.from({months:1}).total({unit:'days',
    relativeTo:{calendar:'+999999-01-01[u-ca=buddhist]',year:2543,month:1,day:31}})`))
    .toMatchObject({ok:true,returnValue:29});
});

it.each(["2020-02-30","2020-01-01T00:00+01:60"])("rejects invalid calendar %s before reading other fields", async calendar => {
  expect(await run(`const reads=[];try{new Temporal.Duration().total({unit:'days',
    relativeTo:{calendar:${JSON.stringify(calendar)},get day(){reads.push('day');return 1},year:2000,month:1}})}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});
