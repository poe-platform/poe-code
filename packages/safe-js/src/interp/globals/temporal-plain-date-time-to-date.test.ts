import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("drops time while preserving the private ISO date and calendar", async () => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,2,29,23,59,59,999,999,999,'buddhist');
    for(const key of ['year','month','day','calendarId'])Object.defineProperty(value,key,{get(){throw key}});
    const date=value.toPlainDate();return [date.toString(),date.year,date instanceof Temporal.PlainDate]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29[u-ca=buddhist]",2543,true]});
});

it("uses the intrinsic date prototype even after namespace replacement and replay", async () => {
  const source=`class Derived extends Temporal.PlainDateTime{};const value=new Derived(2000,1,1);
    const method=value.toPlainDate;const proto=Temporal.PlainDate.prototype;Temporal.PlainDate=undefined;
    const first=method.call(value);await 0;const second=method.call(value);
    return [method.length,Object.getPrototypeOf(first)===proto,Object.getPrototypeOf(second)===proto,first!==second,second.toString()]`;
  const first=await run(source);expect(first).toMatchObject({ok:true,returnValue:[0,true,true,true,"2000-01-01"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it("converts the date-time endpoints and rejects forged receivers", async () => {
  expect(await run(`const first=Temporal.PlainDateTime.from('-271821-04-19T00:00:00.000000001');
    const last=Temporal.PlainDateTime.from('+275760-09-13T23:59:59.999999999');let error;
    try{first.toPlainDate.call({})}catch(e){error=e.name}
    return [first.toPlainDate().toString(),last.toPlainDate().toString(),error]`))
    .toMatchObject({ok:true,returnValue:["-271821-04-19","+275760-09-13","TypeError"]});
});
