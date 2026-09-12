# Temporal range workaround qualification

Source: `625e55213c83fb37adc46fa456c4d63c9e64974e`, 2026-09-12.
No production candidate was accepted. This report adds concrete counterexamples
to the previously unresolved reversed-PlainTime workaround, not a repair claim.

The target remains ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025),
Temporal `e8cc03fc970a65a3359e8870e3b35e687ac94e55`, and Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`.
The pinned Temporal Intl source was freshly retrieved with:

```sh
curl -fsSL https://raw.githubusercontent.com/tc39/proposal-temporal/e8cc03fc970a65a3359e8870e3b35e687ac94e55/spec/intl.html -o /tmp/repair-temporal-pinned-intl.html
```

`PartitionDateTimeRangePattern` compares relevant fields, selects a range
pattern, and formats its source-labelled pattern parts. It does not reject
descending inputs. `HandleDateTimeTemporalTime` retains a time-only pattern.
Native output is a locale-profile comparator, not a replacement specification.

## Rejected next-day substitution

Run with `/Users/kjopek/.nvm/versions/node/v18.18.0/bin/node --input-type=module`
and this stdin:

```javascript
for (const locale of ['en-US', 'pl-PL', 'ar', 'ja', 'zh-CN']) {
  const f = new Intl.DateTimeFormat(locale, {hour:'numeric', timeZone:'UTC'});
  console.log(locale, f.formatRangeToParts(13 * 3600000, 36 * 3600000));
}
```

Node 18.18.0 / ICU 73.2 exits 0, but all five outputs contain year, month and
day fields. The English output includes January 1 and January 2, 1970. Moving
12:00 to the following day therefore does not preserve the requested PlainTime
pattern. Removing those fields afterward would require recovering punctuation,
range collapse and source ownership; no such recovery was qualified.

## Rejected forward-field substitution

Run with `/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node --input-type=module`
and this stdin:

```javascript
const locales = ['en-US','en-GB','pl-PL','ar','ja','zh-CN','fr','de','fi','ko','hi','th','fa','he','ru'];
const options = [
  {hour:'numeric'}, {hour:'2-digit',minute:'numeric'}, {minute:'numeric'},
  {minute:'2-digit',second:'numeric'}, {second:'numeric',fractionalSecondDigits:3},
  {dayPeriod:'long',hour:'numeric'}, {hour:'numeric',minute:'numeric',second:'numeric'},
  {timeStyle:'short'}, {timeStyle:'full'}
];
let total = 0, failed = 0;
const examples = [];
for (const locale of locales) for (const option of options) {
  for (const hourCycle of ['h11','h12','h23','h24']) {
    const f = new Intl.DateTimeFormat(locale, {...option,hourCycle,timeZone:'UTC'});
    for (const [a,b] of [[13*3600000,12*3600000],[13*3600000,3600000],
      [23*3600000+59876,4567],[3600000+4000,3600000+3000],
      [2*3600000+60000,3600000+120000]]) {
      const forward = f.formatRangeToParts(b,a);
      const swapped = forward.map(part => part.type === 'literal' || part.source === 'shared'
        ? part : {...part, value:forward.find(other => other.type === part.type &&
          other.source === (part.source === 'startRange' ? 'endRange' : 'startRange'))?.value ?? part.value});
      const actual = f.formatRangeToParts(a,b);
      total++;
      if (JSON.stringify(swapped) !== JSON.stringify(actual)) {
        failed++;
        if (examples.length < 8) examples.push({locale,option,hourCycle,a,b,swapped,actual});
      }
    }
  }
}
console.log(JSON.stringify({total,failed,examples},null,2));
```

Node 22.23.2 / ICU 78.2: **2,700 comparisons, 26 mismatches**, exit 0.
The snippet reports diagnostics; its exit status is not a passing assertion.
For English 13:00 to 12:00, long dayPeriod and h12, swapping the forward range
retains shared `in the afternoon`; the native descending range has shared
`noon`. Polish and Arabic also expose shared day-period differences.

These mismatches reject the proposed native-equivalence assumption. They are
not 26 newly proven ECMAScript defects. In particular, the pinned algorithm's
day-period comparison and its rule for formatting shared parts still need an
independent normative oracle before either native result can be adopted as a
regression expectation. Merely changing the numeric hour values is insufficient.

## Remaining implementation work

- Legal endpoints still require calendar-preserving formatting outside numeric
  TimeClip, across parts, ranges and all three plain-type locale entry paths.
  A 400-year surrogate plus Gregorian year replacement would not qualify other
  calendars or arbitrary cross-extreme range patterns.
- Old-runtime fixed-offset support still requires the requested offset's civil
  fields, names and resolved options. Substituting a named zone or shifting a
  clipped numeric date has not qualified that contract at the extremes.
- Reversed PlainTime still requires correct interval selection and source-labelled
  parts on Node 18. Neither experiment above supplies that implementation.
- Workerd still fails bundle resolution at `#safe-fs-native-seek`; no authority
  alias was introduced. Core replay is unavailable through its public API by
  design, not an ECMAScript defect.

