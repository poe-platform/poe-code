import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("orders ISO reference dates independently of calendars", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(2000,2,'iso8601',29),b=new Temporal.PlainYearMonth(2000,2,'buddhist',29);
    return [Temporal.PlainYearMonth.compare(a,b),Temporal.PlainYearMonth.compare(a,'2000-02'),Temporal.PlainYearMonth.compare('1999-12',a)]`))
    .toMatchObject({ok:true,returnValue:[0,1,-1]});
});

it("equals checks the reference day and calendar", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(2000,2,'iso8601',29);
    return [a.equals(a),a.equals('2000-02'),a.equals(new Temporal.PlainYearMonth(2000,2,'buddhist',29)),Temporal.PlainYearMonth.from('2000-02').equals({year:2000,month:2})]`))
    .toMatchObject({ok:true,returnValue:[true,false,false,true]});
});

it("reads comparison operands in order and uses private slots for owned values", async () => {
  expect(await run(`const events=[];const a=new Temporal.PlainYearMonth(2000,2);
    for(const key of ['calendar','year','month','monthCode'])Object.defineProperty(a,key,{get(){throw Error('shadow')}});
    const bag=label=>new Proxy({year:2000,month:2},{get(t,k){events.push(label+':'+k);return t[k]}});
    const result=Temporal.PlainYearMonth.compare(bag('a'),bag('b'));
    return [result,a.equals(a),Temporal.PlainYearMonth.compare(a,a),events]`))
    .toMatchObject({ok:true,returnValue:[0,true,0,["a:calendar","a:month","a:monthCode","a:year","b:calendar","b:month","b:monthCode","b:year"]]});
});

it("validates equals receivers before observing the other operand", async () => {
  expect(await run(`const events=[],p=Temporal.PlainYearMonth.prototype,t=new Temporal.PlainYearMonth(2000,2);
    const other={get calendar(){events.push('calendar');return 'iso8601'}};
    for(const receiver of [{},p,new Proxy(t,{})])try{p.equals.call(receiver,other)}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError","TypeError"]});
});

it("finishes first-operand validation before touching the second", async () => {
  expect(await run(`const events=[];try{Temporal.PlainYearMonth.compare('invalid',new Proxy({},{get(){events.push('second');throw Error('read')}}))}
    catch(e){return [e.name,events]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("preserves captured comparison methods through replay", async () => {
  const source=`const value=new Temporal.PlainYearMonth(2000,2),compare=Temporal.PlainYearMonth.compare,equals=value.equals;
    Temporal.PlainYearMonth=undefined;await 0;return [compare.length,equals.length,compare(value,'2001-02'),equals.call(value,'2000-02')]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[2,1,-1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:[2,1,-1,true]});
});
