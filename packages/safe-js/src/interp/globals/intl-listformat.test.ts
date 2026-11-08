import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure, measureSandboxData } from "../values.js";
import { dump } from "../../dump.js";
import { restore as restoreRun } from "../../restore.js";
import { Budget } from "../budget.js";

it.each([
  "return [typeof Intl.ListFormat,Intl.ListFormat.name,Intl.ListFormat.length]",
  "const d=Object.getOwnPropertyDescriptor(Intl.ListFormat,'prototype');return [d.writable,d.enumerable,d.configurable]",
  "return new Intl.ListFormat('en',{type:'disjunction',style:'short'}).resolvedOptions()",
  "const f=new Intl.ListFormat('en');return [f.format(),f.format([]),f.format(['a']),f.format(['a','b','c']),f.format('ab')]",
  "return new Intl.ListFormat('en').formatToParts(['a','b'])",
  "return ['conjunction','disjunction','unit'].map(type=>['long','short','narrow'].map(style=>new Intl.ListFormat('de',{type,style}).format(['a','b','c'])))",
  "class Child extends Intl.ListFormat{};const f=new Child('en');return [f instanceof Child,f instanceof Intl.ListFormat,Object.prototype.toString.call(f)]",
  "try{Intl.ListFormat('en')}catch(e){return e.name}",
  "return Intl.ListFormat.supportedLocalesOf(['EN-us','fr','en-US'],{localeMatcher:'lookup'})",
  "const trace=[];new Intl.ListFormat('en',{get localeMatcher(){trace.push('localeMatcher')},get type(){trace.push('type')},get style(){trace.push('style')}});return trace",
  "const trace=[];const Child=(function(){}).bind(null);Object.defineProperty(Child,'prototype',{get(){trace.push('prototype');return {marker:7}}});const locales={get length(){trace.push('locales');return 0}};const options={get type(){trace.push('type')}};const value=Reflect.construct(Intl.ListFormat,[locales,options],Child);return [Object.getPrototypeOf(value).marker,trace]",
  "const trace=[];try{new Intl.ListFormat('en',{type:'invalid',get style(){trace.push('style')}})}catch(e){return [e.name,trace]}",
  "const trace=[];Intl.ListFormat.supportedLocalesOf('en',{get localeMatcher(){trace.push('matcher')},get type(){throw 7}});return trace",
  "const f=new Intl.ListFormat('en');return [null,7,{},[new String('a')],[Symbol()]].map(input=>{try{f.format(input)}catch(e){return e.name}})",
  "const trace=[];const input={[Symbol.iterator](){return {next(){throw 9},return(){trace.push('return');return {}}}}};try{new Intl.ListFormat('en').format(input)}catch(e){return [e,trace]}",
  "const trace=[];const input={[Symbol.iterator](){return {next(){return {get done(){throw 9}}},return(){trace.push('return');return {}}}}};try{new Intl.ListFormat('en').format(input)}catch(e){return [e,trace]}",
  "const trace=[];const input={[Symbol.iterator](){return {next(){return {value:7,done:false}},return(){trace.push('return');throw 9}}}};try{new Intl.ListFormat('en').format(input)}catch(e){return [e.name,trace]}",
  "const trace=[];const input={[Symbol.iterator](){return {next(){return {get value(){throw 9},done:false}},return(){trace.push('return');return {}}}}};try{new Intl.ListFormat('en').format(input)}catch(e){return [e,trace]}",
  "try{Intl.ListFormat.prototype.format.call(Object.create(Intl.ListFormat.prototype),['a'])}catch(e){return e.name}",
  "const f=new Intl.ListFormat('en');const a=f.resolvedOptions();a.locale='changed';return [a!==f.resolvedOptions(),f.resolvedOptions().locale]",
  "return ['format','formatToParts','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.ListFormat.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})"
])("matches native ListFormat behavior: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Intl.ListFormat!=="function")throw new Error("Missing ListFormat");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("accounts for private resolved options after removal of the guest prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.ListFormat('en'),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([new Intl.ListFormat("en").resolvedOptions()]));
});

it("bounds list accumulation from a generator", async () => {
  await expect(run("function* values(){yield 'a';yield 'b';yield 'c'}return new Intl.ListFormat('en').format(values())", { budget: new Budget({ arrayLength: 2 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it("bounds formatting work for long input strings", async () => {
  await expect(run("export default text=>new Intl.ListFormat('en').format([text])", { entryPointArgs: ["x".repeat(2000)], budget: new Budget({ maxSteps: 500 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("bounds the formatted output string", async () => {
  await expect(run("return new Intl.ListFormat('en').format(['abcdefghij','klmnopqrst','uvwxyzabcd'])", { budget: new Budget({ stringLength: 32 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("restores ListFormat state, aliases and custom prototype through repeated snapshots", async () => {
  const source = "const value=new Intl.ListFormat('en',{type:'disjunction'});const format=value.format;value.self=value;value.count=0;Object.setPrototypeOf(value,{marker:7});return ()=>[format.call(value,['a','b']),value.self===value,Object.getPrototypeOf(value).marker,value.count++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["a or b", true, 7, count]);
    reader = binding.value;
  }
});

it.each(["missing", "type", "unknown", "noncanonical", "extra"])("rejects forged ListFormat snapshot options: %s", async alteration => {
  const source = "return new Intl.ListFormat('en')";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copied = JSON.parse(JSON.stringify(saved));
  const nodes = (Object.values(copied.heap) as Array<{kind: string; options: Record<string, unknown>}>).filter(node => node.kind === "guest-listformat");
  expect(nodes).toHaveLength(1);
  if (alteration === "missing") delete nodes[0].options.type;
  else if (alteration === "type") nodes[0].options.style = 7;
  else if (alteration === "unknown") nodes[0].options.type = "unknown";
  else if (alteration === "noncanonical") nodes[0].options.locale = "EN";
  else nodes[0].options.extra = "unexpected";
  expect(() => restore(copied, { source })).toThrow();
});

it.each(["pending", "completed"])("replays ListFormat aliases from a %s public checkpoint", async mode => {
  const source = "const value=new Intl.ListFormat('en');value.self=value;await 0;return [value.self===value,value.format(['a','b'])]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, "a and b"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});
