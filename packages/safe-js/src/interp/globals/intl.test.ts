import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { runInNewContext } from "node:vm";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "return [typeof Intl,Object.prototype.toString.call(Intl),Intl===globalThis.Intl]",
  "return Intl.getCanonicalLocales()",
  "return Intl.getCanonicalLocales(['EN-us','en-US','iw','sr-cyrl-rs'])",
  "return Intl.getCanonicalLocales({0:'fr',2:'DE',length:3})",
  "return Intl.getCanonicalLocales(Object.create({0:'fr',length:1}))",
  "return Intl.getCanonicalLocales(7)",
  "try{return Intl.getCanonicalLocales(null)}catch(error){return error.name}",
  "try{return Intl.getCanonicalLocales([7])}catch(error){return error.name}",
  "try{return Intl.getCanonicalLocales(['en_US'])}catch(error){return error.name}",
  "const trace=[];const locales={get length(){trace.push('length');return 2},get 0(){trace.push('0');return {toString(){trace.push('string');delete locales[1];return 'EN'}}},1:'fr'};return [Intl.getCanonicalLocales(locales),trace]",
  "const trace=[];try{Intl.getCanonicalLocales({length:2,0:'bad_tag',get 1(){trace.push('late');return 'fr'}})}catch(error){return [error.name,trace]}",
  "const trace=[];const result=Intl.supportedValuesOf({[Symbol.toPrimitive](hint){trace.push(hint);return 'calendar'}});return [result,trace]",
  "try{return Intl.supportedValuesOf(Symbol())}catch(error){return error.name}",
  "try{return Intl.supportedValuesOf('invalid')}catch(error){return error.name}",
  "const fn=Intl.getCanonicalLocales;fn.extra=7;return [fn.call(null,'EN'),fn.extra,fn.name,fn.length]",
  "try{new Intl.getCanonicalLocales()}catch(error){return error.name}",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl,'getCanonicalLocales');return [descriptor.writable,descriptor.enumerable,descriptor.configurable,Object.getPrototypeOf(Intl)===Object.prototype]"
])("matches native Intl foundation behavior: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["calendar", "collation", "currency", "numberingSystem", "timeZone", "unit"] as const)(
  "returns a fresh native-supported %s list", async key => {
    const result = await run(`const first=Intl.supportedValuesOf('${key}');const second=Intl.supportedValuesOf('${key}');return [first,first!==second]`);
    expect(result).toMatchObject({ ok: true, returnValue: [Intl.supportedValuesOf(key), true] });
  }
);

it("charges traversal of a sparse locale list to the step budget", async () => {
  await expect(run("return Intl.getCanonicalLocales({length:1000000000})", {
    budget: new Budget({ maxSteps: 200 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it.each([
  "return Intl.getCanonicalLocales({0:'en',1:'fr',length:2})",
  "return Intl.supportedValuesOf('calendar')"
])("charges returned locale data to the array budget: %s", async source => {
  await expect(run(source, { budget: new Budget({ arrayLength: 1 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each(["pending", "completed"])("replays Intl namespace and method mutations from a %s checkpoint", async mode => {
  const source = "Intl.extra={n:1};Intl.getCanonicalLocales.extra=7;await 0;return [Intl.extra.n++,Intl.getCanonicalLocales.extra,Intl.getCanonicalLocales('EN')]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [1, 7, ["en"]] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});
