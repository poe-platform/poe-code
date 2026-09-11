import { expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { runInNewContext } from "node:vm";
import { changeStringLocaleCase } from "./string-locale.js";

const methods = ["toLocaleLowerCase", "toLocaleUpperCase"];

it.each([
  "return 'I'.toLocaleLowerCase('tr');",
  "return 'i'.toLocaleUpperCase('tr');"
])("supports locale-sensitive case mapping: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(methods)("matches native %s output for supported locale mappings", async method => {
  const source = `return ['Iİiı','Straße','ΟΣ','I\\u0301','\\uD800'].map(text=>['en','tr','az','lt','el','zz'].map(locale=>text.${method}(locale)));`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(methods)("uses only the first canonical locale for %s mapping", async method => {
  const source = `return ['iI'.${method}(['en','tr']),'iI'.${method}(['tr','en']),'iI'.${method}(['zz','tr'])];`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(methods)("validates later locale entries before %s conversion", async method => {
  await expect(run(`return 'I'.${method}(['tr','bad_locale']);`)).rejects.toMatchObject({ name: "RangeError" });
});

it.each(methods)("preserves %s receiver and locale coercion order", async method => {
  const source = `const log=[];const receiver={toString(){log.push('receiver');return 'iI'}};const locales={get length(){log.push('length');return 2},get 0(){log.push('first');return {toString(){log.push('convert');return 'tr'}}},get 1(){log.push('second');return 'en'}};const text=String.prototype.${method}.call(receiver,locales);return [text,log];`;
  const expected = Reflect.apply(String.prototype[method as "toLocaleLowerCase" | "toLocaleUpperCase"], "iI", ["tr"]);
  expect((await run(source)).returnValue).toEqual([expected, ["receiver", "length", "first", "convert", "second"]]);
});

it.each(methods)("supports %s function metadata and mutable properties", async method => {
  const source = `const method=String.prototype.${method};method.label=42;Object.freeze(method);return [method.name,method.length,method.label,Object.isFrozen(method),Object.getOwnPropertyDescriptor(String.prototype,'${method}').enumerable];`;
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it.each([
  "return String.prototype.toLocaleLowerCase.call(42,'en');",
  "return String.prototype.toLocaleUpperCase.call(true,'en');",
  "return new String('i').toLocaleUpperCase('tr');",
  "return 'I'.toLocaleLowerCase(Object.assign(Object.create({0:'tr'}),{length:1}));",
  "return 'i'.toLocaleUpperCase([,'tr']);",
  "return 'I'.toLocaleLowerCase('tr',Object.create({ignored:true}));",
  "return 'i'.toLocaleUpperCase();",
  "return 'I'.toLocaleLowerCase([]);"
])("supports case mapping inputs: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["null", "['bad_locale']", "[42]", "new Float32Array([1])"])("rejects invalid locale input %s", async locales => {
  const source = `try{return 'I'.toLocaleLowerCase(${locales})}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["null", "undefined", "Symbol()"])("rejects invalid receivers before inspecting locales: %s", async receiver => {
  const source = `const log=[];try{String.prototype.toLocaleLowerCase.call(${receiver},{get length(){log.push('locale');return 0}})}catch(error){log.push(error.name)}return log;`;
  expect((await run(source)).returnValue).toEqual(["TypeError"]);
});

it.each(["pending", "completed"])("replays case mapping from a %s checkpoint", async mode => {
  const source = "const locales={get length(){return 1},get 0(){return 'tr'}};await 0;return ['I'.toLocaleLowerCase(locales),'i'.toLocaleUpperCase(locales)];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["ı", "İ"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("bounds sparse locale lists in case mapping", async () => {
  await expect(run("try{return 'I'.toLocaleLowerCase({length:Infinity})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("keeps locale getter budget failures fatal", async () => {
  await expect(run("try{return 'I'.toLocaleLowerCase({get length(){while(true){}}})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("bounds case-expanding output", async () => {
  await expect(run("return 'ßß'.toLocaleUpperCase('de');", { budget: new Budget({ stringLength: 3 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("charges case-mapping work before invoking native conversion", async () => {
  const native = vi.spyOn(String.prototype, "toLocaleUpperCase");
  try {
    await expect(changeStringLocaleCase("ßß", "toLocaleUpperCase", [], new Budget({ maxSteps: 1 })))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(native).not.toHaveBeenCalled();
  } finally { native.mockRestore(); }
});

it("does not execute raw native locale getters without a guest context", async () => {
  let reads = 0;
  const locales = { length: 1, get 0() { reads++; return "tr"; } };
  await expect(changeStringLocaleCase("I", "toLocaleLowerCase", [locales], new Budget()))
    .rejects.toThrow("Native accessors cannot execute");
  expect(reads).toBe(0);
});