No range was clamped, calendar replaced, runtime dropped, assertion weakened,
budget relaxed or timeout changed. Production files and the pre-existing
untracked regression tests were not edited. There is no TDD repair to report.
The full case dispositions and delivery receipts belong in
[the evidence ledger](safejs-gap-closure-evidence.md).

## Installed-artifact smoke

From the existing `/tmp/safejs-iso-installed.YSS7Mk` installation, run
`/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node --input-type=module`
with this stdin. This reuses independently installed scoped and umbrella
artifacts; it does not rebuild them from the workspace.

```javascript
import {readFile} from 'node:fs/promises';
const rows=[];
for(const entry of ['@poe-platform/safe-js','@poe-platform/safe-js/core','poe-code/safejs','poe-code/safejs/core']){
 const api=await import(entry);
 const source=`const f=new Intl.DateTimeFormat('en-US',{calendar:'gregory'}); const value=new Temporal.PlainDate(-271821,4,19,'gregory'); let extreme;try{extreme=f.format(value)}catch(e){extreme=e.name}let invalid;try{f.format(8640000000000001)}catch(e){invalid=e.name}const time=new Temporal.PlainTime(23,59,59);const method=time.toString;Object.setPrototypeOf(time,{tag:'owned'});time.self=time;await 0;return [extreme,invalid,method.call(time),time.self===time,Object.getPrototypeOf(time).tag,typeof process,typeof fetch];`;
 let result=await api.run(source);const runs=[{ok:result.ok,value:result.returnValue,error:result.error}];
 if(api.dump) for(let cycle=0;cycle<3;cycle++){result=await api.run(source,{snapshot:JSON.parse(await api.dump(result))});runs.push({ok:result.ok,value:result.returnValue,error:result.error})}
 rows.push({entry,rangeRepair:runs.every(r=>r.ok&&r.value?.[0]!=='RangeError'),controls:runs.every(r=>r.ok&&JSON.stringify(r.value?.slice(1))===JSON.stringify(['RangeError','23:59:59',true,'owned','undefined','undefined'])),replay:api.dump?'three completed cycles':'unavailable in core API by design',runs});
}
console.log(JSON.stringify({versions:process.versions,packages:await Promise.all(['@poe-platform/safe-js','poe-code'].map(async n=>{const p=JSON.parse(await readFile(`node_modules/${n}/package.json`));return {name:p.name,version:p.version}})),rows},null,2));
process.exitCode=rows.some(r=>!r.rangeRepair||!r.controls)?1:0;
```

Result: exit1; every entry reports `rangeRepair:false`, `controls:true`.
The SDKs execute the original plus three completed replays. Core executes the
original only and reports its public replay API boundary. Node22 / ICU78.2;
safe-js0.1.563 and poe-code15.0.28. The archived smoke is not an endpoint pass,
and it does not cover untested installed-artifact arithmetic or runtime profiles.
