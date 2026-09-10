import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["{seconds:59}","{seconds:2}","add",[0,0,0,61,0,0,0]],
  ["{minutes:1}","{seconds:1}","subtract",[0,0,0,59,0,0,0]],
  ["{hours:1}","{minutes:90}","subtract",[0,0,-30,0,0,0,0]],
  ["{days:1}","{hours:25}","add",[2,1,0,0,0,0,0]],
  ["{milliseconds:1}","{nanoseconds:1}","subtract",[0,0,0,0,0,999,999]],
  ["{nanoseconds:1000}","{nanoseconds:1}","add",[0,0,0,0,0,0,1001]],
  ["{seconds:-1}","'PT1S'","add",[0,0,0,0,0,0,0]]
])("balances %s %s using %s", async (left,right,method,expected) => {
  expect(await run(`const d=Temporal.Duration.from(${left}).${method}(${right});
    return [d.days,d.hours,d.minutes,d.seconds,d.milliseconds,d.microseconds,d.nanoseconds]`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each(["years","months","weeks"])("rejects calendar unit %s even if subtraction would cancel it", async unit => {
  expect(await run(`const d=Temporal.Duration.from({${unit}:1});try{d.subtract(d);return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("checks receiver branding before argument getters and converts arguments before calendar rejection", async () => {
  expect(await run(`const events=[];const input={get seconds(){events.push('seconds');return 0}};
    try{Temporal.Duration.prototype.add.call({},input)}catch(e){events.push(e.name)}
    try{new Temporal.Duration(1).add(input)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","seconds","RangeError"]});
});

it("uses both branded operands private fields and returns the original realm prototype", async () => {
  expect(await run(`const Original=Temporal.Duration;class Child extends Original{};const left=new Child(0,0,0,0,0,0,1);const right=new Child(0,0,0,0,0,0,2);
    for(const d of [left,right])Object.defineProperty(d,'seconds',{get(){throw 'shadow'}});left.label=7;
    Temporal.Duration=function(){throw 'replaced'};const sum=left.add(right);return [sum.seconds,sum!==left,
      Object.getPrototypeOf(sum)===Original.prototype,sum instanceof Child,Object.hasOwn(sum,'label')]`))
    .toMatchObject({ok:true,returnValue:[3,true,true,false,false]});
});

it("preserves exact boundary nanoseconds and rejects overflow", async () => {
  expect(await run(`const d=Temporal.Duration.from({seconds:9007199254740991,nanoseconds:999999998});
    const max=d.add({nanoseconds:1});let name;try{max.add({nanoseconds:1})}catch(e){name=e.name}
    const zero=max.subtract(max);return [max.seconds,max.milliseconds,max.microseconds,max.nanoseconds,name,zero.blank,Object.is(zero.seconds,-0)]`))
    .toMatchObject({ok:true,returnValue:[9007199254740991,999,999,999,"RangeError",true,false]});
});

it("ignores extra arguments and exposes nonconstructible standard metadata", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{get(){events.push('get');throw 'options'}});
    const d=new Temporal.Duration().add({seconds:1},options);const meta=['add','subtract'].map(name=>{
      const desc=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,name);let error;try{new desc.value()}catch(e){error=e.name}
      return [desc.value.name,desc.value.length,desc.enumerable,desc.writable,desc.configurable,error]});return [d.seconds,events,meta]`))
    .toMatchObject({ok:true,returnValue:[1,[],[["add",1,false,true,true,"TypeError"],["subtract",1,false,true,true,"TypeError"]]]});
});
