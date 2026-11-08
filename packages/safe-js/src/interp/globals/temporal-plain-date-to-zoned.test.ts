import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("converts a date at start of day or an explicit time", async () => {
  expect(await run(`const a=new Temporal.PlainDate(2000,1,1,'buddhist');
    return [a.toZonedDateTime('+05:30').toString(),a.toZonedDateTime({timeZone:'UTC',plainTime:'12:34'}).toString()];`))
    .toMatchObject({ok:true,returnValue:["2000-01-01T00:00:00+05:30[+05:30][u-ca=buddhist]","2000-01-01T12:34:00+00:00[UTC][u-ca=buddhist]"]});
});

it("handles skipped midnight and compatible overlap resolution", async () => {
  expect(await run(`return [new Temporal.PlainDate(2015,10,18).toZonedDateTime('America/Sao_Paulo').hour,
    new Temporal.PlainDate(2021,11,7).toZonedDateTime({timeZone:'America/New_York',plainTime:'01:30'}).offset];`))
    .toMatchObject({ok:true,returnValue:[1,"-04:00"]});
});

it("validates zone before reading plainTime and brands before either", async () => {
  expect(await run(`const method=Temporal.PlainDate.prototype.toZonedDateTime;if(typeof method!=='function')throw 'missing';
    const log=[];const input={get timeZone(){log.push('zone');return 'invalid/zone'},get plainTime(){log.push('time');return '12:00'}};
    const errors=[];for(const receiver of [{},new Temporal.PlainDate(2000,1,1)])
      try{method.call(receiver,input)}catch(e){errors.push(e.name)}return [errors,log];`))
    .toMatchObject({ok:true,returnValue:[["TypeError","RangeError"],["zone"]]});
});

it("uses owned zone slots and captured result prototype through replay", async () => {
  const source=`const a=new Temporal.PlainDate(2000,1,1);const zone=new Temporal.ZonedDateTime(0n,'+05:30');
    Object.defineProperty(zone,'timeZoneId',{get(){throw 'shadow'}});
    const proto=Temporal.ZonedDateTime.prototype;Temporal.ZonedDateTime=undefined;
    const b=a.toZonedDateTime(zone);await 0;return [b.timeZoneId,Object.getPrototypeOf(b)===proto,a.toZonedDateTime.length];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["+05:30",true,1]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
