import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure, measureSandboxData } from "../values.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore as restoreRun } from "../../restore.js";

it.each([
  "return [Intl.DateTimeFormat.name,Intl.DateTimeFormat.length]",
  "return new Intl.DateTimeFormat('en',{timeZone:'UTC'}).format(0)",
  "return Intl.DateTimeFormat('en',{timeZone:'UTC'}).format(0)",
  "return new Intl.DateTimeFormat('fr',{dateStyle:'full',timeZone:'UTC'}).format(0)",
  "return new Intl.DateTimeFormat('en',{timeStyle:'long',timeZone:'America/New_York'}).format(0)",
  "return new Intl.DateTimeFormat('en',{calendar:'hebrew',timeZone:'UTC'}).resolvedOptions()",
  "return new Intl.DateTimeFormat('en',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'}).formatToParts(0)",
  "return new Intl.DateTimeFormat('en',{timeZone:'UTC'}).formatRange(0,86400000)",
  "return new Intl.DateTimeFormat('en',{timeZone:'UTC'}).formatRangeToParts(0,86400000)",
  "const f=new Intl.DateTimeFormat('en',{timeZone:'UTC'});return [f.format===f.format,f.format.name,f.format.length,f.format.call({},0)]",
  "return Intl.DateTimeFormat.supportedLocalesOf(['EN-us','fr','en-US'])",
  "class Child extends Intl.DateTimeFormat{};const f=new Child('en',{timeZone:'UTC'});return [f instanceof Child,Object.prototype.toString.call(f),f.format(0)]",
  "return ['formatToParts','formatRange','formatRangeToParts','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})",
  "return [NaN,Infinity,8640000000000001,1n,Symbol()].map(value=>{try{return new Intl.DateTimeFormat('en',{timeZone:'UTC'}).format(value)}catch(e){return e.name}})",
  "return [[undefined,0],[0,undefined],[NaN,0],[1,0]].map(args=>{try{return new Intl.DateTimeFormat('en',{timeZone:'UTC'}).formatRange(...args)}catch(e){return e.name}})",
  "const trace=[];const value={valueOf(){trace.push('number');return 0}};return [new Intl.DateTimeFormat('en',{timeZone:'UTC'}).format(value),trace]",
  "return ['formatToParts','formatRange','formatRangeToParts','resolvedOptions'].map(key=>{try{return Intl.DateTimeFormat.prototype[key].call({},0,1)}catch(e){return e.name}})",
  "const d=Object.getOwnPropertyDescriptor(Intl.DateTimeFormat,'prototype');return [d.writable,d.enumerable,d.configurable]"
])("matches native DateTimeFormat: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Intl.DateTimeFormat!=="function")throw new Error("Missing DateTimeFormat");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("uses the injected clock without consulting a guest replacement of Date.now", async () => {
  let time = 0;
  const result = await run("const f=new Intl.DateTimeFormat('en',{timeZone:'UTC'});Date.now=()=>999999999999;return [f.format(),f.formatToParts().map(p=>p.value).join('')]", {
    clock: { now: () => time++ * 86400000, snapshot: () => undefined }
  });
  expect(result).toMatchObject({ ok: true, returnValue: ["1/1/1970", "1/2/1970"] });
  expect(time).toBe(2);
});

it("accounts for private formatter options with a null guest prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.DateTimeFormat('en',{timeZone:'UTC'}),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([new Intl.DateTimeFormat("en", { timeZone: "UTC" }).resolvedOptions(), { timeZone: "UTC" }]));
});

