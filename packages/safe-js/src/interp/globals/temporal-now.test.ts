import { expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("exposes the ordinary Temporal.Now namespace and method metadata", async () => {
  expect(await run(`const n=Temporal.Now;return [typeof n,Object.getPrototypeOf(n)===Object.prototype,
    Object.prototype.toString.call(n),Object.keys(n),
    ['timeZoneId','instant','plainDateTimeISO','zonedDateTimeISO','plainDateISO','plainTimeISO'].map(k=>[n[k].name,n[k].length,Object.hasOwn(n[k],'prototype')])]`))
    .toMatchObject({ok:true,returnValue:["object",true,"[object Temporal.Now]",[],[
      ["timeZoneId",0,false],["instant",0,false],["plainDateTimeISO",0,false],
      ["zonedDateTimeISO",0,false],["plainDateISO",0,false],["plainTimeISO",0,false]
    ]]});
});

it("constructs all Now result types from the injected millisecond clock", async () => {
  const now=vi.fn(()=>7);
  expect(await run(`return [Temporal.Now.instant().epochNanoseconds,
    Temporal.Now.zonedDateTimeISO('+05:30').toString(),
    Temporal.Now.plainDateTimeISO('UTC').toString(),Temporal.Now.plainDateISO('UTC').toString(),
    Temporal.Now.plainTimeISO('UTC').toString()]`,{clock:{now,snapshot:()=>undefined}}))
    .toMatchObject({ok:true,returnValue:[7000000n,"1970-01-01T05:30:00.007+05:30[+05:30]",
      "1970-01-01T00:00:00.007","1970-01-01","00:00:00.007"]});
  expect(now).toHaveBeenCalledTimes(5);
});

it("validates zone inputs before consuming a clock tick", async () => {
  const now=vi.fn(()=>7);
  expect(await run(`const errors=[];for(const zone of ['Not/AZone','+25:00',{},null,7]){
    try{Temporal.Now.plainDateISO(zone)}catch(e){errors.push(e.name)}}return errors`,{clock:{now,snapshot:()=>undefined}}))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError","TypeError","TypeError","TypeError"]});
  expect(now).not.toHaveBeenCalled();
});

it("reads private zoned slots and ignores unrelated extra arguments", async () => {
  expect(await run(`const z=new Temporal.ZonedDateTime(0n,'+05:30');
    Object.defineProperty(z,'timeZoneId',{get(){throw Error('shadow')}});
    return [Temporal.Now.plainTimeISO(z,Object.create({secret:1})).toString(),
      Temporal.Now.instant(Object.create({secret:1})).epochNanoseconds]`,{clock:{now:()=>-1,snapshot:()=>undefined}}))
    .toMatchObject({ok:true,returnValue:["05:29:59.999",-1000000n]});
});

it("keeps captured Now methods independent of public Date and Temporal shadows", async () => {
  expect(await run(`const instant=Temporal.Now.instant,plainDate=Temporal.Now.plainDateISO;
    Date.now=()=>999;Temporal.Instant=()=>{throw Error('shadow')};Temporal.Now={};
    return [instant().epochNanoseconds,plainDate('UTC').toString()]`,{clock:{now:()=>7,snapshot:()=>undefined}}))
    .toMatchObject({ok:true,returnValue:[7000000n,"1970-01-01"]});
});

it("replays completed Now clock reads without calling the host again", async () => {
  const now=vi.fn(()=>7);
  const clock={now,snapshot:()=>undefined};
  const source=`const instant=Temporal.Now.instant;instant.label=42;await 0;
    return [instant().epochNanoseconds,Temporal.Now.plainDateTimeISO('UTC').toString(),instant.label]`;
  const first=await run(source,{clock});
  expect(first).toMatchObject({ok:true,returnValue:[7000000n,"1970-01-01T00:00:00.007",42]});
  const snapshot=JSON.parse(await dump(first));
  expect(await run(source,{snapshot,clock})).toMatchObject({ok:true,returnValue:first.returnValue});
  expect(now).toHaveBeenCalledTimes(2);
});

it("records default-zone reads so completed replay does not adopt a new host zone", async () => {
  const Native=Intl.DateTimeFormat;
  let zone="UTC";
  const readZone=vi.fn(function () { return new Native("en-US",{timeZone:zone}); });
  const spy=vi.spyOn(Intl,"DateTimeFormat").mockImplementation(readZone);
  const now=vi.fn(()=>7);
  const clock={now,snapshot:()=>undefined};
  const source=`return [Temporal.Now.timeZoneId(),Temporal.Now.plainDateISO().toString()]`;
  try {
    const first=await run(source,{clock});
    expect(first).toMatchObject({ok:true,returnValue:["UTC","1970-01-01"]});
    const calls=readZone.mock.calls.length;
    expect(calls).toBe(2);
    const snapshot=JSON.parse(await dump(first));
    zone="Pacific/Honolulu";
    expect(await run(source,{snapshot,clock})).toMatchObject({ok:true,returnValue:first.returnValue});
    expect(readZone).toHaveBeenCalledTimes(calls);
    expect(now).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

it("continues both branches of a pending checkpoint before the clock read", async () => {
  const now=vi.fn(()=>7);
  const clock={now,snapshot:()=>undefined};
  const source=`const read=Temporal.Now.instant;await 0;return read().epochNanoseconds`;
  const pending=run(source,{clock});
  const completed=pending.catch(error=>error);
  try {
    const snapshot=JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok:true,returnValue:7000000n});
    expect(await run(source,{snapshot,clock})).toMatchObject({ok:true,returnValue:7000000n});
    expect(now).toHaveBeenCalledTimes(2);
  } finally { await completed; }
});
