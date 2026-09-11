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
  "const value=new Intl.Locale('EN-latn-us');return [String(value),value.baseName,value.language,value.script,value.region,Object.prototype.toString.call(value)]",
  "const value=new Intl.Locale('en',{language:'fr',script:'Latn',region:'CA',calendar:'gregory',collation:'phonebk',hourCycle:'h23',caseFirst:'upper',numeric:true,numberingSystem:'latn'});return [String(value),value.calendar,value.collation,value.hourCycle,value.caseFirst,value.numeric,value.numberingSystem]",
  "return [String(new Intl.Locale('en').maximize()),String(new Intl.Locale('en-Latn-US').minimize())]",
  "const value=new Intl.Locale('en-US');value.toString=()=>{throw 7};return [String(new Intl.Locale(value)),Intl.getCanonicalLocales(value),Intl.getCanonicalLocales([value])]",
  "class Child extends Intl.Locale{}const value=new Child('en');return [value instanceof Child,value instanceof Intl.Locale,Object.getPrototypeOf(value.maximize())===Intl.Locale.prototype]",
  "try{Intl.Locale('en')}catch(error){return error.name}",
  "try{new Intl.Locale(7)}catch(error){return error.name}",
  "try{new Intl.Locale('en_US')}catch(error){return error.name}",
  "try{new Intl.Locale('en',null)}catch(error){return error.name}",
  "try{Intl.Locale.prototype.toString.call(Object.create(Intl.Locale.prototype))}catch(error){return error.name}",
  "const value=new Intl.Locale('en');value.extra=7;Object.freeze(value);return [value.extra,String(value),Object.keys(value),Object.isFrozen(value)]",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl.Locale.prototype,'language');return [descriptor.enumerable,descriptor.configurable,descriptor.set,descriptor.get.name,Intl.Locale.length,Intl.Locale.name]"
])("matches native Locale behavior: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("keeps the constructor prototype property immutable", async () => {
  expect(await run("const descriptor=Object.getOwnPropertyDescriptor(Intl.Locale,'prototype');return [descriptor.writable,descriptor.enumerable,descriptor.configurable,Reflect.set(Intl.Locale,'prototype',{})]"))
    .toMatchObject({ ok: true, returnValue: [false, false, false, false] });
});

it.each(["und", "und-Latn", "und-419", "und-1994"])("preserves the language subtag in %s", async tag => {
  expect(await run(`const value=new Intl.Locale('${tag}');return [String(value),value.language,Intl.getCanonicalLocales(value)]`))
    .toMatchObject({ ok: true, returnValue: [tag, "und", [tag]] });
});

it("updates an und locale without dropping its language", async () => {
  expect(await run("const value=new Intl.Locale('und',{script:'Latn',region:'US',calendar:'islamicc'});return [String(value),value.language]"))
    .toMatchObject({ ok: true, returnValue: ["und-Latn-US-u-ca-islamic-civil", "und"] });
});

it("supports firstDayOfWeek independently of native constructor support", async () => {
  expect(await run("const value=new Intl.Locale('en-US',{firstDayOfWeek:1});return [String(value),value.firstDayOfWeek,value.getWeekInfo().firstDay]"))
    .toMatchObject({ ok: true, returnValue: ["en-US-u-fw-mon", "mon", 1] });
});

it.each([[0, "sun", 7], [2, "tue", 2], [3, "wed", 3], [4, "thu", 4], [5, "fri", 5], [6, "sat", 6], [7, "sun", 7], ["toString", "tostring", 7]] as const)("canonicalizes firstDayOfWeek %s without host property lookup", async (firstDay, canonical, expectedDay) => {
  expect(await run(`const value=new Intl.Locale('en-US',{firstDayOfWeek:${JSON.stringify(firstDay)}});return [value.firstDayOfWeek,value.getWeekInfo().firstDay]`))
    .toMatchObject({ ok: true, returnValue: [canonical, expectedDay] });
});

it("rejects malformed calendar options before reading later options", async () => {
  expect(await run("const trace=[];try{new Intl.Locale('en',{get calendar(){trace.push('calendar');return 'bad_tag'},get collation(){trace.push('collation')}})}catch(error){return [error.name,trace]}"))
    .toMatchObject({ ok: true, returnValue: ["RangeError", ["calendar"]] });
});

it("rejects malformed language before reading script", async () => {
  expect(await run("const trace=[];try{new Intl.Locale('en',{get language(){trace.push('language');return 'bad_tag'},get script(){trace.push('script')}})}catch(error){return [error.name,trace]}"))
    .toMatchObject({ ok: true, returnValue: ["RangeError", ["language"]] });
});

