import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats nanoseconds, zone and calendar with independent display options", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(123456789n,'+05:30','buddhist');
    return [a.toString(),a.toString({calendarName:'never',timeZoneName:'never',offset:'never',fractionalSecondDigits:3}),
      a.toString({calendarName:'critical',timeZoneName:'critical',smallestUnit:'seconds',roundingMode:'ceil'})];`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T05:30:00.123456789+05:30[+05:30][u-ca=buddhist]",
      "1970-01-01T05:30:00.123","1970-01-01T05:30:01+05:30[!+05:30][!u-ca=buddhist]"]});
});

it("reads and coerces formatting options in specification order", async () => {
  expect(await run(`const log=[];const values={calendarName:'auto',fractionalSecondDigits:'auto',offset:'auto',
    roundingMode:'trunc',smallestUnit:'second',timeZoneName:'auto'};
    const options=new Proxy({},{get(t,k){log.push(k);return {toString(){log.push('coerce.'+k);return values[k]}}}});
    new Temporal.ZonedDateTime(0n,'UTC').toString(options);return log;`))
    .toMatchObject({ok:true,returnValue:["calendarName","coerce.calendarName","fractionalSecondDigits","coerce.fractionalSecondDigits",
      "offset","coerce.offset","roundingMode","coerce.roundingMode","smallestUnit","coerce.smallestUnit","timeZoneName","coerce.timeZoneName"]});
});

it("reads timeZoneName before rejecting recognized but disallowed units", async () => {
  expect(await run(`const results=[];for(const unit of ['hour','day']){const log=[];let error;
    try{new Temporal.ZonedDateTime(0n,'UTC').toString({smallestUnit:unit,get timeZoneName(){log.push('zone');return 'auto'}})}
    catch(e){error=e.name}results.push([error,log]);}return results;`))
    .toMatchObject({ok:true,returnValue:[["RangeError",["zone"]],["RangeError",["zone"]]]});
});

it("brands before options, ignores JSON arguments and public fields", async () => {
  expect(await run(`const proto=Temporal.ZonedDateTime.prototype;if(!Object.hasOwn(proto,'toString'))throw 'missing';
    const a=new Temporal.ZonedDateTime(0n,'UTC');for(const key of ['epochNanoseconds','calendarId','timeZoneId'])
      Object.defineProperty(a,key,{get(){throw 'shadow'}});
    const options=new Proxy({},{get(){throw 'options'}});let error;
    try{proto.toString.call({},options)}catch(e){error=e.name}
    return [error,a.toJSON(options),JSON.stringify(a),proto.toString.length,proto.toJSON.length];`))
    .toMatchObject({ok:true,returnValue:["TypeError","1970-01-01T00:00:00+00:00[UTC]",'"1970-01-01T00:00:00+00:00[UTC]"',0,0]});
});

it("replays captured formatting methods after constructor replacement", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC');const method=a.toJSON;
    Temporal.ZonedDateTime=undefined;await 0;return method.call(a);`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"1970-01-01T00:00:00+00:00[UTC]"});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
