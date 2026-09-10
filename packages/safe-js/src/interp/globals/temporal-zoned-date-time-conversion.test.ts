import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("converts the instant independently from zoned calendar and wall time", async () => {
  expect(await run(`const z=new Temporal.ZonedDateTime(123456789n,'-08:00','buddhist');
    return [z.toInstant().epochNanoseconds,z.toPlainDate().toString(),z.toPlainTime().toString(),z.toPlainDateTime().toString()];`))
    .toMatchObject({ok:true,returnValue:[123456789n,'1969-12-31[u-ca=buddhist]','16:00:00.123456789','1969-12-31T16:00:00.123456789[u-ca=buddhist]']});
});

it("reads private slots and uses captured intrinsic prototypes for conversions", async () => {
  expect(await run(`const z=new Temporal.ZonedDateTime(0n,'UTC');
    const names=['Instant','PlainDate','PlainTime','PlainDateTime'];const protos=names.map(n=>Temporal[n].prototype);
    for(const name of ['epochNanoseconds','timeZoneId','calendarId','year','month','day','hour'])
      Object.defineProperty(z,name,{get(){throw 'public getter'}});
    for(const name of names)Temporal[name]=undefined;
    const results=[z.toInstant(),z.toPlainDate(),z.toPlainTime(),z.toPlainDateTime()];
    return results.map((v,i)=>Object.getPrototypeOf(v)===protos[i]);`))
    .toMatchObject({ok:true,returnValue:[true,true,true,true]});
});

it("returns fresh intrinsic objects rather than ZonedDateTime subclass instances", async () => {
  expect(await run(`class Zoned extends Temporal.ZonedDateTime{};const z=new Zoned(0n,'UTC');
    return ['toInstant','toPlainDate','toPlainTime','toPlainDateTime'].map(name=>{
      const a=z[name](),b=z[name]();return [a!==b,a instanceof Zoned,z[name].length];
    });`)).toMatchObject({ok:true,returnValue:[[true,false,0],[true,false,0],[true,false,0],[true,false,0]]});
});

it("rejects forged conversion receivers", async () => {
  expect(await run(`return ['toInstant','toPlainDate','toPlainTime','toPlainDateTime'].map(name=>{
    const method=Temporal.ZonedDateTime.prototype[name];if(typeof method!=='function')throw 'missing';
    try{method.call({});return 'bad'}catch(e){return e.name}
  });`)).toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError','TypeError']});
});

it("replays captured conversion methods without consulting replaced constructors", async () => {
  const source=`const z=new Temporal.ZonedDateTime(-1n,'+05:30');const convert=z.toPlainDateTime;
    Temporal.PlainDateTime=undefined;await 0;return convert.call(z).toString();`;
  const first=await run(source);expect(first).toMatchObject({ok:true,returnValue:'1970-01-01T05:29:59.999999999'});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
