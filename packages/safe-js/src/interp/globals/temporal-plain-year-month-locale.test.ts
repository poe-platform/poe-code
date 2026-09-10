import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["UTC", "Pacific/Honolulu", "+05:30"])("formats year/month without shifting for %s", async zone => {
  const expected = new Intl.DateTimeFormat("en-US", {calendar:"iso8601",month:"long",year:"numeric",timeZone:"UTC"}).format(Date.UTC(2000,1,1));
  expect(expected).toContain("February");
  expect(expected).toContain("2000");
  expect(await run(`return new Temporal.PlainYearMonth(2000,2).toLocaleString('en-US',{
    calendar:'iso8601',month:'long',year:'numeric',timeZone:${JSON.stringify(zone)}})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("requires matching calendars even for ISO year-months", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainYearMonth.prototype,'toLocaleString'))throw 'missing';
    const errors=[];for(const calendar of ['iso8601','buddhist'])try{
      new Temporal.PlainYearMonth(2000,2,calendar,29).toLocaleString('en-US',{calendar:'gregory'})
    }catch(e){errors.push(e.name)}return errors`))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError"]});
});

it("validates the receiver before locales and the zone before later options", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainYearMonth.prototype,'toLocaleString'))throw 'missing';
    const events=[];const locales={get length(){events.push('locale');return 0}};
    try{Temporal.PlainYearMonth.prototype.toLocaleString.call({},locales)}catch(e){events.push(e.name)}
    try{new Temporal.PlainYearMonth(2000,2).toLocaleString('en',{get timeZone(){events.push('zone');return 'Not/AZone'},get day(){events.push('day')}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","zone","RangeError"]});
});

it("formats private fields and retains a captured locale method through replay", async () => {
  const source=`const t=new Temporal.PlainYearMonth(2000,2,'buddhist',29);
    for(const k of ['monthCode','day','calendarId'])Object.defineProperty(t,k,{get(){throw Error('shadow')}});
    const method=t.toLocaleString;Temporal.PlainYearMonth=undefined;await 0;
    return [method.length,method.call(t,'en-US',{calendar:'buddhist',month:'long',year:'numeric'})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[0,"February 2543 BE"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