it("replaces variants while preserving extensions", async () => {
  expect(await run("const value=new Intl.Locale('sl-rozaj-u-ca-gregory',{variants:'1994-BISKE'});return [String(value),value.variants,new Intl.Locale('en').variants]"))
    .toMatchObject({ ok: true, returnValue: ["sl-1994-biske-u-ca-gregory", "1994-biske", undefined] });
});

it.each(["", "abcd", "abcde-ABCDE", "123", "abc_def"])("rejects invalid variants %s before reading calendar", async variants => {
  expect(await run(`const trace=[];try{new Intl.Locale('en',{variants:${JSON.stringify(variants)},get calendar(){trace.push('calendar')}})}catch(error){return [error.name,trace]}`))
    .toMatchObject({ ok: true, returnValue: ["RangeError", []] });
});

it("falls back to the Locale prototype for a primitive derived prototype", async () => {
  const source = "const trace=[];function Child(){};Object.defineProperty(Child,'prototype',{value:7});const tag={toString(){trace.push('tag');return 'en'}};const value=Reflect.construct(Intl.Locale,[tag],Child);return [String(value),Object.getPrototypeOf(value)===Intl.Locale.prototype,trace]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: ["en", true, ["tag"]] });
});

it("reads newTarget prototype before the tag and options", async () => {
  const source = "const trace=[];const proto={};const Child=(function(){}).bind(null);Object.defineProperty(Child,'prototype',{get(){trace.push('prototype');return proto}});const tag={toString(){trace.push('tag');return 'en'}};const value=Reflect.construct(Intl.Locale,[tag,{get language(){trace.push('language')}}],Child);return [Object.getPrototypeOf(value)===proto,trace]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, ["prototype", "tag", "language"]] });
});

it("counts private locale strings even after removing the prototype", async () => {
  const tag = "en-US-u-ca-gregory";
  const result = await run(`return Object.setPrototypeOf(new Intl.Locale('${tag}'),null)`);
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + tag.length);
});

it.each([
  ["getCalendars", "calendars"], ["getCollations", "collations"],
  ["getHourCycles", "hourCycles"], ["getNumberingSystems", "numberingSystems"],
  ["getTimeZones", "timeZones"], ["getTextInfo", "textInfo"], ["getWeekInfo", "weekInfo"]
])("supports %s on every supported runtime", async (method, legacy) => {
  const native = runInNewContext(`new Intl.Locale('en-US').${legacy}`);
  // Current ECMA-402 omits the older minimalDays field from getWeekInfo.
  const expected = method === "getWeekInfo" ? { firstDay: native.firstDay, weekend: native.weekend } : native;
  expect(await run(`const locale=new Intl.Locale('en-US');const first=locale.${method}();const second=locale.${method}();return [first,first!==second]`))
    .toMatchObject({ ok: true, returnValue: [expected, true] });
});

it("restores Locale state with guest descriptors, aliases and custom prototypes", async () => {
  const source = "const locale=new Intl.Locale('en-US-u-ca-gregory');const read=Intl.Locale.prototype.toString;locale.extra=1;locale.self=locale;Object.setPrototypeOf(locale,{marker:9});return ()=>[read.call(locale),locale.extra++,locale.self===locale,Object.getPrototypeOf(locale).marker]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 1; count <= 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["en-US-u-ca-gregory", count, true, 9]);
    reader = binding.value;
  }
});

it.each(["pending", "completed"])("replays a Locale from a %s public checkpoint", async mode => {
  const source = "const locale=new Intl.Locale('en-US',{firstDayOfWeek:1});locale.self=locale;await 0;return [String(locale),locale.self===locale,locale.getWeekInfo()]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["en-US-u-fw-mon", true, { firstDay: 1, weekend: [6, 7] }] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("preserves syntactically valid unknown extension values", async () => {
  expect(await run("const value=new Intl.Locale('en-u-ca-unknown-co-unknown-fw-unknown-hc-unknown-kf-unknown-nu-unknown');return [value.calendar,value.collation,value.firstDayOfWeek,value.hourCycle,value.caseFirst,value.numberingSystem]"))
    .toMatchObject({ ok: true, returnValue: Array(6).fill("unknown") });
});

it("charges Locale information arrays", async () => {
  await expect(run("return new Intl.Locale('en-US').getWeekInfo()", { budget: new Budget({ arrayLength: 1 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each(["EN-us", "en_US", 7, null])("rejects malformed or noncanonical snapshot Locale tag %s", async tag => {
  const source = "return new Intl.Locale('en-US')";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { locale: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copied = JSON.parse(JSON.stringify(saved));
  const nodes = Object.values(copied.heap) as Array<Record<string, unknown>>;
  const node = nodes.find(node => node.kind === "guest-locale");
  expect(node).toBeDefined();
  node!.tag = tag;
  expect(() => restore(copied, { source })).toThrow();
});
