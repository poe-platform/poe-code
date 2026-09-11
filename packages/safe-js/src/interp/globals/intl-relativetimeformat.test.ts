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
  "return [typeof Intl.RelativeTimeFormat,Intl.RelativeTimeFormat.name,Intl.RelativeTimeFormat.length]",
  "return new Intl.RelativeTimeFormat('en',{numeric:'auto',style:'short'}).resolvedOptions()",
  "const f=new Intl.RelativeTimeFormat('en');return [-1,-0,0,1,1.5].map(value=>f.format(value,'day'))",
  "const f=new Intl.RelativeTimeFormat('en',{numeric:'auto'});return [-1,0,1].map(value=>[f.format(value,'days'),f.formatToParts(value,'day')])",
  "return new Intl.RelativeTimeFormat('de').formatToParts(-1234.5,'hours')",
  "return ['long','short','narrow'].map(style=>new Intl.RelativeTimeFormat('ar',{style,numberingSystem:'latn'}).format(3,'weeks'))",
  "class Child extends Intl.RelativeTimeFormat{};const f=new Child('en');return [f instanceof Child,f instanceof Intl.RelativeTimeFormat,Object.prototype.toString.call(f)]",
  "try{Intl.RelativeTimeFormat('en')}catch(e){return e.name}",
  "return Intl.RelativeTimeFormat.supportedLocalesOf(['EN-us','fr','en-US'],{localeMatcher:'lookup'})",
  "const trace=[];new Intl.RelativeTimeFormat('en',{get localeMatcher(){trace.push('matcher')},get numberingSystem(){trace.push('numberingSystem')},get style(){trace.push('style')},get numeric(){trace.push('numeric')}});return trace",
  "const trace=[];const value={valueOf(){trace.push('value');return 2}};const unit={toString(){trace.push('unit');return 'days'}};return [new Intl.RelativeTimeFormat('en').format(value,unit),trace]",
  "const trace=[];try{new Intl.RelativeTimeFormat('en').format(Infinity,{toString(){trace.push('unit');return 'day'}})}catch(e){return [e.name,trace]}",
  "const trace=[];try{new Intl.RelativeTimeFormat('en').format(1n,{toString(){trace.push('unit');return 'day'}})}catch(e){return [e.name,trace]}",
  "const f=new Intl.RelativeTimeFormat('en');return ['year','quarters','month','weeks','day','hours','minute','seconds'].map(unit=>f.format(2,unit))",
  "const f=new Intl.RelativeTimeFormat('en');return ['bad','Day','',undefined,Symbol()].map(unit=>{try{f.format(1,unit)}catch(e){return e.name}})",
  "try{Intl.RelativeTimeFormat.prototype.format.call({},1,'day')}catch(e){return e.name}",
  "const d=Object.getOwnPropertyDescriptor(Intl.RelativeTimeFormat,'prototype');return [d.writable,d.enumerable,d.configurable]",
  "return ['format','formatToParts','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.RelativeTimeFormat.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})"
])("matches native RelativeTimeFormat behavior: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Intl.RelativeTimeFormat!=="function")throw new Error("Missing RelativeTimeFormat");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("accounts for private resolved options after removal of the guest prototype", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.RelativeTimeFormat('en'),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([new Intl.RelativeTimeFormat("en").resolvedOptions()]));
});

it("bounds formatted output strings", async () => {
  await expect(run("return new Intl.RelativeTimeFormat('en').format(1e100,'year')", { budget: new Budget({ stringLength: 64 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("restores RelativeTimeFormat state, aliases and custom prototype through repeated snapshots", async () => {
  const source = "const value=new Intl.RelativeTimeFormat('en',{numeric:'auto'});const format=value.format;value.self=value;value.count=0;Object.setPrototypeOf(value,{marker:7});return ()=>[format.call(value,-1,'day'),value.self===value,Object.getPrototypeOf(value).marker,value.count++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["yesterday", true, 7, count]);
    reader = binding.value;
  }
});

it.each(["missing", "type", "unknown", "noncanonical", "extra"])("rejects forged RelativeTimeFormat snapshot options: %s", async alteration => {
  const source = "return new Intl.RelativeTimeFormat('en')";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copied = JSON.parse(JSON.stringify(saved));
  const nodes = (Object.values(copied.heap) as Array<{kind: string; options: Record<string, unknown>}>).filter(node => node.kind === "guest-relativetimeformat");
  expect(nodes).toHaveLength(1);
  if (alteration === "missing") delete nodes[0].options.numeric;
  else if (alteration === "type") nodes[0].options.style = 7;
  else if (alteration === "unknown") nodes[0].options.numeric = "unknown";
  else if (alteration === "noncanonical") nodes[0].options.locale = "EN";
  else nodes[0].options.extra = "unexpected";
  expect(() => restore(copied, { source })).toThrow();
});

it.each(["pending", "completed"])("replays RelativeTimeFormat aliases from a %s public checkpoint", async mode => {
  const source = "const value=new Intl.RelativeTimeFormat('en');value.self=value;await 0;return [value.self===value,value.format(2,'day')]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, "in 2 days"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});
