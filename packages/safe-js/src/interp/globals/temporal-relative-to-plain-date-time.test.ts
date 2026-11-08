import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["Temporal.Duration.from({months:1}).total({relativeTo,unit:'days'})",29],
  ["Temporal.Duration.compare({months:1},{days:29},{relativeTo})",0],
  ["Temporal.Duration.from({days:29}).round({relativeTo,smallestUnit:'month'}).toString()","P1M"]
])("uses private PlainDateTime date fields for %s", async (expression,expected) => {
  expect(await run(`const relativeTo=new Temporal.PlainDateTime(2000,1,31,23,59);
    for(const key of ['calendar','calendarId','year','month','monthCode','day','hour','timeZone','offset'])
      Object.defineProperty(relativeTo,key,{get(){throw 'public read '+key}});
    return ${expression}`)).toMatchObject({ok:true,returnValue:expected});
});

it("preserves a non-ISO calendar without reinterpreting its year as ISO", async () => {
  expect(await run(`const relativeTo=new Temporal.PlainDateTime(2000,1,31,23,59,0,0,0,0,'buddhist');
    return Temporal.Duration.from({months:1}).total({relativeTo,unit:'days'})`))
    .toMatchObject({ok:true,returnValue:29});
});

it("keeps relativeTo private-slot conversion through replay", async () => {
  const source=`const relativeTo=new Temporal.PlainDateTime(2000,1,31);await 0;
    return Temporal.Duration.from({months:1}).total({relativeTo,unit:'days'})`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:29});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:29});
});
