import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it.each([
  "return '2'.localeCompare('10','en',Object.create({numeric:true}));",
  "const log=[];const result='2'.localeCompare('10','en',{get numeric(){log.push('numeric');return true}});return [result,log];",
  "return '2'.localeCompare(Object.create({toString(){return '10'}}),'en',{numeric:true});",
  "const value=()=>0;value.toString=()=> '10';return '2'.localeCompare(value,'en',{numeric:true});",
  "const log=[];return ['a'.localeCompare('A','en',{get sensitivity(){log.push('get');return {toString(){log.push('string');return 'base'}}}}),log];",
  "return '2'.localeCompare('10',{get length(){return 1},get 0(){return {toString(){return 'en'}}}},{numeric:true});",
  "return '2'.localeCompare('10',Object.assign(Object.create({0:'en'}),{length:1}),{numeric:true});",
  "const log=[];const receiver={toString(){log.push('receiver');return '2'}};const value={toString(){log.push('comparison');return '10'}};const locales={get length(){log.push('locales');return 0}};const options={get numeric(){log.push('numeric');return true}};const result=String.prototype.localeCompare.call(receiver,value,locales,options);return [result,log];",
  "const token={};try{'a'.localeCompare('b','en',{get numeric(){throw token}})}catch(error){return error===token};"
])("supports guest localeCompare coercion and options: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it.each(["Symbol('x')", "Object(Symbol('x'))"])("rejects implicit string conversion of %s", async value => {
  const source = `try{return 'a'.localeCompare(${value})}catch(error){return error.name}`;
  expect((await run(source)).returnValue).toBe(new Function(source)());
});

it.each(["pending", "completed"])("replays localeCompare guest options from a %s checkpoint", async mode => {
  const source = "const options={get numeric(){return true}};await 0;return '2'.localeCompare('10','en',options);";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: "2".localeCompare("10", "en", { numeric: true }) };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("keeps localeCompare option coercion budget failures fatal", async () => {
  await expect(run("try{return 'a'.localeCompare('b','en',{get numeric(){while(true){}}})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("reads Collator options once in specification order", async () => {
  const keys = ["usage", "localeMatcher", "collation", "numeric", "caseFirst", "sensitivity", "ignorePunctuation"];
  const source = `const log=[];const options={};for(const key of ${JSON.stringify(keys)})Object.defineProperty(options,key,{get(){log.push(key);return undefined}});'a'.localeCompare('b','en',options);return log;`;
  expect((await run(source)).returnValue).toEqual(keys);
});

it.each([
  ["usage", "localeMatcher", "bogus"],
  ["localeMatcher", "collation", "bogus"],
  ["collation", "numeric", "bad_value"],
  ["caseFirst", "sensitivity", "bogus"],
  ["sensitivity", "ignorePunctuation", "bogus"]
])("validates %s before reading %s", async (key, later, invalid) => {
  const source = `const log=[];try{'a'.localeCompare('b','en',{get ${key}(){log.push('${key}');return {toString(){log.push('convert');return '${invalid}'}}},get ${later}(){log.push('later')}})}catch(error){log.push(error.name)}return log;`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("does not read locales after failed comparison coercion", async () => {
  const source = "const log=[];try{'a'.localeCompare(Symbol(),{get length(){log.push('locales');return 0}})}catch(error){log.push(error.name)}return log;";
  expect((await run(source)).returnValue).toEqual(["TypeError"]);
});

it("ignores extra arguments without copying their object graphs", async () => {
  expect((await run("return 'a'.localeCompare('A','en',{sensitivity:'base'},Object.create({ignored:true}));")).returnValue).toBe(0);
});

it("bounds sparse locale lists in collation", async () => {
  await expect(run("try{return 'a'.localeCompare('b',{length:Infinity})}catch(error){return 'caught'}", {
    budget: new Budget({ maxSteps: 100 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("preserves guest exceptions during option string conversion", async () => {
  const source = "const token=new RangeError('custom');try{'a'.localeCompare('b','en',{sensitivity:{toString(){throw token}}})}catch(error){return error===token};";
  expect((await run(source)).returnValue).toBe(true);
});
