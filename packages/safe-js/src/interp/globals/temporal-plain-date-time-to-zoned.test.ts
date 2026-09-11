import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("supports all overlap and gap disambiguation choices", async () => {
  expect(await run(`const overlap=new Temporal.PlainDateTime(2021,11,7,1,30),gap=new Temporal.PlainDateTime(2021,3,14,2,30);
    return [overlap,gap].map(value=>['compatible','earlier','later','reject'].map(disambiguation=>{
      try{return value.toZonedDateTime('America/New_York',{disambiguation}).toInstant().toString()}catch(e){return e.name}}));`))
    .toMatchObject({ok:true,returnValue:[
      ["2021-11-07T05:30:00Z","2021-11-07T05:30:00Z","2021-11-07T06:30:00Z","RangeError"],
      ["2021-03-14T07:30:00Z","2021-03-14T06:30:00Z","2021-03-14T07:30:00Z","RangeError"]]});
});

it("validates receiver and zone before observing options", async () => {
  expect(await run(`const method=Temporal.PlainDateTime.prototype.toZonedDateTime;if(typeof method!=='function')throw 'missing';
    const reads=[],errors=[];const options={get disambiguation(){reads.push('get');return {toString(){reads.push('coerce');return 'compatible'}}}};
    for(const [receiver,zone] of [[{},'UTC'],[new Temporal.PlainDateTime(2000,1,1),'bad/zone']])
      try{method.call(receiver,zone,options)}catch(e){errors.push(e.name)}
    new Temporal.PlainDateTime(2000,1,1).toZonedDateTime('UTC',options);return [errors,reads];`))
    .toMatchObject({ok:true,returnValue:[["TypeError","RangeError"],["get","coerce"]]});
});

it("preserves private time/calendar and captures the zoned prototype across replay", async () => {
  const source=`const a=new Temporal.PlainDateTime(2000,1,1,12,34,56,123,456,789,'buddhist');
    const zone=new Temporal.ZonedDateTime(0n,'+05:30'),proto=Temporal.ZonedDateTime.prototype;
    for(const key of ['year','hour','calendarId','constructor'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    Object.defineProperty(zone,'timeZoneId',{get(){throw 'zone'}});Temporal.ZonedDateTime=undefined;
    const b=a.toZonedDateTime(zone);await 0;return [b.toString(),Object.getPrototypeOf(b)===proto,a.toZonedDateTime.length];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["2000-01-01T12:34:56.123456789+05:30[+05:30][u-ca=buddhist]",true,1]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
