import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { formatDateLocale } from "../date-locale.js";
import { runInNewContext } from "node:vm";

const methods = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"];

it.each(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"])(
  "formats dates with %s and an explicit locale/time zone", async method => {
    const source = `return new Date(0).${method}('en-US',{timeZone:'UTC'});`;
    expect((await run(source)).returnValue).toBe(new Function(source)());
  }
);

it.each(methods)("handles invalid dates before inspecting %s arguments", async method => {
  const source = `return new Date(NaN).${method}({get length(){throw 42}},null);`;
  expect((await run(source)).returnValue).toBe("Invalid Date");
});

it.each(methods)("checks the %s receiver before argument getters", async method => {
  const source = `let error;try{Date.prototype.${method}.call({}, {get length(){throw 42}})}catch(caught){error=caught instanceof TypeError}return error;`;
  expect((await run(source)).returnValue).toBe(true);
});

it.each([
  "return new Date(7).toLocaleString(['de-DE','en-US'],{timeZone:'UTC',dateStyle:'full',timeStyle:'long'});",
  "return new Date(7).toLocaleDateString('ja-JP-u-ca-japanese',{timeZone:'UTC',dateStyle:'full'});",
  "return new Date(7).toLocaleTimeString('en-US',{timeZone:'UTC',fractionalSecondDigits:3,hour12:false});",
  "return new Date(7).toLocaleString('ar-EG',{timeZone:'UTC',numberingSystem:'latn',calendar:'gregory'});",
  "return new Date(7).toLocaleTimeString('en-US',{timeZone:'America/New_York',hourCycle:'h23',timeZoneName:'short'});",
  "return new Date(7).toLocaleDateString('en-US',{timeZone:'UTC',hour:'numeric'});",
  "return new Date(7).toLocaleTimeString('en-US',{timeZone:'UTC',year:'numeric'});",
  "return new Date(7).toLocaleString('en-US',Object.create({timeZone:'UTC',year:'numeric'}));",
  "return new Date(7).toLocaleString(Object.assign(Object.create({0:'en-US'}),{length:2,1:'en-us'}),{timeZone:'UTC'});",
  "return new Date(7).toLocaleString([,'en-US'],{timeZone:'UTC'});",
  "return new Date(0).toLocaleString('en-US',{timeZone:'+01:30'});",
  "return new Date(0).toLocaleString('en-US',{timeZone:'UTC',hour12:{valueOf(){throw 42}}});",
  "return new Date(0).toLocaleString('en-US',{timeZone:'UTC',fractionalSecondDigits:1.9});",
  "return new Date(0).toLocaleString([{toString(){return 'en-US'}}],{timeZone:'UTC'},Object.create({ignored:true}));",
  "class Child extends Date{}return new Child(7).toLocaleString('en-US',{timeZone:'UTC'});",
  "return [Date.prototype.toLocaleString.length,Date.prototype.toLocaleDateString.name,Object.getOwnPropertyDescriptor(Date.prototype,'toLocaleTimeString').enumerable];"
])("matches native locale output: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["localeMatcher", "calendar", "numberingSystem", "hourCycle", "timeZone", "year", "fractionalSecondDigits", "formatMatcher", "dateStyle"])(
  "preserves exceptions from %s getter execution", async key => {
    const source = `const token={};let caught;try{new Date(0).toLocaleString('en-US',{get ${key}(){throw token}})}catch(error){caught=error===token}return caught;`;
    expect((await run(source)).returnValue).toBe(true);
  }
);

it("reads every formatting option exactly once in the specified order", async () => {
  const keys = ["localeMatcher", "calendar", "numberingSystem", "hour12", "hourCycle", "timeZone", "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName", "formatMatcher", "dateStyle", "timeStyle"];
  const source = `const log=[];const options={};for(const key of ${JSON.stringify(keys)})Object.defineProperty(options,key,{get(){log.push(key);return key==='timeZone'?'UTC':undefined}});new Date(0).toLocaleString('en-US',options);return log;`;
  expect((await run(source)).returnValue).toEqual(keys);
});

