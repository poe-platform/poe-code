import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

// ECMA-402 edition 12. These assertions deliberately do not use native output
// as an oracle. Text spellings are tested only in explicitly qualified data cells.
it("canonicalizes aliases, removes duplicates, and observes live locale properties", async () => {
  expect(await run(`
    const trace=[];const locales={length:2,0:{toString(){trace.push('string');locales[1]='he';return 'iw'}}};
    return [Intl.getCanonicalLocales(['EN-us','en-US','iw']),Intl.getCanonicalLocales(locales),trace];
  `)).toMatchObject({ ok: true, returnValue: [["en-US", "he"], ["he"], ["string"]] });
});

it("stops option coercion at an abrupt completion", async () => {
  expect(await run(`
    const trace=[];let error;
    try{new Intl.NumberFormat('en',{get localeMatcher(){trace.push('get');return {
      toString(){trace.push('string');throw 42}}},get style(){trace.push('late');return 'decimal'}})}catch(e){error=e}
    return [trace,error,new Intl.NumberFormat('en',{localeMatcher:'lookup'}).resolvedOptions().style];
  `)).toMatchObject({ ok: true, returnValue: [["get", "string"], 42, "decimal"] });
});

it.each(["Collator", "DateTimeFormat", "NumberFormat", "PluralRules", "Segmenter", "ListFormat", "RelativeTimeFormat", "DurationFormat"])(
  "qualifies unsupported-locale lookup fallback for %s", async name => {
    expect(await run(`
      const C=Intl.${name};const f=new C('zz-ZZ',{localeMatcher:'lookup'});
      return [C.supportedLocalesOf('zz-ZZ',{localeMatcher:'lookup'}),
        f.resolvedOptions().locale===new C(undefined,{localeMatcher:'lookup'}).resolvedOptions().locale,
        Intl.getCanonicalLocales(f.resolvedOptions().locale).length];
    `)).toMatchObject({ ok: true, returnValue: [[], true, 1] });
  }
);

it.each(["en-US", "pl-PL", "ru-RU", "ar-EG", "ja-JP"])(
  "requires populated ISO month fields and coherent range parts in %s", async locale => {
    expect(await run(`
      const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},{calendar:'iso8601',month:'long',timeZone:'UTC'});
      const a=Date.UTC(2000,1,29),b=Date.UTC(2000,2,2),p=f.formatToParts(a),r=f.formatRangeToParts(a,b);
      return [p.some(x=>x.type==='month'&&x.value.length>0),p.map(x=>x.value).join('')===f.format(a),
        r.some(x=>x.type==='month'&&x.value.length>0),r.map(x=>x.value).join('')===f.formatRange(a,b),
        r.every(x=>['shared','startRange','endRange'].includes(x.source)),f.resolvedOptions().calendar];
    `)).toMatchObject({ ok: true, returnValue: [true, true, true, true, true, "iso8601"] });
  }
);

it.each([
  ["UTC", ["06:59", "07:00", "05:59", "06:00"]],
  ["America/New_York", ["01:59", "03:00", "01:59", "01:00"]],
  ["Asia/Kathmandu", ["12:44", "12:45", "11:44", "11:45"]],
  ["+05:45", ["12:44", "12:45", "11:44", "11:45"]]
])("qualifies 2024 spring/fall transition inputs in %s", async (zone, expected) => {
  expect(await run(`
    const f=new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(zone)},hourCycle:'h23',
      numberingSystem:'latn',hour:'2-digit',minute:'2-digit'});
    return [Date.UTC(2024,2,10,6,59),Date.UTC(2024,2,10,7),Date.UTC(2024,10,3,5,59),Date.UTC(2024,10,3,6)].map(t=>{
      const p=f.formatToParts(t);return p.find(x=>x.type==='hour').value+':'+p.find(x=>x.type==='minute').value});
  `)).toMatchObject({ ok: true, returnValue: expected });
});

it("qualifies Japanese era boundary with populated era and reset year", async () => {
  expect(await run(`
    const f=new Intl.DateTimeFormat('en-US',{calendar:'japanese',year:'numeric',era:'short',timeZone:'UTC',numberingSystem:'latn'});
    const a=f.formatToParts(Date.UTC(2019,3,30)),b=f.formatToParts(Date.UTC(2019,4,1));
    const era=p=>p.find(x=>x.type==='era').value,year=p=>p.find(x=>x.type==='year').value;
    return [era(a).length>0,era(b).length>0,era(a)!==era(b),year(a),year(b),f.resolvedOptions().calendar];
  `)).toMatchObject({ ok: true, returnValue: [true, true, true, "31", "1", "japanese"] });
});

it("qualifies numbering-system overrides without accepting lost integer fields", async () => {
  expect(await run(`
    return ['latn','arab','deva'].map(numberingSystem=>{
      const f=new Intl.NumberFormat('en-u-nu-arab',{numberingSystem,useGrouping:false});const p=f.formatToParts(123);
      return [f.resolvedOptions().numberingSystem,p.find(x=>x.type==='integer').value,
        p.map(x=>x.value).join('')===f.format(123)];});
  `)).toMatchObject({ ok: true, returnValue: [["latn", "123", true], ["arab", "١٢٣", true], ["deva", "१२३", true]] });
});

it("requires collation equivalence, antisymmetry and numeric ordering", async () => {
  expect(await run(`
    const c=new Intl.Collator('en',{numeric:true}),a=c.compare('a','b'),b=c.compare('b','a');
    return [c.compare('e\u0301','é'),Math.sign(a)===-Math.sign(b),c.compare('2','10')<0,c.compare===c.compare];
  `)).toMatchObject({ ok: true, returnValue: [0, true, true, true] });
});

