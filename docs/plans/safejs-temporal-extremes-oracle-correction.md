# Temporal extreme-range display-year oracle correction

Source: `09ffdf243ee391fd4ad19dbb547136692bb47b6e`, 2026-09-12.
This corrects the manual QA's expected display year, not production formatting.
The historical report and matrix hashes remain historical observations.

The target remains ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025),
Temporal `e8cc03fc970a65a3359e8870e3b35e687ac94e55`, and Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

## Reproduction and normative rule

The pinned Temporal `spec/intl.html`, `FormatDateTimePattern`, explicitly applies
`v = 1 - v` when the formatted field is year and its value is nonpositive.
This rule is not conditional on the calendar identifier being `gregory`.
The old manual probes applied the transformation only to Gregorian years and
incorrectly expected a signed negative year for ISO at the lower endpoint.

Run `node --input-type=module` from the repository root with:

```javascript
import {run} from './packages/safe-js/dist/index.js';
const result = await run(`const d=new Temporal.PlainDate(-1,4,19);const f=new Intl.DateTimeFormat('en-US',{calendar:'iso8601',year:'numeric'});return f.formatToParts(d).find(p=>p.type==='year').value`);
console.log(JSON.stringify({versions:process.versions,result:result.ok?result.returnValue:result.error,oldExpectation:'-1',correctExpectation:'2'}));
if(!result.ok || result.returnValue!=='2') process.exitCode=1;
```

The concrete in-range control distinguishes the two expectations without the
endpoint's earlier TimeClip exception hiding the incorrect expected value.

## Corrected manual execution

Use blocks 1 and 4 of
[the historical reproduction report](safejs-temporal-extremes-reproduction-2026-09-12.md),
changing only their display-year calculation. In block 1 replace:

```javascript
const displayYear = calendar === 'buddhist' ? year + 543 : calendar === 'gregory' && year <= 0 ? 1 - year : year;
```

with:

```javascript
const calendarYear = calendar === 'buddhist' ? year + 543 : year;
const displayYear = calendarYear <= 0 ? 1 - calendarYear : calendarYear;
```

In block 4 replace its compact equivalent:

```javascript
const displayYear=calendar==='buddhist'?year+543:calendar==='gregory'&&year<=0?1-year:year;
```

with:

```javascript
const calendarYear=calendar==='buddhist'?year+543:year;
const displayYear=calendarYear<=0?1-calendarYear:calendarYear;
```

All field, weekday, numbering-system, range, error-ownership, authority and replay
assertions remain. No case is removed and no exception becomes a formatting pass.
For non-ISO dates these expectations retain the Temporal calendar-field model;
native calendar-profile differences do not redefine that model or authorize
substituting another calendar.

Supply each corrected block on stdin to the same seven runtime commands in the
ledger. The correction matrix records the new stdin hashes and exact results
separately. Blocks 2 and 3 are unchanged and retain their preceding executed
hashes/results. The production source is unchanged.

## Additional calendar limitations

A proposed 400-year Gregorian-cycle surrogate is also unqualified for general
calendar formatting. On Node22.23.2 / ICU78.2, execute:

```javascript
import {Temporal,Intl as I} from 'temporal-polyfill/full/implementation';
for(const c of ['iso8601','gregory','buddhist']){
 const f=new I.DateTimeFormat('en-US',{calendar:c,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'});
 console.log(c,f.formatToParts(new Temporal.PlainDate(-271421,4,19,c)));
}
```

The diagnostic exits0. ISO/Gregorian produce year271422, month04, day19;
Buddhist produces year-270873, month11, day16. This does not qualify a general
calendar-preserving surrogate. The Buddhist field/profile inconsistency needs
its own normative reconciliation; native output is not adopted as the expected
Temporal calendar fields. The Chinese lower-endpoint getter observation in the
delivery receipt likewise remains explicitly unqualified. Neither observation
is hidden by narrowing the legal Temporal range or changing calendars.

The getter observation is reproducible on Node22 with this separate stdin:

```javascript
import {run} from './packages/safe-js/dist/index.js';
for(const calendar of ['iso8601','gregory','buddhist','japanese','hebrew','chinese']) {
 const r=await run(`const v=new Temporal.PlainDate(-271821,4,19,'${calendar}');return ['year','month','day','dayOfWeek','era','eraYear'].map(k=>{try{return [k,v[k]]}catch(e){return [k,e.name]}})`);
 console.log(calendar,JSON.stringify(r.ok?r.returnValue:r.error));
}
```

It exits0 and reports RangeError for Chinese year/month/day, weekday1 and
undefined era fields. The other five calendars return values for those getters.
The pinned `NonISOCalendarISOToDate` operation declares a Calendar Date Record
result with implementation-defined calendar processing. Expected Chinese
endpoint fields and an all-runtime getter matrix remain an explicit unresolved
qualification blocker; no narrower legal range or alternate calendar is accepted.
