import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["en-US", "long", "February"], ["pl-PL", "long", "luty"], ["ru-RU", "long", "февраль"],
  ["en-US", "short", "Feb"], ["pl-PL", "short", "lut"], ["ru-RU", "short", "февр."],
  ["en-US", "narrow", "F"], ["pl-PL", "narrow", "L"], ["ru-RU", "narrow", "Ф"],
  ["en-US", "numeric", "2"], ["pl-PL", "numeric", "2"], ["ru-RU", "numeric", "2"],
  ["en-US", "2-digit", "02"], ["pl-PL", "2-digit", "02"], ["ru-RU", "2-digit", "02"]
])("retains the standalone ISO month for %s with %s width", async (locale, month, expected) => {
  const result = await run(`
    const options={calendar:'iso8601',month:${JSON.stringify(month)},timeZone:'UTC'};
    const locale=${JSON.stringify(locale)};
    return [
      new Intl.DateTimeFormat(locale,options).formatToParts(Date.UTC(2000,1,29)),
      new Temporal.PlainMonthDay(2,29).toLocaleString(locale,options),
      new Temporal.PlainYearMonth(2000,2).toLocaleString(locale,options)
    ]`);
  expect(result).toMatchObject({ ok: true, returnValue: [
    [{ type: "month", value: expected }], expected, expected
  ] });
});

it.each([
  ["en-US", "February", "March"],
  ["pl-PL", "luty", "marzec"],
  ["ru-RU", "февраль", "март"]
])("preserves both ISO month names and sources in a %s range", async (locale, start, end) => {
  const result = await run(`
    const formatter=new Intl.DateTimeFormat(${JSON.stringify(locale)}, {
      calendar:'iso8601',month:'long',timeZone:'UTC'
    });
    const start=Date.UTC(2000,1,29), end=Date.UTC(2000,2,2);
    const parts=formatter.formatRangeToParts(start,end);
    return [parts.filter(part=>part.type==='month'),
      formatter.formatRange(start,end)===parts.map(part=>part.value).join(''),
      formatter.resolvedOptions().calendar];
  `);
  expect(result).toMatchObject({ ok: true, returnValue: [[
    { type: "month", value: start, source: "startRange" },
    { type: "month", value: end, source: "endRange" }
  ], true, "iso8601"] });
});
