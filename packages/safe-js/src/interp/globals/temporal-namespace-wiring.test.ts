import { expect, it } from "vitest";
import { run } from "../../run.js";

it("exposes all Temporal constructors with standard namespace descriptors", async () => {
  expect(await run(`const names=['Duration','Instant','PlainDate','PlainDateTime',
    'PlainMonthDay','PlainTime','PlainYearMonth','ZonedDateTime'];
    return [Object.prototype.toString.call(Temporal),Object.getPrototypeOf(Temporal)===Object.prototype,
      names.every(name=>{const d=Object.getOwnPropertyDescriptor(Temporal,name);
        return typeof d.value==='function'&&d.value.name===name&&d.writable&&!d.enumerable&&d.configurable}),
      Object.prototype.toString.call(Temporal.Now)];`))
    .toMatchObject({ok:true,returnValue:["[object Temporal]",true,true,"[object Temporal.Now]"]});
});

it("keeps cross-type result prototypes after replacing namespace constructor properties", async () => {
  expect(await run(`const originals={...Object.fromEntries(['Duration','Instant','PlainDate','PlainDateTime',
    'PlainMonthDay','PlainTime','PlainYearMonth','ZonedDateTime'].map(name=>[name,Temporal[name]]))};
    const instant=new Temporal.Instant(0n);const date=new Temporal.PlainDate(2000,2,29);
    for(const name of Object.keys(originals))Temporal[name]=undefined;
    const zoned=instant.toZonedDateTimeISO('UTC');
    const results={Instant:zoned.toInstant(),ZonedDateTime:date.toZonedDateTime('UTC'),
      PlainDate:zoned.toPlainDate(),PlainDateTime:zoned.toPlainDateTime(),PlainTime:zoned.toPlainTime(),
      PlainMonthDay:date.toPlainMonthDay(),PlainYearMonth:date.toPlainYearMonth(),Duration:instant.until(instant)};
    return Object.keys(results).every(name=>Object.getPrototypeOf(results[name])===originals[name].prototype);`))
    .toMatchObject({ok:true,returnValue:true});
});
