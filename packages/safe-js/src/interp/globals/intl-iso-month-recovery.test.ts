import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["en-US", "pl-PL", "ru-RU"])("recovers ISO standalone months from host Gregorian data in %s", async locale => {
  const source = `
    const options={calendar:'iso8601',month:'long',timeZone:'UTC'};
    const formatter=new Intl.DateTimeFormat(${JSON.stringify(locale)},options);
    const start=Date.UTC(2000,1,29),end=Date.UTC(2000,2,2);
    const parts=formatter.formatToParts(start),range=formatter.formatRangeToParts(start,end);
    return [parts,formatter.format(start),range,formatter.formatRange(start,end),formatter.resolvedOptions().calendar,
      new Temporal.PlainMonthDay(2,29).toLocaleString(${JSON.stringify(locale)},options),
      new Temporal.PlainYearMonth(2000,2).toLocaleString(${JSON.stringify(locale)},options),
      formatter.formatToParts(new Temporal.PlainYearMonth(2000,2)),
      formatter.formatRangeToParts(new Temporal.PlainYearMonth(2000,2),new Temporal.PlainYearMonth(2000,3))];`;
  const native = new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "long", timeZone: "UTC" });
  const start = Date.UTC(2000, 1, 29), end = Date.UTC(2000, 2, 2);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [
    native.formatToParts(start), native.format(start), native.formatRangeToParts(start, end), native.formatRange(start, end), "iso8601",
    native.format(start), native.format(start), native.formatToParts(start), native.formatRangeToParts(start, end)
  ] });
});

it("preserves timezone conversion, same-month ranges, option reads, and invalid operand errors", async () => {
  const expected = new Intl.DateTimeFormat("en-US", { calendar: "gregory", month: "long", timeZone: "America/Los_Angeles" });
  const epoch = Date.UTC(2000, 2, 1);
  expect(await run(`
    let reads=0;const f=new Intl.DateTimeFormat('en-US',{
      calendar:'iso8601',get month(){reads++;return 'long'},timeZone:'America/Los_Angeles'});
    const errors=[];for(const args of [[NaN,0],[undefined,0],[0,Infinity]])try{f.formatRange(...args)}catch(e){errors.push(e.name)}
    return [f.format(${epoch}),f.formatRangeToParts(${epoch},${epoch}),reads,errors,
      new Temporal.PlainYearMonth(2000,3).toLocaleString('en-US',{calendar:'iso8601',month:'long',timeZone:'America/Los_Angeles'})];
  `)).toMatchObject({ ok: true, returnValue: [expected.format(epoch), expected.formatRangeToParts(epoch, epoch), 1,
    ["RangeError", "TypeError", "RangeError"], "March"] });
});

it("retains locale extensions and uses each Temporal input's actual ISO date", async () => {
  const locale = "ar-EG-u-ca-iso8601-nu-arab";
  const native = new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "long", timeZone: "UTC" });
  const february = Date.UTC(2000, 1, 29);
  expect(await run(`
    const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},{month:'long',timeZone:'UTC'});
    const a=new Temporal.PlainYearMonth(2000,2),b=new Temporal.PlainYearMonth(2001,2);
    return [f.format(new Temporal.PlainDate(2000,2,29)),f.format(new Temporal.PlainDateTime(2000,2,29,23)),
      f.format(new Temporal.Instant(-1n)),f.formatRangeToParts(a,b),f.resolvedOptions().numberingSystem,
      f.resolvedOptions().calendar];
  `)).toMatchObject({ ok: true, returnValue: [native.format(february), native.format(february), native.format(-1),
    native.formatRangeToParts(Date.UTC(2000, 1, 1), Date.UTC(2001, 1, 1)), "arab", "iso8601"] });
});
