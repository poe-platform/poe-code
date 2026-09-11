import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["2000-01-01T00:00:00.000000001","2000-01-01T00:00:00.000000002",-1],
  ["2000-02-29T23:59:59","2000-03-01T00:00",-1],
  ["2001-01-01","2000-12-31",1],
  ["2000-01-01","2000-01-01T00:00",0]
])("compares ISO fields for %s and %s", async (one,two,expected) => {
  expect(await run(`return Temporal.PlainDateTime.compare(${JSON.stringify(one)},${JSON.stringify(two)})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("ignores calendars for ordering but includes them in equality", async () => {
  expect(await run(`const iso=new Temporal.PlainDateTime(2000,2,29,12);
    const buddhist=new Temporal.PlainDateTime(2000,2,29,12,0,0,0,0,0,'buddhist');
    return [Temporal.PlainDateTime.compare(iso,buddhist),iso.equals(buddhist),iso.equals('2000-02-29T12:00'),buddhist.equals('2000-02-29T12:00[u-ca=buddhist]')]`))
    .toMatchObject({ok:true,returnValue:[0,false,true,true]});
});

it("does not read public fields from owned comparison operands", async () => {
  expect(await run(`const first=new Temporal.PlainDateTime(2000,1,1);const second=new Temporal.PlainDateTime(2000,1,1);
    for(const value of [first,second])Object.defineProperty(value,'year',{get(){throw 'public getter'}});
    return [Temporal.PlainDateTime.compare(first,second),first.equals(second)]`))
    .toMatchObject({ok:true,returnValue:[0,true]});
});

it("finishes first-operand validation before reading the second", async () => {
  expect(await run(`const reads=[];try{Temporal.PlainDateTime.compare('invalid',new Proxy({},{get(t,k){reads.push(k);throw 'second'}}))}
    catch(error){return [error.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("retains captured comparison and equality methods through replay", async () => {
  const source=`const value=new Temporal.PlainDateTime(2000,1,1);const compare=Temporal.PlainDateTime.compare;const equals=value.equals;
    Temporal.PlainDateTime=undefined;await 0;
    return [compare.length,equals.length,compare(value,'2001-01-01'),equals.call(value,'2000-01-01')]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[2,1,-1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
