import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { runInNewContext } from "node:vm";
import { formatNumberLocale } from "../number-locale.js";

it("reads every numeric option once in specification order", async () => {
  const keys = ["localeMatcher", "numberingSystem", "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "notation", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay", "compactDisplay", "useGrouping", "signDisplay"];
  const source = `const log=[];const options={};for(const key of ${JSON.stringify(keys)})Object.defineProperty(options,key,{get(){log.push(key);return undefined}});(1).toLocaleString('en-US',options);return log;`;
  expect((await run(source)).returnValue).toEqual(keys);
});

it.each(["currency", "unit"])("rejects a missing %s before later getters", async style => {
  const source = `const log=[];try{(1).toLocaleString('en-US',{style:'${style}',get ${style}Display(){log.push('late');return 'short'}})}catch(error){log.push(error.name)}return log;`;
  expect((await run(source)).returnValue).toEqual(["TypeError"]);
});

it.each(["get style(){throw marker}", "maximumFractionDigits:{valueOf(){throw marker}}"])("preserves option exception identity: %s", async option => {
  expect((await run(`const marker={};try{(1).toLocaleString('en-US',{${option}})}catch(error){return error===marker}`)).returnValue).toBe(true);
});

it("bounds numeric output length", async () => {
  await expect(formatNumberLocale(123456, [], new Budget({ stringLength: 3 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("charges for unit validation before native parsing", async () => {
  await expect(formatNumberLocale(1, [undefined, { unit: "x".repeat(1000) }], new Budget({ maxSteps: 100 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("bounds retained numeric formatting data", async () => {
  await expect(formatNumberLocale(BigInt("9".repeat(1000)), [], new Budget({ dataSize: 100 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
});

it("does not execute raw host option accessors", async () => {
  let reads = 0;
  await expect(formatNumberLocale(1, [undefined, { get style() { reads++; return "decimal"; } }], new Budget()))
    .rejects.toThrow("Native accessors cannot execute");
  expect(reads).toBe(0);
});

it.each([
  "return (12345.67).toLocaleString('de-DE',{style:'currency',currency:'EUR'});",
  "return BigInt('9223372036854775807').toLocaleString('en-US');"
])("supports locale-sensitive numeric formatting: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each([
  "return [NaN,Infinity,-Infinity,-0].map(value=>value.toLocaleString('en-US'));",
  "return (0.1234).toLocaleString('de-DE',{style:'percent',maximumFractionDigits:2});",
  "return (1234.567).toLocaleString('ja-JP',{style:'currency',currency:'JPY'});",
  "return (-1234.5).toLocaleString('en-US',{style:'currency',currency:'USD',currencySign:'accounting',currencyDisplay:'code'});",
  "return (1234.5).toLocaleString('en-US',{style:'unit',unit:'kilometer-per-hour',unitDisplay:'long'});",
  "return (1234.5).toLocaleString('ar-EG',{numberingSystem:'latn'});",
  "return (1234567).toLocaleString('en-US',{notation:'compact',compactDisplay:'long'});",
  "return (1234.5678).toLocaleString('en-US',{notation:'scientific'});",
  "return (1234.5678).toLocaleString('en-US',{notation:'engineering'});",
  "return (1.025).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,roundingIncrement:5,roundingMode:'halfEven'});",
  "return (1234.5678).toLocaleString('en-US',{maximumSignificantDigits:3,minimumFractionDigits:2,roundingPriority:'morePrecision'});",
  "return (1234.5678).toLocaleString('en-US',{maximumSignificantDigits:3,minimumFractionDigits:2,roundingPriority:'lessPrecision'});",
  "return (1).toLocaleString('en-US',{minimumFractionDigits:2,trailingZeroDisplay:'stripIfInteger'});",
  "return [false,true,'false','true','always','min2',0,null].map(useGrouping=>(1234).toLocaleString('en-US',{useGrouping}));",
  "return [-1,-0,0,1].map(value=>value.toLocaleString('en-US',{signDisplay:'negative'}));",
  "return new Number(1234).toLocaleString('en-US',Object.create({useGrouping:false}));",
  "return Object(BigInt('9223372036854775807')).toLocaleString('de-DE');",
  "return BigInt('9223372036854775807').toLocaleString('en-US',{style:'currency',currency:'USD'});",
  "return (12).toLocaleString({length:1,get 0(){return {toString(){return 'en-US'}}}},{minimumIntegerDigits:3});",
  "return (12).toLocaleString('en-US',{},Object.create({ignored:true}));"
])("matches native numeric formatting: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["scientific", "engineering"])("uses published currency digit defaults for %s notation", async notation => {
  const source = `return (1234.5678).toLocaleString('en-US',{style:'currency',currency:'USD',notation:'${notation}'});`;
  expect((await run(source)).returnValue).toBe(new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: notation as "scientific" | "engineering",
    minimumFractionDigits: 0, maximumFractionDigits: 3
  }).format(1234.5678));
});

it.each([
  "null", "{style:'currency'}", "{style:'unit'}", "{currency:'XX'}", "{unit:'fake-unit'}",
  "{minimumIntegerDigits:0}", "{minimumFractionDigits:101}", "{maximumSignificantDigits:22}",
  "{minimumSignificantDigits:5,maximumSignificantDigits:4}", "{minimumFractionDigits:4,maximumFractionDigits:3}",
  "{roundingIncrement:3}", "{roundingIncrement:5,maximumSignificantDigits:3}",
  "{roundingIncrement:5,minimumFractionDigits:1,maximumFractionDigits:2}", "{roundingMode:'invalid'}",
  "{roundingPriority:'invalid'}", "{trailingZeroDisplay:'invalid'}", "{useGrouping:'invalid'}",
  "{signDisplay:'invalid'}", "{maximumFractionDigits:BigInt(1)}", "{style:Symbol()}"
])("rejects invalid numeric options: %s", async options => {
  const source = `try{return (1).toLocaleString('en-US',${options})}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["Number", "BigInt"])("checks %s receiver before option access", async kind => {
  const source = `const log=[];try{${kind}.prototype.toLocaleString.call({}, {get length(){log.push('locale');return 0}})}catch(error){log.push(error.name)}return log;`;
  expect((await run(source)).returnValue).toEqual(["TypeError"]);
});

it.each(["Number", "BigInt"])("exposes ordinary %s locale method metadata", async kind => {
  const source = `const method=${kind}.prototype.toLocaleString;method.label=42;Object.freeze(method);return [method.name,method.length,method.label,Object.isFrozen(method),Object.getOwnPropertyDescriptor(${kind}.prototype,'toLocaleString').enumerable];`;
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it("reads digit options before conditional digit conversion", async () => {
  const source = "const log=[];const options={get minimumFractionDigits(){log.push('fraction');return {valueOf(){log.push('fractionNumber');return 2}}},get maximumSignificantDigits(){log.push('significant');return {valueOf(){log.push('significantNumber');return 3}}},get roundingPriority(){log.push('priority');return 'auto'},get compactDisplay(){log.push('compact');return 'short'}};const text=(1234.567).toLocaleString('en-US',options);return [text,log];";
  expect((await run(source)).returnValue).toEqual(["1,230", ["fraction", "significant", "priority", "significantNumber", "compact"]]);
});

it("does not coerce unused fraction options", async () => {
  const source = "return (1234).toLocaleString('en-US',{maximumSignificantDigits:2,minimumFractionDigits:{valueOf(){throw 42}}});";
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("validates digit combinations before later option getters", async () => {
  const source = "const log=[];try{(1).toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:2,get compactDisplay(){log.push('compact');return 'short'}})}catch(error){log.push(error.name)}return log;";
  expect((await run(source)).returnValue).toEqual(["RangeError"]);
});

it.each(["pending", "completed"])("replays numeric formatting from a %s checkpoint", async mode => {
  const source = "const options={get useGrouping(){return false}};await 0;return [(1234).toLocaleString('en-US',options),BigInt('9223372036854775807').toLocaleString('en-US',options)];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["1234", "9223372036854775807"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("keeps numeric option coercion budget failures fatal", async () => {
  await expect(run("try{return (1).toLocaleString('en-US',{get style(){while(true){}}})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});