it("requires lossless segmentation, UTF-16 indices and grapheme boundaries", async () => {
  expect(await run(`
    const text='A👩‍👩‍👧‍👦e\u0301';const s=new Intl.Segmenter('en',{granularity:'grapheme'}).segment(text);
    const p=[...s];return [p.map(x=>x.segment),p.map(x=>x.index),p.map(x=>x.segment).join('')===text,
      s.containing(2).segment===p[1].segment,s.containing(text.length)];
  `)).toMatchObject({ ok: true, returnValue: [["A", "👩‍👩‍👧‍👦", "é"], [0, 1, 12], true, true, undefined] });
});

it("qualifies plural categories and coherent number/duration parts", async () => {
  expect(await run(`
    const p=new Intl.PluralRules('en'),n=new Intl.NumberFormat('en',{maximumFractionDigits:0});
    const range=n.formatRangeToParts(1,3);const d=new Intl.DurationFormat('en',{style:'long'});
    const value={hours:1,minutes:2},parts=d.formatToParts(value);
    return [[0,1,2].map(x=>p.select(x)),p.resolvedOptions().pluralCategories.includes(p.selectRange(1,2)),
      range.some(x=>x.type==='integer'&&x.value==='1'),range.some(x=>x.type==='integer'&&x.value==='3'),
      range.map(x=>x.value).join('')===n.formatRange(1,3),
      parts.some(x=>x.type==='integer'&&x.unit==='hour'&&x.value==='1'),
      parts.some(x=>x.type==='integer'&&x.unit==='minute'&&x.value==='2'),
      parts.map(x=>x.value).join('')===d.format(value)];
  `)).toMatchObject({ ok: true, returnValue: [["other", "one", "other"], true, true, true, true, true, true, true] });
});

it("requires meaningful display names and lossless list/relative-time parts", async () => {
  expect(await run(`
    const list=new Intl.ListFormat('en',{type:'conjunction'}),items=['Alice','Bob'];
    const lp=list.formatToParts(items),rt=new Intl.RelativeTimeFormat('en',{numeric:'always'}),rp=rt.formatToParts(2,'day');
    const names=new Intl.DisplayNames('en',{type:'region',fallback:'code'});
    return [lp.filter(x=>x.type==='element').map(x=>x.value),lp.map(x=>x.value).join('')===list.format(items),
      rp.some(x=>x.type==='integer'&&x.unit==='day'&&x.value==='2'),rp.map(x=>x.value).join('')===rt.format(2,'day'),
      names.of('US').length>0,names.resolvedOptions().type];
  `)).toMatchObject({ ok: true, returnValue: [["Alice", "Bob"], true, true, true, true, "region"] });
});

it("qualifies Gregorian BCE/CE and leap-day boundaries", async () => {
  expect(await run(`
    const f=new Intl.DateTimeFormat('en',{calendar:'gregory',timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric',era:'short',numberingSystem:'latn'});
    const date=y=>{const d=new Date(0);d.setUTCFullYear(y,0,1);return d};
    const a=f.formatToParts(date(0)),b=f.formatToParts(date(1));
    const leap=f.formatToParts(Date.UTC(2000,1,29));
    return [a.find(x=>x.type==='year').value,b.find(x=>x.type==='year').value,
      a.find(x=>x.type==='era').value!==b.find(x=>x.type==='era').value,
      leap.find(x=>x.type==='month').value,leap.find(x=>x.type==='day').value];
  `)).toMatchObject({ ok: true, returnValue: ["1", "1", true, "2", "29"] });
});

it("preserves exact decimal input and specified rounding", async () => {
  expect(await run(`
    const f=new Intl.NumberFormat('en',{useGrouping:false,maximumFractionDigits:0,roundingMode:'halfEven'});
    return [f.format('9007199254740993'),f.format(2.5),f.format(3.5),f.format(-2.5),
      new Intl.NumberFormat('en',{useGrouping:false,minimumFractionDigits:2}).format(-0)];
  `)).toMatchObject({ ok: true, returnValue: ["9007199254740993", "2", "4", "-2", "-0.00"] });
});

it("rejects invalid inputs while accepting neighboring valid values", async () => {
  expect(await run(`
    const errors=[];for(const f of [()=>Intl.getCanonicalLocales('en_US'),()=>Intl.getCanonicalLocales([1]),
      ()=>new Intl.DateTimeFormat('en',{timeZone:'No/Such_Zone'}),()=>new Intl.NumberFormat('en',{numberingSystem:'a'}),
      ()=>new Intl.DateTimeFormat('en').format(NaN),()=>new Intl.NumberFormat('en').formatRange(NaN,1),
      ()=>new Intl.DurationFormat('en').format({hours:1,minutes:-1}),()=>new Intl.Segmenter('en',{granularity:'line'})]){
      try{f();errors.push('no error')}catch(e){errors.push(e.name)}}
    return [errors,new Intl.NumberFormat('en',{numberingSystem:'foobar'}).format(1).length>0];
  `)).toMatchObject({ ok: true, returnValue: [["RangeError", "TypeError", "RangeError", "RangeError", "RangeError", "RangeError", "RangeError", "RangeError"], true] });
});

it.each(["pending", "completed"])("preserves captured options and cached format after %s cleanup/replay", async mode => {
  const source = `let reads=0;const options={get timeZone(){reads++;return 'UTC'},year:'numeric'};
    const f=new Intl.DateTimeFormat('en',options),format=f.format;
    options.year='2-digit';await 0;
    let error;try{format(new Temporal.PlainTime(12))}catch(e){error=e.name}
    return [reads,format(0),format===f.format,error,f.resolvedOptions().timeZone];`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: [1, "1970", true, "TypeError", "UTC"] });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [1, "1970", true, "TypeError", "UTC"] });
  } finally { await completed; }
});
