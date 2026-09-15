# Expanded Intl environment qualification

Execute the maintained 700-test Intl selection under the six recorded Node executables, with UTC and America/New_York. Record every assertion, exit status, locale availability and process.versions. Do not alter timeouts or infer a guest defect from an older native oracle.

Run this source from repository root using the selected Node binary and `--import tsx --input-type=module`; Node18.18 uses `--loader tsx --input-type=module`. Record JSON and inspect `checks`; process exit alone is not a pass.

```js
import { run } from "./packages/safe-js/src/run.ts";
const source = `
const n=new Intl.NumberFormat('en',{useGrouping:false});
const p=new Intl.PluralRules('en',{maximumFractionDigits:0,roundingMode:'floor'});
const trace=[];let error;try{n.formatRange(NaN,{valueOf(){trace.push('second');return 2}})}catch(e){error=e.name}
const f=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'numeric'});
const ranges=[];for(const pair of [[12,13],[13,12]]){try{ranges.push(f.formatRangeToParts(new Temporal.PlainTime(pair[0]),new Temporal.PlainTime(pair[1])).filter(x=>x.type==='hour').map(x=>[x.value,x.source]))}catch(e){ranges.push(e.name)}}
return {decimal:n.format('123456789012345678901234567890'),numberRange:n.formatRangeToParts(1,3).filter(x=>x.type==='integer').map(x=>[x.value,x.source]),error,trace,rounding:[p.select(1.5),p.resolvedOptions().roundingMode],zero:['auto','stripIfInteger'].map(trailingZeroDisplay=>new Intl.PluralRules('en',{minimumFractionDigits:2,trailingZeroDisplay}).select(1)),alias:['ka','kf','kr','ks','kv','kb','kc','kh','kk','kn'].map(k=>Intl.getCanonicalLocales('en-u-'+k+'-yes')[0]),ranges,authority:[typeof process,typeof require,typeof fetch]};`;
const guest = await run(source);
const x = guest.returnValue;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = {
  execution: guest.ok === true,
  decimal: x?.decimal === "123456789012345678901234567890",
  numberRange: equal(x?.numberRange, [
    ["1", "startRange"],
    ["3", "endRange"]
  ]),
  conversion: equal([x?.error, x?.trace], ["RangeError", ["second"]]),
  rounding: equal(x?.rounding, ["one", "floor"]),
  zero: equal(x?.zero, ["other", "one"]),
  alias: equal(x?.alias, [
    "en-u-ka-yes",
    "en-u-kf-yes",
    "en-u-kr-yes",
    "en-u-ks-yes",
    "en-u-kv-yes",
    "en-u-kb",
    "en-u-kc",
    "en-u-kh",
    "en-u-kk",
    "en-u-kn"
  ]),
  forward: equal(x?.ranges[0], [
    ["12", "startRange"],
    ["1", "endRange"]
  ]),
  reverse: equal(x?.ranges[1], [
    ["1", "startRange"],
    ["12", "endRange"]
  ]),
  authority: equal(x?.authority, ["undefined", "undefined", "undefined"])
};
console.log(
  JSON.stringify(
    {
      versions: process.versions,
      TZ: process.env.TZ,
      source,
      guest,
      checks,
      native: {
        numberRange: typeof Intl.NumberFormat.prototype.formatRange,
        pluralRange: typeof Intl.PluralRules.prototype.selectRange,
        iterator: typeof Iterator,
        decimal: new Intl.NumberFormat("en", { useGrouping: false }).format(
          "123456789012345678901234567890"
        ),
        rounding:
          new Intl.PluralRules("en", { roundingMode: "floor" }).resolvedOptions().roundingMode ??
          null
      }
    },
    null,
    2
  )
);
```

Execute the nine-service replay recipe in ../replay-completion-audit/qualification.md unchanged under each cell. These are same-environment restorations, not cross-ICU migration evidence.

The complete replay driver, preserved here to make this receipt self-contained:

```js
import { run } from "./packages/safe-js/src/run.ts";
import { dump } from "./packages/safe-js/src/dump.ts";
const source = `
const specs=[['Collator',{}],['DateTimeFormat',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}],['NumberFormat',{numberingSystem:'latn',useGrouping:false}],['PluralRules',{}],['Segmenter',{granularity:'word'}],['ListFormat',{style:'long'}],['RelativeTimeFormat',{numeric:'always'}],['DisplayNames',{type:'region'}],['DurationFormat',{style:'long'}]];
let reads=0;
const values=specs.map(([name,base])=>{const options={...base,get localeMatcher(){reads++;return 'lookup'}};const value=new Intl[name]('en',options);Object.defineProperty(options,'localeMatcher',{get(){throw 'options reread'}});return value});
const [c,d,n,p,s,l,r,v,u]=values;
const compare=c.compare,date=d.format,number=n.format;
const sample=()=>[compare('2','3'),date(Date.UTC(2024,2,10,7)),number(123),p.select(1),[...s.segment('Hello world!')].map(x=>[x.segment,x.index,x.isWordLike]),l.format(['Alice','Bob']),r.format(2,'day'),v.of('US'),u.format({hours:1,minutes:2})];
const before=sample(),options=values.map(x=>x.resolvedOptions()),count=reads;
await 0;
return {before,after:sample(),sameOptions:JSON.stringify(options)===JSON.stringify(values.map(x=>x.resolvedOptions())),sameReads:reads===count,reads,cached:[compare===c.compare,date===d.format,number===n.format],authority:[typeof process,typeof require,typeof fetch]};`;
const rows = [];
for (const mode of ["pending", "completed"]) {
  const promise = run(source);
  const settled = promise.catch((e) => ({ error: String(e) }));
  if (mode === "completed") await settled;
  const snapshot = JSON.parse(await dump(promise));
  const results = [await settled, await run(source, { snapshot }), await run(source, { snapshot })];
  const checks = results.map((result) => {
    const x = result.returnValue;
    return {
      execution: result.ok === true,
      stable: JSON.stringify(x?.before) === JSON.stringify(x?.after),
      options: x?.sameOptions === true,
      reads: x?.sameReads === true && x?.reads === 9,
      cached: x?.cached.every(Boolean) === true,
      authority:
        JSON.stringify(x?.authority) === JSON.stringify(["undefined", "undefined", "undefined"]),
      fields:
        x?.after[0] < 0 &&
        x?.after[2] === "123" &&
        x?.after[3] === "one" &&
        x?.after[4].map((p) => p[0]).join("") === "Hello world!" &&
        x?.after.slice(5).every((v) => typeof v === "string" && v.length > 0)
    };
  });
  rows.push({ mode, results, checks });
}
console.log(
  JSON.stringify(
    {
      versions: process.versions,
      TZ: process.env.TZ,
      source,
      rows,
      pass: rows.every((x) => x.checks.every((c) => Object.values(c).every(Boolean)))
    },
    null,
    2
  )
);
```
