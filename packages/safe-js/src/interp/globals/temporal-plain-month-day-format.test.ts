import { expect, it } from "vitest";
import { run } from "../../run.js";

it("formats reference years and calendar annotations with every calendarName mode", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29,'iso8601',2000);
    return [t.toString(),t.toString({calendarName:'always'}),t.toString({calendarName:'never'}),t.toString({calendarName:'critical'}),t.toJSON()]`))
    .toMatchObject({ok:true,returnValue:["02-29","2000-02-29[u-ca=iso8601]","02-29","2000-02-29[!u-ca=iso8601]","02-29"]});
});

it("formats non-ISO private fields without consulting own shadows", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29,'buddhist',2000);
    for(const k of ['calendarId','monthCode','day'])Object.defineProperty(t,k,{get(){throw Error('shadow')}});
    return [t.toString(),t.toString({calendarName:'never'}),JSON.stringify(t)]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29[u-ca=buddhist]","2000-02-29",'"2000-02-29[u-ca=buddhist]"']});
});

it("reads calendarName once and coerces it with string hint", async () => {
  expect(await run(`const events=[];const t=new Temporal.PlainMonthDay(1,2);
    const result=t.toString({get calendarName(){events.push('get');return {[Symbol.toPrimitive](hint){events.push(hint);return 'always'}}}});
    return [result,events]`))
    .toMatchObject({ok:true,returnValue:["1972-01-02[u-ca=iso8601]",["get","string"]]});
});

it("validates the receiver before reading formatting options and ignores JSON arguments", async () => {
  expect(await run(`const p=Temporal.PlainMonthDay.prototype;const t=new Temporal.PlainMonthDay(1,2);const events=[];
    const options={get calendarName(){events.push('read');throw Error('option')}};
    for(const v of [{},p,new Proxy(t,{})])try{p.toString.call(v,options)}catch(e){events.push(e.name)}
    return [events,t.toJSON(options)]`))
    .toMatchObject({ok:true,returnValue:[["TypeError","TypeError","TypeError"],"01-02"]});
});

it.each(["null", "true", "1", "'auto'", "{calendarName:'invalid'}", "{calendarName:Symbol()}"])("rejects invalid formatting options: %s", async options => {
  const type = options.includes("invalid") ? "RangeError" : "TypeError";
  expect(await run(`try{new Temporal.PlainMonthDay(1,2).toString(${options})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:type});
});

it("rejects numeric coercion and every explicit valueOf receiver", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(1,2);const results=[];
    try{+t}catch(e){results.push(e.name)}
    for(const value of [t,{},null])try{Temporal.PlainMonthDay.prototype.valueOf.call(value)}catch(e){results.push(e.name)}
    return [String(t),results]`))
    .toMatchObject({ok:true,returnValue:["01-02",["TypeError","TypeError","TypeError","TypeError"]]});
});
