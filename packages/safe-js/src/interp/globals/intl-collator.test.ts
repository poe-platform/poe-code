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
  "return [typeof Intl.Collator,Intl.Collator.length,Intl.Collator.name]",
  "return new Intl.Collator('en',{numeric:true,sensitivity:'base'}).resolvedOptions()",
  "const value=Intl.Collator('en');return [value instanceof Intl.Collator,Object.prototype.toString.call(value)]",
  "class Child extends Intl.Collator{};const value=new Child('en');return [value instanceof Child,value instanceof Intl.Collator,value.compare('a','b')]",
  "const value=new Intl.Collator('en',{numeric:true});return ['10','2','1'].sort(value.compare)",
  "const value=new Intl.Collator('en');const compare=value.compare;return [compare===value.compare,compare.name,compare.length,compare.call(null,'a','b'),Object.getOwnPropertyNames(compare)]",
  "const value=new Intl.Collator('en');const a=value.resolvedOptions();a.locale='changed';return [a!==value.resolvedOptions(),value.resolvedOptions().locale]",
  "const value=new Intl.Collator('en');return [String(value.compare),Object.getPrototypeOf(value.compare)===Object.getPrototypeOf(()=>{})]",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl.Collator,'prototype');return [descriptor.writable,descriptor.enumerable,descriptor.configurable]",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl.Collator.prototype,'compare');return [descriptor.get.name,descriptor.get.length,descriptor.set,descriptor.enumerable,descriptor.configurable]",
  "return Intl.Collator.supportedLocalesOf(['EN-us','fr','en-US'],{localeMatcher:'lookup'})",
  "const trace=[];Intl.Collator.supportedLocalesOf('en',{get localeMatcher(){trace.push('matcher');return 'lookup'},get numeric(){trace.push('numeric');throw 7}});return trace",
  "try{new Intl.Collator('en',null)}catch(error){return error.name}",
  "return new Intl.Collator('en',7).resolvedOptions()",
  "try{new Intl.Collator('en_US')}catch(error){return error.name}",
  "try{Intl.Collator.prototype.resolvedOptions.call(Object.create(Intl.Collator.prototype))}catch(error){return error.name}",
  "try{Object.getOwnPropertyDescriptor(Intl.Collator.prototype,'compare').get.call({})}catch(error){return error.name}",
  "try{const compare=new Intl.Collator('en').compare;new compare('a','b')}catch(error){return error.name}",
  "const trace=[];try{new Intl.Collator('en').compare(Symbol(),{toString(){trace.push('second');return 'b'}})}catch(error){return [error.name,trace]}",
  "const trace=[];const compare=new Intl.Collator('en').compare;const a={toString(){trace.push('first');return 'a'}};const b={toString(){trace.push('second');return 'b'}};return [compare(a,b),trace]",
  "const value=new Intl.Collator('en');value.extra=7;Object.freeze(value);return [value.extra,value.compare('a','b'),Object.isFrozen(value)]",
  "const locale=new Intl.Locale('de');locale.toString=()=>{throw 7};return new Intl.Collator(locale).resolvedOptions().locale",
  "const trace=[];new Intl.Collator('en',Object.fromEntries(['usage','localeMatcher','collation','numeric','caseFirst','sensitivity','ignorePunctuation'].map(key=>[key,{toString(){trace.push(key);return key==='usage'?'sort':key==='localeMatcher'?'lookup':key==='collation'?'default':key==='caseFirst'?'upper':'base'}}])));return trace"
])("matches native Collator behavior: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(source);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("restores the bound comparison identity and its owning Collator", async () => {
  const source = "const value=new Intl.Collator('en',{numeric:true});const compare=value.compare;compare.owner=value;value.extra=1;return ()=>[compare===value.compare,compare.owner===value,compare('2','10'),value.extra++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 1; count <= 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual([true, true, -1, count]);
    reader = binding.value;
  }
});

it("reads the derived prototype before locales and options", async () => {
  const source = "const trace=[];const proto={};const Child=(function(){}).bind(null);Object.defineProperty(Child,'prototype',{get(){trace.push('prototype');return proto}});const locales={get length(){trace.push('locales');return 0}};const options={get usage(){trace.push('usage')}};const value=Reflect.construct(Intl.Collator,[locales,options],Child);return [Object.getPrototypeOf(value)===proto,trace]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, ["prototype", "locales", "usage"]] });
});

it("restores private state after replacing the Collator prototype", async () => {
  const source = "const value=new Intl.Collator('en',{numeric:true});const read=Intl.Collator.prototype.resolvedOptions;const compare=value.compare;Object.setPrototypeOf(value,{marker:7});return ()=>[read.call(value).numeric,compare('2','10'),Object.getPrototypeOf(value).marker]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toEqual([true, -1, 7]);
});

it("validates collation before reading numeric", async () => {
  expect(await run("const trace=[];try{new Intl.Collator('en',{get collation(){trace.push('collation');return 'bad_tag'},get numeric(){trace.push('numeric')}})}catch(error){return [error.name,trace]}"))
    .toMatchObject({ ok: true, returnValue: ["RangeError", ["collation"]] });
});

it("retains private resolved options with no guest prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.Collator('en',{numeric:true}),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue]))
    .toBe(1 + measureSandboxData([new Intl.Collator("en", { numeric: true }).resolvedOptions()]));
});

it("charges comparison string work", async () => {
  await expect(run("export default (first,second)=>new Intl.Collator('en').compare(first,second)", {
    entryPointArgs: ["x".repeat(2000), "y".repeat(2000)], budget: new Budget({ maxSteps: 500 })
  })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("charges supported locale output arrays", async () => {
  await expect(run("return Intl.Collator.supportedLocalesOf({0:'en',1:'fr',length:2})", { budget: new Budget({ arrayLength: 1 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each(["pending", "completed"])("replays Collator and compare aliases from a %s public checkpoint", async mode => {
  const source = "const value=new Intl.Collator('en',{numeric:true});const compare=value.compare;compare.owner=value;await 0;return [compare===value.compare,compare.owner===value,['10','2'].sort(compare)]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, true, ["2", "10"]] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it.each(["missing-option", "wrong-option-type", "unknown-usage", "foreign-compare"])("rejects forged Collator snapshot state: %s", async alteration => {
  const source = "const first=new Intl.Collator('en');const second=new Intl.Collator('fr');return [first,first.compare,second,second.compare]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { values: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copied = JSON.parse(JSON.stringify(saved));
  const nodes = (Object.values(copied.heap) as Array<{kind: string; options: Record<string, unknown>; compare: unknown}>).filter(node => node.kind === "guest-collator");
  expect(nodes).toHaveLength(2);
  if (alteration === "missing-option") delete nodes[0].options.usage;
  else if (alteration === "wrong-option-type") nodes[0].options.numeric = "true";
  else if (alteration === "unknown-usage") nodes[0].options.usage = "unknown";
  else nodes[0].compare = nodes[1].compare;
  expect(() => restore(copied, { source })).toThrow();
});
