import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure, measureSandboxData } from "../values.js";
import { dump } from "../../dump.js";
import { restore as restoreRun } from "../../restore.js";

it.each([
  "return [Intl.DisplayNames.name,Intl.DisplayNames.length]",
  "return new Intl.DisplayNames('en',{type:'language'}).of('fr')",
  "return new Intl.DisplayNames('fr',{type:'region'}).of('US')",
  "return new Intl.DisplayNames('en',{type:'script'}).of('Latn')",
  "return new Intl.DisplayNames('en',{type:'currency'}).of('USD')",
  "return new Intl.DisplayNames('en',{type:'calendar'}).of('gregory')",
  "return new Intl.DisplayNames('en',{type:'dateTimeField'}).of('weekOfYear')",
  "return ['dialect','standard'].map(languageDisplay=>new Intl.DisplayNames('en',{type:'language',languageDisplay}).of('en-GB'))",
  "return ['long','short','narrow'].map(style=>new Intl.DisplayNames('de',{type:'region',style}).resolvedOptions())",
  "return ['code','none'].map(fallback=>new Intl.DisplayNames('en',{type:'currency',fallback}).of('ZZZ'))",
  "try{new Intl.DisplayNames('en')}catch(e){return e.name}",
  "try{new Intl.DisplayNames('en',{})}catch(e){return e.name}",
  "try{Intl.DisplayNames('en',{type:'region'})}catch(e){return e.name}",
  "const trace=[];new Intl.DisplayNames('en',{get localeMatcher(){trace.push('matcher')},get style(){trace.push('style')},get type(){trace.push('type');return 'region'},get fallback(){trace.push('fallback')},get languageDisplay(){trace.push('languageDisplay')}});return trace",
  "const trace=[];try{new Intl.DisplayNames('en',{get type(){trace.push('type');return 'bad'},get fallback(){trace.push('fallback')}})}catch(e){return [e.name,trace]}",
  "const trace=[];const f=new Intl.DisplayNames('en',{type:'region'});return [f.of({toString(){trace.push('string');return 'us'}}),trace]",
  "return ['us','USA','1','ZZ',Symbol()].map(code=>{try{return new Intl.DisplayNames('en',{type:'region'}).of(code)}catch(e){return e.name}})",
  "class Child extends Intl.DisplayNames{};const f=new Child('en',{type:'region'});return [f instanceof Child,Object.prototype.toString.call(f)]",
  "try{Intl.DisplayNames.prototype.of.call({},'US')}catch(e){return e.name}",
  "return Intl.DisplayNames.supportedLocalesOf(['EN-us','fr','en-US'])",
  "const d=Object.getOwnPropertyDescriptor(Intl.DisplayNames,'prototype');return [d.writable,d.enumerable,d.configurable]",
  "return ['of','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.DisplayNames.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})"
])("matches native DisplayNames: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Intl.DisplayNames!=="function")throw new Error("Missing DisplayNames");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("accounts for private resolved options after removal of the guest prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.DisplayNames('en',{type:'region'}),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([new Intl.DisplayNames("en",{type:"region"}).resolvedOptions()]));
});

it("bounds processing of a long input code", async () => {
  await expect(run("export default code=>new Intl.DisplayNames('en',{type:'language'}).of(code)", {
    entryPointArgs: ["a".repeat(2000)], budget: new Budget({ maxSteps: 500 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("bounds produced display-name strings", async () => {
  await expect(run("return new Intl.DisplayNames('en',{type:'region'}).of('GB')", {
    budget: new Budget({ stringLength: 12 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("restores DisplayNames state, aliases and custom prototype through repeated snapshots", async () => {
  const source = "const value=new Intl.DisplayNames('en',{type:'region'});const format=value.of;value.self=value;value.count=0;Object.setPrototypeOf(value,{marker:7});return ()=>[format.call(value,'US'),value.self===value,Object.getPrototypeOf(value).marker,value.count++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["United States", true, 7, count]);
    reader = binding.value;
  }
});

it.each(["missing", "type", "unknown", "noncanonical", "extra"])("rejects forged DisplayNames snapshot options: %s", async alteration => {
  const source = "return new Intl.DisplayNames('en',{type:'region'})";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copied = JSON.parse(JSON.stringify(saved));
  const nodes = (Object.values(copied.heap) as Array<{kind: string; options: Record<string, unknown>}>).filter(node => node.kind === "guest-displaynames");
  expect(nodes).toHaveLength(1);
  if (alteration === "missing") delete nodes[0].options.type;
  else if (alteration === "type") nodes[0].options.style = 7;
  else if (alteration === "unknown") nodes[0].options.type = "unknown";
  else if (alteration === "noncanonical") nodes[0].options.locale = "EN";
  else nodes[0].options.extra = "unexpected";
  expect(() => restore(copied, { source })).toThrow();
});

it.each(["pending", "completed"])("replays DisplayNames aliases from a %s public checkpoint", async mode => {
  const source = "const value=new Intl.DisplayNames('en',{type:'region'});value.self=value;await 0;return [value.self===value,value.of('US')]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, "United States"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("restores languageDisplay state and rejects its removal", async () => {
  const source = "const f=new Intl.DisplayNames('en',{type:'language',languageDisplay:'standard'});return ()=>f.of('en-GB')";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const reader = result.returnValue as RuntimeSnapshotValue;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copy = JSON.parse(JSON.stringify(saved));
  const restored = restore(copy, { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toBe(new Intl.DisplayNames("en", { type: "language", languageDisplay: "standard" }).of("en-GB"));
  const node = (Object.values(copy.heap) as Array<{kind: string; options: Record<string, unknown>}>).find(value => value.kind === "guest-displaynames");
  expect(node).toBeDefined();
  delete node!.options.languageDisplay;
  expect(() => restore(copy, { source })).toThrow();
});