it("bounds produced date strings", async () => {
  await expect(run("return new Intl.DateTimeFormat('en',{timeZone:'UTC',dateStyle:'full'}).format(0)", {
    budget: new Budget({ stringLength: 20 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("restores cached format identity, aliases and custom prototypes repeatedly", async () => {
  const source = "const value=new Intl.DateTimeFormat('en',{timeZone:'UTC',dateStyle:'full'});const format=value.format;const get=Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype,'format').get;value.self=value;value.count=0;Object.setPrototypeOf(value,{marker:7});return ()=>[format(0),get.call(value)===format,value.self===value,Object.getPrototypeOf(value).marker,value.count++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["Thursday, January 1, 1970", true, true, 7, count]);
    reader = binding.value;
  }
});

it.each(["missing", "type", "noncanonical", "extra", "cached-target"])("rejects forged DateTimeFormat snapshots: %s", async alteration => {
  const source = "const f=new Intl.DateTimeFormat('en',{timeZone:'UTC'});f.format;return f";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copy = JSON.parse(JSON.stringify(saved));
  const nodes = Object.values(copy.heap) as Array<{kind: string; options: Record<string, unknown>; id?: string}>;
  const formatters = nodes.filter(node => node.kind === "guest-datetimeformat");
  expect(formatters).toHaveLength(1);
  if (alteration === "missing") delete formatters[0].options.timeZone;
  else if (alteration === "type") formatters[0].options.calendar = 7;
  else if (alteration === "noncanonical") formatters[0].options.locale = "EN";
  else if (alteration === "extra") formatters[0].options.unexpected = "extra";
  else {
    const targets = nodes.filter(node => node.kind === "intrinsic" && node.id === '["%DateTimeFormatFormat%"]');
    expect(targets).toHaveLength(1);
    targets[0].id = '["%NumberFormatFormat%"]';
  }
  expect(() => restore(copy, { source })).toThrow();
});

it.each(["pending", "completed"])("replays current-time formatting from a %s checkpoint", async mode => {
  const source = "const f=new Intl.DateTimeFormat('en',{timeZone:'UTC',second:'numeric',fractionalSecondDigits:3});const first=f.format();await 0;return [first,f.formatToParts().map(p=>p.value).join(''),f.format===f.format]";
  let time = 0;
  const pending = run(source, { clock: { now: () => time++, snapshot: () => ({ next: time }) } });
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["0.000", "0.001", true] };
    expect(await completed).toMatchObject(expected);
    let resumedTime = 0;
    expect(await run(source, { snapshot, clock: {
      now: () => {
        if (mode === "completed") throw new Error("Replayed clock must not be reread");
        return resumedTime++;
      },
      restore: state => { resumedTime = state.next; },
      snapshot: () => ({ next: resumedTime })
    } })).toMatchObject(expected);
  } finally { await completed; }
});

// ECMA-402 CreateDateTimeFormat and Table 16 specify these observable reads.
// Older hosts pre-read components or access them twice, so they are not an
// oracle for this behavior even though their locale output remains useful.
it("reads constructor options once in specification order without enumeration", async () => {
  const expected = ['localeMatcher','calendar','numberingSystem','hour12','hourCycle','timeZone','weekday','era','year','month','day','dayPeriod','hour','minute','second','fractionalSecondDigits','timeZoneName','formatMatcher','dateStyle','timeStyle'];
  const source = `const trace=[];const options=new Proxy({}, {
    get(target,key){trace.push(key);return key==='timeZone'?'UTC':undefined},
    ownKeys(){throw 'enumerated'}
  });new Intl.DateTimeFormat('en',options);return trace`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ["timeZone", "invalid", "year"],
  ["fractionalSecondDigits", 0, "timeZoneName"]
])("validates %s once before reading later options", async (key, invalid, later) => {
  const source = `const trace=[];try{new Intl.DateTimeFormat('en',{
    get ${key}(){trace.push('${key}');return ${JSON.stringify(invalid)}},
    get ${later}(){throw 'later option read'}
  })}catch(e){return [e.name,trace]}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:["RangeError",[key]]});
});

it.each(["en-US", "en-GB", "fr", "ar", "ja"].flatMap(locale =>
  ["h11", "h12", "h23", "h24"].map(hourCycle => ({ locale, hourCycle }))
))("preserves resolved hour cycle through snapshots: $locale/$hourCycle", async ({ locale, hourCycle }) => {
  const source = `const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},{timeZone:'UTC',hour:'numeric',hourCycle:${JSON.stringify(hourCycle)}});return ()=>[f.format(0),f.resolvedOptions()]`;
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing formatter reader");
  const expected = await result.returnValue.call([]);
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored reader");
  expect(await binding.value.call([])).toEqual(expected);
});