it("boxes primitive options using the guest realm's prototype", async () => {
  const source = "Object.defineProperty(Number.prototype,'timeZone',{get(){return 'UTC'}});Number.prototype.year='numeric';return new Date(0).toLocaleString('en-US',1);";
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it("bounds the formatted output length", async () => {
  await expect(formatDateLocale("toLocaleString", 0, ["en-US", { timeZone: "UTC" }], new Budget({ stringLength: 10 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it.each([
  "null,{}", "['en_US'],{}", "[42],{}", "[undefined],{}", "new Float32Array([1]),{}",
  "'en-US',null", "'en-US',{localeMatcher:'invalid'}",
  "'en-US',{calendar:'a!'}", "'en-US',{numberingSystem:'ab'}",
  "'en-US',{hourCycle:'h25'}", "'en-US',{timeZone:'not-a-zone'}",
  "'en-US',{year:'long'}", "'en-US',{fractionalSecondDigits:0}",
  "'en-US',{fractionalSecondDigits:NaN}", "'en-US',{fractionalSecondDigits:BigInt(1)}",
  "'en-US',{dateStyle:'full',year:'numeric'}", "'en-US',{timeStyle:'invalid'}",
  "'en-US',{timeZone:Symbol()}"
])("matches native locale errors: %s", async args => {
  const source = `try{return new Date(0).toLocaleString(${args})}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toBe(new Function(source)());
});

it.each(["toLocaleDateString('en-US',{timeStyle:'short'})", "toLocaleTimeString('en-US',{dateStyle:'short'})"])(
  "rejects incompatible styles: %s", async call => {
    await expect(run(`return new Date(0).${call};`)).rejects.toMatchObject({ name: "TypeError" });
  }
);

it("reads and coerces locale entries before formatting options, once per published algorithm", async () => {
  const source = "const log=[];const date=new Date(0);const locales={get length(){log.push('length');return 1},get 0(){log.push('locale');return {[Symbol.toPrimitive](hint){log.push(hint);return 'en-US'}}}};const options={get localeMatcher(){log.push('matcher');return 'lookup'},get timeZone(){log.push('zone');date.setTime(86400000);return {toString(){log.push('zoneString');return 'UTC'}}},get year(){log.push('year');return {toString(){log.push('yearString');return 'numeric'}}}};const text=date.toLocaleString(locales,options);return [text,log,date.getTime()];";
  expect((await run(source)).returnValue).toEqual([
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format(0),
    ["length", "locale", "string", "matcher", "zone", "zoneString", "year", "yearString"],
    86400000
  ]);
});

it("stops reading later options after a validation failure", async () => {
  const source = "const log=[];try{new Date(0).toLocaleString('en-US',{get localeMatcher(){log.push('matcher');return 'invalid'},get timeZone(){log.push('zone');return 'UTC'}})}catch(error){log.push(error.name)}return log;";
  expect((await run(source)).returnValue).toEqual(["matcher", "RangeError"]);
});

it("validates each locale before reading the next", async () => {
  const source = "const log=[];try{new Date(0).toLocaleString({length:2,0:'en_US',get 1(){log.push('later');return 'en-US'}})}catch(error){log.push(error.name)}return log;";
  expect((await run(source)).returnValue).toEqual(["RangeError"]);
});

it.each(["pending", "completed"])("replays locale formatting from a %s checkpoint", async mode => {
  const source = "const options={get timeZone(){return 'UTC'}};await 0;return new Date(0).toLocaleString('en-US',options);";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: new Date(0).toLocaleString("en-US", { timeZone: "UTC" }) };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("bounds sparse locale lists", async () => {
  await expect(run("try{return new Date(0).toLocaleString({length:Infinity})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("keeps coercion budget failures fatal", async () => {
  await expect(run("try{return new Date(0).toLocaleString('en-US',{get year(){while(true){}}})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});
