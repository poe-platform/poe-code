import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it.each([
  "Intl.getCanonicalLocales(locales)",
  "'I'.toLocaleLowerCase(locales)",
  "'i'.toLocaleUpperCase(locales)",
  "'I'.localeCompare('ı',locales,{sensitivity:'base'})",
  "new Intl.Collator(locales).resolvedOptions().locale",
  "new Intl.DateTimeFormat(locales).resolvedOptions().locale",
  "new Intl.NumberFormat(locales).resolvedOptions().locale",
  "new Intl.PluralRules(locales).resolvedOptions().locale",
  "new Intl.RelativeTimeFormat(locales).resolvedOptions().locale",
  "new Intl.ListFormat(locales).resolvedOptions().locale",
  "new Intl.Segmenter(locales).resolvedOptions().locale",
  "new Intl.DisplayNames(locales,{type:'language'}).resolvedOptions().locale",
])("preserves Proxy locale membership in %s", async expression => {
  const source = `const events=[];const locales=new Proxy(['tr'],{
    get(t,k,r){events.push(['get',String(k)]);return Reflect.get(t,k,r)},
    has(t,k){events.push(['has',String(k)]);return Reflect.has(t,k)}});
    return [${expression},events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each([
  "new Proxy(['tr'],{has(){throw 'has'}})",
  "new Proxy(['tr'],{has(){return false},get(t,k,r){if(k==='0')throw 'unreached';return Reflect.get(t,k,r)}})",
  "new Proxy({length:1},{has(t,k){return k==='0'},get(t,k){return k==='0'?'tr':t[k]}})",
  "Object.create(new Proxy({length:1,0:'tr'},{has(t,k){return Reflect.has(t,k)}}))",
  "new Proxy(['tr'],{has(t,k){delete t[k];return true}})",
  "new Proxy(Object.defineProperty(['tr'],'0',{configurable:false}),{has(){return false}})",
])("handles locale membership semantics: %s", async input => {
  const source = `try{return Intl.getCanonicalLocales(${input})}catch(e){return typeof e==='object'?e.name:e}`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["pending", "completed"])("preserves Proxy locales through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const locales=new Proxy(['tr'],{has(t,k){events.push(k);return Reflect.has(t,k)}});return ['I'.toLocaleLowerCase(locales),events];";
  const expected = await runInNewContext(`(async function(){"use strict";${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it("keeps budget exhaustion in locale membership traps fatal", async () => {
  await expect(run("try{return Intl.getCanonicalLocales(new Proxy(['tr'],{has(){while(true){}}}))}catch(e){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});
