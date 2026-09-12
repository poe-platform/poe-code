# Temporal extremes: reproducible qualification, repairs unresolved

This report preserves the exact manually executed probe bodies so the evidence
does not depend on untracked JSON logs or local temporary files. Run each numbered
JavaScript block on stdin from the repository root using the runtime commands in
the evidence ledger, after the maintained selected-workspace build. Inspect the
per-row assertions as well as the exit status. These are manual QA instructions,
not a new scripted QA runner. No production or maintained test source changed.

The compatibility target remains ECMA-262 edition 16 / ECMA-402 edition 12
(June 2025), Temporal extension `e8cc03fc970a65a3359e8870e3b35e687ac94e55`,
and Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

## 1. Formatting, timezone boundaries and public replay

```javascript
import { pathToFileURL } from 'node:url';
const entry = process.env.SAFEJS_TEMPORAL_ENTRY ?? pathToFileURL(process.cwd() + '/packages/safe-js/dist/index.js').href;
const { run, dump } = await import(entry);
const rows = [];
async function check(id, source, expected) {
  const result = await run(source);
  const actual = result.ok ? result.returnValue : { error: result.error };
  const observed = actual && typeof actual === 'object' && Object.hasOwn(actual,'qualified') ? actual.qualified : actual;
  rows.push({ id, source, expected, actual, pass: result.ok && JSON.stringify(observed) === JSON.stringify(expected) });
}
const types = [
  ['PlainDate', '-271821,4,19', '275760,9,13', '2000,2,29'],
  ['PlainDateTime', '-271821,4,19,0,0,0,0,0,1', '275760,9,13,23,59,59,999,999,999', '2000,2,29,12'],
  ['PlainYearMonth', '-271821,4', '275760,9', '2000,2']
];
for (const calendar of ['iso8601', 'gregory', 'buddhist']) {
  for (const [type, min, max, control] of types) {
    for (const [edge, fields] of [['min', min], ['max', max], ['control', control]]) {
      // PlainDateTime's calendar is its tenth constructor argument.
      const args = type === 'PlainDateTime' && edge === 'control' ? '2000,2,29,12,0,0,0,0,0' : fields;
      const year = edge === 'min' ? -271821 : edge === 'max' ? 275760 : 2000;
      const month = edge === 'min' ? 4 : edge === 'max' ? 9 : 2;
      const day = edge === 'min' ? 19 : edge === 'max' ? 13 : 29;
      const displayYear = calendar === 'buddhist' ? year + 543 : calendar === 'gregory' && year <= 0 ? 1 - year : year;
      for (const numberingSystem of ['latn', 'arab']) {
        const options = {calendar, numberingSystem, year:'numeric', month:'2-digit', ...(type === 'PlainYearMonth' ? {} : {day:'2-digit',weekday:'long'})};
        const digits = n => String(n).split('').map(c => numberingSystem === 'arab' && '0123456789'.includes(c) ? '٠١٢٣٤٥٦٧٨٩'[Number(c)] : c).join('');
        const expectedFields = { year: digits(displayYear), month: digits(String(month).padStart(2,'0')), ...(type === 'PlainYearMonth' ? {} : {day:digits(String(day).padStart(2,'0')),weekday:edge==='min'?'Monday':edge==='max'?'Saturday':'Tuesday'}) };
        const setup = `const v=new Temporal.${type}(${args},${JSON.stringify(calendar)}),o=${JSON.stringify(options)},f=new Intl.DateTimeFormat('en-US',o);`;
        for (const method of ['format', 'formatToParts', 'toLocaleString', 'formatRange', 'formatRangeToParts']) {
          const call = method === 'toLocaleString' ? "v.toLocaleString('en-US',o)" : method.startsWith('formatRange') ? `f.${method}(v,v)` : `f.${method}(v)`;
          const assertion = method.endsWith('Parts') ? `const p=${call};return {output:p,qualified:Object.entries(${JSON.stringify(expectedFields)}).every(([k,v])=>p.some(x=>x.type===k&&x.value===v))};` : `const s=${call};return {output:s,qualified:Object.values(${JSON.stringify(expectedFields)}).every(x=>s.includes(x))};`;
          await check(`${calendar}/${type}/${edge}/${numberingSystem}/${method}`, `${setup}try{${assertion}}catch(e){return e.name}`, true);
        }
      }
    }
  }
}
for (const [type,min,max] of types) {
  {
    await check(`cross-extremes/${type}/range-and-parts`, `const a=new Temporal.${type}(${min},'gregory'),b=new Temporal.${type}(${max},'gregory'),f=new Intl.DateTimeFormat('en-US',{calendar:'gregory'});try{const p=f.formatRangeToParts(a,b);return [p.filter(x=>x.type==='year').map(x=>[x.value,x.source]),p.map(x=>x.value).join('')===f.formatRange(a,b)]}catch(e){return e.name}`, [[['271822','startRange'],['275760','endRange']],true]);
  }
}
for (const method of ['format','formatToParts','formatRange','formatRangeToParts']) {
  for (const invalid of ['NaN','Infinity','-Infinity','8640000000000001','-8640000000000001','new Date(NaN)']) {
    await check(`numeric-rejection/${method}/${invalid}`, `const f=new Intl.DateTimeFormat('en-US');try{f.${method}(${invalid}${method.startsWith('formatRange')?',0':''});return 'accepted'}catch(e){return e.name}`, 'RangeError');
  }
  await check(`numeric-control/${method}`, `const f=new Intl.DateTimeFormat('en-US',{timeZone:'UTC'});return f.${method}(0${method.startsWith('formatRange')?',1':''})!==undefined`,true);
}
for (const zone of ['+05:30','-05:30','UTC']) {
  await check(`offset/${zone}/instant-parts`, `try{const f=new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(zone)},hour:'2-digit',minute:'2-digit',hourCycle:'h23'});return f.formatToParts(new Temporal.Instant(0n)).filter(p=>p.type==='hour'||p.type==='minute').map(p=>p.value)}catch(e){return e.name}`,zone==='+05:30'?['05','30']:zone==='-05:30'?['18','30']:['00','00']);
  for (const [type,,,control] of types) {
    await check(`offset/${zone}/${type}/locale`, `try{const v=new Temporal.${type}(${control});const o={calendar:'iso8601',year:'numeric'};return v.toLocaleString('en-US',{...o,timeZone:${JSON.stringify(zone)}})===v.toLocaleString('en-US',{...o,timeZone:'UTC'})}catch(e){return e.name}`,true);
  }
  await check(`offset/${zone}/zoned-locale`, `try{const z=new Temporal.ZonedDateTime(0n,${JSON.stringify(zone)});return z.toLocaleString('en-US',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}catch(e){return e.name}`,zone==='+05:30'?'05:30':zone==='-05:30'?'18:30':'00:00');
}
for (const reversed of [false,true]) {
  await check(`PlainTime-range/${reversed}`, `const f=new Intl.DateTimeFormat('en-US',{hour:'numeric'}),a=new Temporal.PlainTime(${reversed?13:12}),b=new Temporal.PlainTime(${reversed?12:13});try{const p=f.formatRangeToParts(a,b);return [p.filter(x=>x.type==='hour').map(x=>[x.value,x.source]),p.map(x=>x.value).join('')===f.formatRange(a,b)]}catch(e){return e.name}`,[[[reversed?'1':'12','startRange'],[reversed?'12':'1','endRange']],true]);
}
await check('calendar-mismatch', `const out=[];for(const C of [Temporal.PlainDate,Temporal.PlainDateTime,Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const v=C===Temporal.PlainMonthDay?new C(2,29,'buddhist'):C===Temporal.PlainDateTime?new C(2000,2,29,0,0,0,0,0,0,'buddhist'):C===Temporal.PlainYearMonth?new C(2000,2,'buddhist'):new C(2000,2,29,'buddhist');for(const fn of [()=>new Intl.DateTimeFormat('en-US',{calendar:'gregory'}).format(v),()=>v.toLocaleString('en-US',{calendar:'gregory'})])try{fn();out.push('accepted')}catch(e){out.push(e.name)}}return out`,Array(8).fill('RangeError'));
await check('zoned-timeZone-option', `try{new Temporal.ZonedDateTime(0n,'UTC').toLocaleString('en-US',{timeZone:'UTC'});return 'accepted'}catch(e){return e.name}`,'TypeError');
await check('zoned-direct-Intl', `try{new Intl.DateTimeFormat('en-US').format(new Temporal.ZonedDateTime(0n,'UTC'));return 'accepted'}catch(e){return e.name}`,'TypeError');
await check('skipped-civil-day', `return new Temporal.PlainDate(2011,12,30).toZonedDateTime('Pacific/Apia').toString()`,'2011-12-31T00:00:00+14:00[Pacific/Apia]');
await check('skipped-day-control', `return new Temporal.PlainDate(2011,12,29).toZonedDateTime('Pacific/Apia').toString()`,'2011-12-29T00:00:00-10:00[Pacific/Apia]');
await check('DST-gap-overlap', `return [new Temporal.PlainDateTime(2021,11,7,1,30),new Temporal.PlainDateTime(2021,3,14,2,30)].map(t=>['compatible','earlier','later','reject'].map(disambiguation=>{try{return t.toZonedDateTime('America/New_York',{disambiguation}).toInstant().toString()}catch(e){return e.name}}))`,[['2021-11-07T05:30:00Z','2021-11-07T05:30:00Z','2021-11-07T06:30:00Z','RangeError'],['2021-03-14T07:30:00Z','2021-03-14T06:30:00Z','2021-03-14T07:30:00Z','RangeError']]);
await check('authority', `return [typeof process,typeof fetch,typeof require]`,['undefined','undefined','undefined']);
// Public completed replay: all eight endpoint types, private operations after
// custom prototype replacement, no ambient host capability and three replays.
const replaySource = `const values=[new Temporal.Instant(8640000000000000000000n),new Temporal.Duration(4294967295),new Temporal.PlainTime(23,59,59,999,999,999),new Temporal.PlainDate(-271821,4,19),new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1),new Temporal.PlainYearMonth(-271821,4),new Temporal.PlainMonthDay(4,19,'iso8601',-271821),new Temporal.ZonedDateTime(8640000000000000000000n,'+23:59')];const methods=values.map(v=>v.toString);const before=values.map((v,i)=>methods[i].call(v));for(const v of values){Object.setPrototypeOf(v,{tag:'custom'});v.self=v}await 0;return values.map((v,i)=>[methods[i].call(v)===before[i],v.self===v,Object.getPrototypeOf(v).tag]);`;
let result = await run(replaySource);
const replayExpected = Array.from({length:8},()=>[true,true,'custom']);
rows.push({id:'public-replay/initial',expected:replayExpected,actual:result.returnValue,pass:result.ok&&JSON.stringify(result.returnValue)===JSON.stringify(replayExpected)});
for(let cycle=1;cycle<=3;cycle++) {
  if(!result.ok || typeof dump!=='function') {rows.push({id:`public-replay/${cycle}`,pass:false,blocker:'Prior run failed or public dump export absent'});continue}
  result=await run(replaySource,{snapshot:JSON.parse(await dump(result))});
  rows.push({id:`public-replay/${cycle}`,expected:replayExpected,actual:result.returnValue,pass:result.ok&&JSON.stringify(result.returnValue)===JSON.stringify(replayExpected)});
}
console.log(JSON.stringify({entry,versions:process.versions,rows,passed:rows.filter(r=>r.pass).length,failed:rows.filter(r=>!r.pass).length},null,2));
process.exitCode=rows.some(r=>!r.pass)?1:0;
```

## 2. Upper arithmetic boundaries and explicit host admission

```javascript
import {run} from './packages/safe-js/dist/index.js';
import {Temporal as Backend,Intl as BackendIntl} from 'temporal-polyfill/full/implementation';
const rows=[];
async function check(id,source,expected,bindings) {
  try {const r=await run(source,{bindings});rows.push({id,source,expected,actual:r.ok?r.returnValue:r.error,pass:r.ok&&JSON.stringify(r.returnValue)===JSON.stringify(expected)})}
  catch(e){rows.push({id,source,expected,actual:{name:e.name,message:e.message},pass:false})}
}
const checks=[
 ['Instant-upper-round',`return new Temporal.Instant(8640000000000000000000n).round('hour').epochNanoseconds.toString()`,'8640000000000000000000'],
 ['Instant-upper-overflow',`try{new Temporal.Instant(8640000000000000000000n).add({nanoseconds:1});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['Duration-upper-round',`return new Temporal.Duration(0,0,0,0,0,0,9007199254740991).round({smallestUnit:'second',largestUnit:'second'}).seconds`,9007199254740991],
 ['Duration-upper-overflow',`try{new Temporal.Duration(0,0,0,0,0,0,9007199254740991,999,999,999).round({smallestUnit:'second',roundingMode:'ceil'});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['PlainTime-upper-round',`return new Temporal.PlainTime(23,59,59,999,999,999).round('second').toString()`,'00:00:00'],
 ['PlainTime-overflow',`return [Temporal.PlainTime.from({hour:24}).hour,(()=>{try{Temporal.PlainTime.from({hour:24},{overflow:'reject'});return 'accepted'}catch(e){return e.name}})()]`,[23,'RangeError']],
 ['PlainDate-upper-control',`return new Temporal.PlainDate(275760,9,13).subtract({days:1}).toString()`,'+275760-09-12'],
 ['PlainDate-upper-overflow',`try{new Temporal.PlainDate(275760,9,13).add({days:1});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['PlainDate-rounded-difference',`return new Temporal.PlainDate(275760,9,12).until(new Temporal.PlainDate(275760,9,13),{smallestUnit:'day',roundingIncrement:2,roundingMode:'floor'}).days`,0],
 ['PlainDateTime-upper-round',`return new Temporal.PlainDateTime(275760,9,13,23,59,59,999,999,999).round({smallestUnit:'second',roundingMode:'floor'}).toString()`,'+275760-09-13T23:59:59'],
 ['PlainDateTime-upper-overflow',`try{new Temporal.PlainDateTime(275760,9,13,23,59,59,999,999,999).round({smallestUnit:'second',roundingMode:'ceil'});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['PlainYearMonth-upper-control',`return new Temporal.PlainYearMonth(275760,9).subtract({months:1}).toString()`,'+275760-08'],
 ['PlainYearMonth-upper-overflow',`try{new Temporal.PlainYearMonth(275760,9).add({months:1});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['PlainYearMonth-rounded-difference',`try{new Temporal.PlainYearMonth(275760,8).until(new Temporal.PlainYearMonth(275760,9),{smallestUnit:'year',roundingMode:'floor'});return 'accepted'}catch(e){return e.name}`,'RangeError'],
 ['PlainYearMonth-rounding-neighbor',`return new Temporal.PlainYearMonth(275759,8).until(new Temporal.PlainYearMonth(275759,9),{smallestUnit:'year',roundingMode:'floor'}).years`,0],
 ['PlainMonthDay-overflow',`return [Temporal.PlainMonthDay.from({month:2,day:30}).toString(),(()=>{try{Temporal.PlainMonthDay.from({month:2,day:30},{overflow:'reject'});return 'accepted'}catch(e){return e.name}})()]`,['02-29','RangeError']],
 ['PlainMonthDay-reference-endpoint',`return Temporal.PlainMonthDay.prototype.toString.call(new Temporal.PlainMonthDay(9,13,'gregory',275760),{calendarName:'always'})`,'+275760-09-13[u-ca=gregory]'],
 ['ZonedDateTime-upper-round',`return new Temporal.ZonedDateTime(8640000000000000000000n,'UTC').round('hour').epochNanoseconds.toString()`,'8640000000000000000000'],
 ['ZonedDateTime-upper-overflow',`try{new Temporal.ZonedDateTime(8640000000000000000000n,'UTC').add({nanoseconds:1});return 'accepted'}catch(e){return e.name}`,'RangeError']
];
for(const [id,source,expected] of checks)await check(id,source,expected);
const hostCases=[['Instant',[8640000000000000000000n]],['Duration',[4294967295]],['PlainTime',[23,59,59,999,999,999]],['PlainDate',[-271821,4,19,'gregory']],['PlainDateTime',[-271821,4,19,0,0,0,0,0,1,'gregory']],['PlainYearMonth',[-271821,4,'gregory',1]],['PlainMonthDay',[4,19,'gregory',-271821]],['ZonedDateTime',[8640000000000000000000n,'+23:59']]];
for(const [provider,T] of [['backend',Backend],['native',globalThis.Temporal]]) {
  if(!T){rows.push({id:`host/${provider}`,unexecuted:16,blocker:'Native Temporal unavailable; backend admission tested separately'});continue}
  for(const [name,args] of hostCases){
    const value=new T[name](...args), expected=T[name].prototype.toString.call(value);
    await check(`host/${provider}/${name}`,`return [input instanceof Temporal.${name},Temporal.${name}.prototype.toString.call(input)]`,[true,expected],{input:value});
    class Foreign extends T[name] {}
    try{const r=await run('return input',{bindings:{input:new Foreign(...args)}});rows.push({id:`foreign-subclass/${provider}/${name}`,pass:!r.ok,actual:r.ok?'accepted':r.error,expected:'host import rejection'})}
    catch(e){rows.push({id:`foreign-subclass/${provider}/${name}`,pass:e instanceof TypeError,actual:{name:e.name,message:e.message},expected:'TypeError'})}
  }
}
const controls=[];
for(const [provider,T,I] of [['backend',Backend,BackendIntl],['native',globalThis.Temporal,Intl]]) {
  if(!T){controls.push({provider,unexecuted:true,reason:'native Temporal unavailable'});continue}
  for(const [name,args] of hostCases.filter(([name])=>['PlainDate','PlainDateTime','PlainYearMonth'].includes(name))) {
    for(const method of ['format','formatToParts','formatRange','formatRangeToParts','toLocaleString']){
      try{const value=new T[name](...args),f=new I.DateTimeFormat('en-US',{calendar:'gregory'});controls.push({provider,name,method,actual:method==='toLocaleString'?value.toLocaleString('en-US',{calendar:'gregory'}):method.startsWith('formatRange')?f[method](value,value):f[method](value)})}
      catch(e){controls.push({provider,name,method,error:{name:e.name,message:e.message}})}
    }
  }
}
console.log(JSON.stringify({versions:process.versions,rows,controls,passed:rows.filter(r=>r.pass===true).length,failed:rows.filter(r=>r.pass===false).length,unexecuted:rows.filter(r=>r.unexecuted).reduce((n,r)=>n+r.unexecuted,0)},(_,v)=>typeof v==='bigint'?v.toString():v,2));
process.exitCode=rows.some(r=>r.pass===false)?1:0;
```

## 3. Lower arithmetic boundaries

```javascript
import {run} from './packages/safe-js/dist/index.js';
const checks = [
 ['Instant/min-round', `return new Temporal.Instant(-8640000000000000000000n).round('hour').epochNanoseconds.toString()`, '-8640000000000000000000'],
 ['Instant/underflow', `new Temporal.Instant(-8640000000000000000000n).subtract({nanoseconds:1})`, 'RangeError'],
 ['Instant/neighbor', `return new Temporal.Instant(-8640000000000000000000n).add({nanoseconds:1}).epochNanoseconds.toString()`, '-8639999999999999999999'],
 ['Duration/min-round', `return new Temporal.Duration(0,0,0,0,0,0,-9007199254740991).round({smallestUnit:'second',largestUnit:'second'}).seconds`, -9007199254740991],
 ['Duration/underflow', `new Temporal.Duration(0,0,0,0,0,0,-9007199254740991,-999,-999,-999).round({smallestUnit:'second',roundingMode:'floor'})`, 'RangeError'],
 ['Duration/neighbor', `return new Temporal.Duration(0,0,0,0,0,0,-9007199254740991,-999,-999,-999).round({smallestUnit:'second',largestUnit:'second',roundingMode:'ceil'}).seconds`, -9007199254740991],
 ['PlainTime/min-round', `return new Temporal.PlainTime(0,0,0,0,0,1).round({smallestUnit:'second',roundingMode:'floor'}).toString()`, '00:00:00'],
 ['PlainTime/wrap', `return new Temporal.PlainTime().subtract({nanoseconds:1}).toString()`, '23:59:59.999999999'],
 ['PlainTime/reject', `Temporal.PlainTime.from({hour:-1},{overflow:'reject'})`, 'RangeError'],
 ['PlainDate/underflow', `new Temporal.PlainDate(-271821,4,19).subtract({days:1})`, 'RangeError'],
 ['PlainDate/neighbor', `return new Temporal.PlainDate(-271821,4,19).add({days:1}).toString()`, '-271821-04-20'],
 ['PlainDate/rounded-difference', `return new Temporal.PlainDate(-271821,4,20).until(new Temporal.PlainDate(-271821,4,19),{smallestUnit:'day',roundingIncrement:2,roundingMode:'ceil'}).days`, 0],
 ['PlainDateTime/underflow', `new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1).subtract({nanoseconds:1})`, 'RangeError'],
 ['PlainDateTime/round-underflow', `new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1).round({smallestUnit:'second',roundingMode:'floor'})`, 'RangeError'],
 ['PlainDateTime/round-neighbor', `return new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1).round({smallestUnit:'second',roundingMode:'ceil'}).toString()`, '-271821-04-19T00:00:01'],
 ['PlainYearMonth/underflow', `new Temporal.PlainYearMonth(-271821,4).subtract({months:1})`, 'RangeError'],
 ['PlainYearMonth/min-intermediate-rejection', `return new Temporal.PlainYearMonth(-271821,4).add({months:1}).toString()`, 'RangeError'],
 ['PlainYearMonth/neighbor', `return new Temporal.PlainYearMonth(-271821,5).add({months:1}).toString()`, '-271821-06'],
 ['PlainYearMonth/rounded-difference', `return new Temporal.PlainYearMonth(-271820,5).until(new Temporal.PlainYearMonth(-271820,4),{smallestUnit:'year',roundingMode:'ceil'}).years`, 0],
 ['PlainMonthDay/min-reference', `return new Temporal.PlainMonthDay(4,19,'gregory',-271821).toString({calendarName:'always'})`, '-271821-04-19[u-ca=gregory]'],
 ['PlainMonthDay/underflow', `new Temporal.PlainMonthDay(4,18,'gregory',-271821)`, 'RangeError'],
 ['PlainMonthDay/reject', `Temporal.PlainMonthDay.from({month:1,day:0},{overflow:'reject'})`, 'RangeError'],
 ['ZonedDateTime/min-round', `return new Temporal.ZonedDateTime(-8640000000000000000000n,'UTC').round('hour').epochNanoseconds.toString()`, '-8640000000000000000000'],
 ['ZonedDateTime/underflow', `new Temporal.ZonedDateTime(-8640000000000000000000n,'-23:59').subtract({nanoseconds:1})`, 'RangeError'],
 ['ZonedDateTime/neighbor', `return new Temporal.ZonedDateTime(-8640000000000000000000n,'-23:59').add({nanoseconds:1}).epochNanoseconds.toString()`, '-8639999999999999999999']
];
const rows=[];
for (const [id,body,expected] of checks) {
 const source=`try{${body}}catch(e){return e.name}`;
 const result=await run(source),actual=result.ok?result.returnValue:result.error;
 rows.push({id,source,expected,actual,pass:result.ok&&Object.is(actual,expected)});
}
console.log(JSON.stringify({versions:process.versions,rows,passed:rows.filter(r=>r.pass).length,failed:rows.filter(r=>!r.pass).length},null,2));
process.exitCode=rows.some(r=>!r.pass)?1:0;
```

## 4. Custom prototypes, private fields, errors and checkpoint replay

```javascript
import {run,dump} from './packages/safe-js/dist/index.js';
const rows=[];
const cases=[
 ['PlainDate',[-271821,4,19],-271821,4,19,'Monday'],
 ['PlainDate',[275760,9,13],275760,9,13,'Saturday'],
 ['PlainDateTime',[-271821,4,19,0,0,0,0,0,1],-271821,4,19,'Monday'],
 ['PlainDateTime',[275760,9,13,23,59,59,999,999,999],275760,9,13,'Saturday'],
 ['PlainYearMonth',[-271821,4],-271821,4],
 ['PlainYearMonth',[275760,9],275760,9]
];
for(const [type,args,year,month,day,weekday] of cases)for(const calendar of ['iso8601','gregory','buddhist'])for(const numberingSystem of ['latn','arab']){
 const digits=n=>String(n).split('').map(c=>numberingSystem==='arab'&&'0123456789'.includes(c)?'٠١٢٣٤٥٦٧٨٩'[Number(c)]:c).join('');
 const displayYear=calendar==='buddhist'?year+543:calendar==='gregory'&&year<=0?1-year:year;
 const fields={year:digits(displayYear),month:digits(String(month).padStart(2,'0')),...(day?{day:digits(String(day).padStart(2,'0')),weekday}:{})};
 const options={calendar,numberingSystem,year:'numeric',month:'2-digit',...(day?{day:'2-digit',weekday:'long'}:{})};
 const source=`const v=new Temporal.${type}(${[...args,calendar].map(x=>JSON.stringify(x)).join(',')});
 const f=new Intl.DateTimeFormat('en-US',${JSON.stringify(options)}),locale=v.toLocaleString,format=f.format;
 for(const key of ['year','month','day','calendarId','valueOf','toString'])Object.defineProperty(v,key,{get(){throw 'public getter'}});
 Object.setPrototypeOf(v,{marker:'private-fields'});v.self=v;
 await checkpoint();
 const rows=[];for(const method of ['format','formatToParts','formatRange','formatRangeToParts','toLocaleString']){
  try{const output=method==='toLocaleString'?locale.call(v,'en-US',${JSON.stringify(options)}):method==='format'?format(v):method.startsWith('formatRange')?f[method](v,v):f[method](v);
   const expected=${JSON.stringify(fields)};
   rows.push({method,output,pass:typeof output==='string'?Object.values(expected).every(x=>output.includes(x)):Object.entries(expected).every(([k,x])=>output.some(p=>p.type===k&&p.value===x))});
  }catch(e){rows.push({method,pass:false,error:e.name,owned:e instanceof RangeError&&Object.getPrototypeOf(e)===RangeError.prototype})}
 }
 return {rows,privateState:v.self===v&&Object.getPrototypeOf(v).marker==='private-fields',authority:[typeof process,typeof fetch,typeof require]};`;
 let calls=0;
 const checkpoint=async()=>{calls++;};
 let result=await run(source,{bindings:{checkpoint}}),original=result.returnValue;
 for(let cycle=0;cycle<=3;cycle++){
  const actual=result.ok?result.returnValue:{error:result.error};
  rows.push({id:`${type}/${year}/${calendar}/${numberingSystem}/${cycle}`,source,cycle,expectedFields:fields,actual,formatPassed:actual.rows?.filter(r=>r.pass).length??0,formatFailed:actual.rows?.filter(r=>!r.pass).length??5,transportPassed:result.ok&&actual.privateState&&JSON.stringify(actual.authority)===JSON.stringify(['undefined','undefined','undefined'])&&JSON.stringify(actual)===JSON.stringify(original)&&calls===1,errorOwnershipPassed:result.ok&&actual.rows.every(r=>r.pass||r.owned===true),hostCalls:calls});
  if(cycle<3){if(!result.ok)break;result=await run(source,{bindings:{checkpoint},snapshot:JSON.parse(await dump(result))})}
 }
}
for(const method of ['format','formatToParts','formatRange','formatRangeToParts'])for(const value of ['NaN','Infinity','-Infinity','8640000000000001','-8640000000000001','new Date(NaN)']){
 const source=`const f=new Intl.DateTimeFormat('en-US');try{f.${method}(${value}${method.startsWith('formatRange')?',0':''});return false}catch(e){return e instanceof RangeError&&Object.getPrototypeOf(e)===RangeError.prototype}`;
 const r=await run(source);rows.push({id:`negative/${method}/${value}`,source,actual:r.ok?r.returnValue:r.error,negativePassed:r.ok&&r.returnValue===true});
}
const summary={formatPassed:rows.reduce((n,r)=>n+(r.formatPassed??0),0),formatFailed:rows.reduce((n,r)=>n+(r.formatFailed??0),0),transportPassed:rows.filter(r=>r.transportPassed===true).length,transportFailed:rows.filter(r=>r.transportPassed===false).length,errorOwnershipPassed:rows.filter(r=>r.errorOwnershipPassed===true).length,errorOwnershipFailed:rows.filter(r=>r.errorOwnershipPassed===false).length,negativePassed:rows.filter(r=>r.negativePassed===true).length,negativeFailed:rows.filter(r=>r.negativePassed===false).length};
console.log(JSON.stringify({versions:process.versions,summary,rows},null,2));
process.exitCode=summary.formatFailed||summary.transportFailed||summary.errorOwnershipFailed||summary.negativeFailed?1:0;
```

## Interpretation and limits

A failed formatting call is not successful formatting even when its exception
belongs to the correct realm and is stable over replay. Block 4 counts repeated
operations, not distinct programs. Its explicit host checkpoint must run once;
no ambient process, fetch or require authority is granted.

Block 2 executes backend admission separately from native admission. Native
Temporal is absent on the tested runtimes other than Node 26: sixteen native
admission assertions per such runtime remain explicitly unexecuted. The absence
is not a guest ECMAScript defect or permission to import arbitrary host objects.

PlainMonthDay has no rounding API in the pinned extension. Its actual overflow
and reference-date operations are exercised. PlainDate/PlainYearMonth rounding
is exercised through differences. Minimum PlainYearMonth arithmetic may reject
an intermediate day-1 date outside the legal PlainDate range; that required
rejection is not evidence that the YearMonth constructor range should shrink.

The profiles cover ISO, Gregorian and Buddhist calendars and Latin/Arabic
numbering. Other calendar/locale combinations remain unqualified. The known
no-TimeClip failures still block a general formatter repair. A Gregorian
substitution, clamped date or swapped range fields has not been qualified and
is not installed. The pinned extension prepares plain Temporal epoch nanoseconds
without TimeClip; numeric-Date inputs retain TimeClip validation.

The existing 32-case heap transport suite was rerun separately. It exercises all
eight types through three host/heap/replay cycles, both endpoint directions,
private slots, aliasing, receiving-realm prototypes, custom prototypes, frozen
objects and intentional raw prototype-linked replay refusal. That pre-existing
untracked test file is preserved rather than included in this documentation
commit. Node 26 also ran the four maintained native-Instant tests.

## CLI and Workerd controls

The CLI probe was executed from the pre-existing
`docs/plans/repair-temporal-extremes/replay-boundary-audit/cli-boundary.md`:

```javascript
const value = new Temporal.PlainDate(-271821, 4, 19, 'gregory');
const formatter = new Intl.DateTimeFormat('en-US', {calendar:'gregory',year:'numeric',month:'numeric',day:'numeric',weekday:'long'});
const parts = formatter.formatToParts(value);
if (!parts.some(p => p.type === 'year' && p.value === '271822')) throw 'year';
if (!parts.some(p => p.type === 'weekday' && p.value === 'Monday')) throw 'weekday';
return parts;
```

Save this block alone in a Markdown harness before using the CLI. The exact
executed commands were:

```sh
node packages/safe-js/dist/cli.js docs/plans/repair-temporal-extremes/replay-boundary-audit/cli-boundary.md
node packages/safe-js/dist/cli.js --max-steps 1 docs/plans/repair-temporal-extremes/replay-boundary-audit/cli-boundary.md
```

The semantic probe fails before field assertions with `Invalid time value`,
exit 1. The independent budget negative passes with exit 3 and
`Sandbox budget exceeded for steps: 2 > 1.` Neither result is an endpoint
formatting pass. No visible CLI change was made; no screenshot check is claimed.

The fresh Workerd integration probe ran on Node 22.23.2 with `node
--input-type=module` and this stdin:

```javascript
import {build} from 'esbuild'; await build({entryPoints:['packages/safe-js/dist/workerd.js'],bundle:true,platform:'neutral',format:'esm',conditions:['workerd'],external:['node:*'],write:false});
```

It exits 1 resolving `#safe-fs-native-seek` from
`packages/safe-fs/dist/node/native-seek.js`. Workerd guest execution, ICU and
replay remain unexecuted. No unresolved-import exclusion or host capability
grant was added. This is an integration blocker, not proof of a guest language
defect. Core's lack of a public `dump` export remains an intentional integration
capability boundary; no new core replay qualification is claimed.
