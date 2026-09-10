import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("updates only present fields and leaves its receiver unchanged", async () => {
  expect(await run(`const d=new Temporal.Duration(1,2,3,4,5,6,7,8,9,10);const changed=d.with({seconds:'12',nanoseconds:0,years:undefined});
    return [changed.years,changed.months,changed.weeks,changed.days,changed.hours,changed.minutes,changed.seconds,
      changed.milliseconds,changed.microseconds,changed.nanoseconds,d.seconds,changed!==d]`))
    .toMatchObject({ok:true,returnValue:[1,2,3,4,5,6,12,8,9,0,7,true]});
});

it("reads partial fields alphabetically with independent numeric conversion", async () => {
  expect(await run(`const events=[];const input=new Proxy({seconds:{valueOf(){events.push('number');return 2}}},
    {get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}});
    return [new Temporal.Duration().with(input).seconds,events]`))
    .toMatchObject({ok:true,returnValue:[2,["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","number","weeks","years"]]});
});

it("checks the receiver before reading the partial object", async () => {
  expect(await run(`let reads=0;try{Temporal.Duration.prototype.with.call({},new Proxy({},{get(){reads++;throw 'read'}}))}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it.each(["undefined","null","1","'PT1S'","{}","{seconds:undefined}"])("rejects invalid partial value %s", async input => {
  expect(await run(`try{new Temporal.Duration().with(${input});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("validates mixed signs against retained receiver fields after all reads", async () => {
  expect(await run(`const events=[];try{new Temporal.Duration(0,0,0,0,0,0,1).with({get days(){events.push('days');return -1},get years(){events.push('years');return 0}})}
    catch(e){return [e.name,events]}`)).toMatchObject({ok:true,returnValue:["RangeError",["days","years"]]});
});

it("fails nonintegral conversion before reading later fields", async () => {
  expect(await run(`let reads=0;try{new Temporal.Duration().with({days:0.5,get hours(){reads++;throw 'later'}})}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",0]});
});

it("reads getters on branded partial inputs rather than copying their private slots", async () => {
  expect(await run(`const input=new Temporal.Duration(1);let reads=0;Object.defineProperty(input,'years',{get(){reads++;return 2}});
    return [new Temporal.Duration().with(input).years,reads]`)).toMatchObject({ok:true,returnValue:[2,1]});
});

it("uses private receiver fields and the original method realm prototype", async () => {
  expect(await run(`const Original=Temporal.Duration;class Child extends Original{};const d=new Child(1);
    Object.defineProperty(d,'years',{get(){throw 'shadow'}});d.label=7;const method=d.with;
    Temporal.Duration=function(){throw 'replaced'};const copy=method.call(d,{seconds:2});
    return [copy.years,copy.seconds,Object.getPrototypeOf(copy)===Original.prototype,Object.hasOwn(copy,'label'),copy instanceof Child]`))
    .toMatchObject({ok:true,returnValue:[1,2,true,false,false]});
});

it("validates combined exact bounds and allows changing the sign of every nonzero field", async () => {
  expect(await run(`const d=new Temporal.Duration(0,0,0,0,0,0,9007199254740991,0,0,999999999);let name;
    try{d.with({nanoseconds:1000000000})}catch(e){name=e.name}
    const negative=d.with({seconds:-9007199254740991,nanoseconds:-999999999});return [name,negative.sign,negative.nanoseconds]`))
    .toMatchObject({ok:true,returnValue:["RangeError",-1,-999999999]});
});

it("provides standard nonconstructible metadata and replays updated values", async () => {
  const source=`const desc=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,'with');let name;
    try{new desc.value()}catch(e){name=e.name}const d=Temporal.Duration.from('PT1S').with({nanoseconds:2});
    await 0;return [d.seconds,d.nanoseconds,desc.value.name,desc.value.length,desc.enumerable,desc.writable,desc.configurable,name]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[1,2,"with",1,false,true,true,"TypeError"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
