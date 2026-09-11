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
  "return [Intl.PluralRules.name,Intl.PluralRules.length]",
  "return ['', ' ', ' 1 ', '0_1', '+0x1', '1e400', '1e-400'].map(value=>new Intl.PluralRules('fr').select(value))",
  "return [0,1,2,3,4,11,21,1.5].map(n=>new Intl.PluralRules('en').select(n))",
  "return [0,1,2,3,4,11,21,1.5].map(n=>new Intl.PluralRules('pl').select(n))",
  "return [0,1,2,3,4,11,21,1.5].map(n=>new Intl.PluralRules('ar').select(n))",
  "return [1,2,3,4,11,21].map(n=>new Intl.PluralRules('en',{type:'ordinal'}).select(n))",
  "return new Intl.PluralRules('en').resolvedOptions()",
  "return new Intl.PluralRules('fr',{minimumFractionDigits:2,maximumFractionDigits:4}).resolvedOptions()",
  "return new Intl.PluralRules('en',{maximumSignificantDigits:3}).resolvedOptions()",
  "return ['ceil','floor','trunc','halfEven'].map(roundingMode=>{const f=new Intl.PluralRules('en',{maximumFractionDigits:0,roundingMode});return [f.select(1.5),f.resolvedOptions().roundingMode]})",
  "return ['auto','stripIfInteger'].map(trailingZeroDisplay=>new Intl.PluralRules('en',{minimumFractionDigits:2,trailingZeroDisplay}).select(1))",
  "return new Intl.PluralRules('en').selectRange(1,2)",
  "return new Intl.PluralRules('ru').selectRange(2,5)",
  "return [NaN,Infinity,-Infinity].map(n=>new Intl.PluralRules('en').select(n))",
  "try{Intl.PluralRules('en')}catch(e){return e.name}",
  "try{Intl.PluralRules.prototype.select.call({},1)}catch(e){return e.name}",
  "try{new Intl.PluralRules('en').selectRange(undefined,1)}catch(e){return e.name}",
  "return Intl.PluralRules.supportedLocalesOf(['EN-us','fr','en-US'])",
  "class Child extends Intl.PluralRules{};const f=new Child('en');return [f instanceof Child,Object.prototype.toString.call(f),f.select(1)]",
  "const trace=[];new Intl.PluralRules('en',{get localeMatcher(){trace.push('matcher')},get type(){trace.push('type')},get minimumIntegerDigits(){trace.push('integer')},get minimumFractionDigits(){trace.push('minFraction')},get maximumFractionDigits(){trace.push('maxFraction')},get minimumSignificantDigits(){trace.push('minSignificant')},get maximumSignificantDigits(){trace.push('maxSignificant')},get roundingIncrement(){trace.push('increment')},get roundingMode(){trace.push('mode')},get roundingPriority(){trace.push('priority')},get trailingZeroDisplay(){trace.push('zero')}});return trace",
  "const trace=[];try{new Intl.PluralRules('en',{get type(){trace.push('type');return 'invalid'},get minimumIntegerDigits(){trace.push('integer')}})}catch(e){return [e.name,trace]}",
  "return ['select','selectRange','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.PluralRules.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})"
])("matches native PluralRules: %s", async source => {
 const expected = runInNewContext(`(function(){"use strict";${source}})()`);
 const result = await run(`if(typeof Intl.PluralRules!=="function")throw new Error("Missing PluralRules");${source}`);
 if (!result.ok) throw result.error;
 expect(result.returnValue).toEqual(expected);
});

it("accounts for private plural options after removal of the guest prototype", async () => {
  const result = await run("const f=new Intl.PluralRules('en');const options=f.resolvedOptions();Object.setPrototypeOf(f,null);return [f,options]");
  if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing plural result");
  expect(measureSandboxData([result.returnValue[0]])).toBe(1 + measureSandboxData([result.returnValue[1]]));
});

it("retains exact integer and decimal plural operands", async () => {
  expect(await run("const f=new Intl.PluralRules('en',{maximumFractionDigits:20});return [f.select(1n),f.select('1.0000000000000000001'),f.selectRange(1n,1n)]"))
    .toMatchObject({ ok: true, returnValue: ["one", "other", "one"] });
});

it("bounds processing of long numeric text", async () => {
  await expect(run("export default value=>new Intl.PluralRules('en').select(value)", {
    entryPointArgs: ["1".repeat(2000)], budget: new Budget({ maxSteps: 500 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("restores plural state, custom prototypes and aliases repeatedly", async () => {
  const source = "const f=new Intl.PluralRules('en',{maximumFractionDigits:0,roundingMode:'floor'});const select=f.select;f.self=f;f.count=0;Object.setPrototypeOf(f,{marker:7});return ()=>[select.call(f,1.9),f.self===f,Object.getPrototypeOf(f).marker,f.count++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual(["one", true, 7, count]);
    reader = binding.value;
  }
});

it.each(["pending", "completed"])("replays PluralRules from a %s checkpoint", async mode => {
  const source = "const f=new Intl.PluralRules('en');f.self=f;await 0;return [f.self===f,f.select(1)]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, "one"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it.each(["missing", "type", "locale", "categories", "extra"])("rejects forged PluralRules snapshot state: %s", async alteration => {
  const source = "return new Intl.PluralRules('en')";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copy = JSON.parse(JSON.stringify(saved));
  const nodes = (Object.values(copy.heap) as Array<{kind: string; options: Record<string, unknown>}>).filter(node => node.kind === "guest-pluralrules");
  expect(nodes).toHaveLength(1);
  if (alteration === "missing") delete nodes[0].options.roundingMode;
  else if (alteration === "type") nodes[0].options.type = "invalid";
  else if (alteration === "locale") nodes[0].options.locale = "EN";
  else if (alteration === "categories") nodes[0].options.pluralCategories = ["other"];
  else nodes[0].options.extra = "unexpected";
  expect(() => restore(copy, { source })).toThrow();
});

it("returns fresh plural-category arrays", async () => {
  expect(await run("const f=new Intl.PluralRules('en');f.resolvedOptions().pluralCategories.push('fake');return f.resolvedOptions().pluralCategories"))
    .toMatchObject({ ok: true, returnValue: ["one", "other"] });
});

it("handles numeric-text overflow without expanding the exponent", async () => {
  expect(await run("const f=new Intl.PluralRules('en');return [f.select('1e100000000'),f.selectRange('-1e100000000','1e100000000')]"))
    .toMatchObject({ ok: true, returnValue: ["other", "other"] });
});

it.each(["morePrecision", "lessPrecision"])("restores both digit ranges with %s rounding", async roundingPriority => {
  const source = `const f=new Intl.PluralRules('en',{roundingPriority:${JSON.stringify(roundingPriority)},minimumFractionDigits:2,maximumSignificantDigits:3});return ()=>[f.select(1),f.select(1.2345),f.resolvedOptions()]`;
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing reader");
  const expected = await result.returnValue.call([]);
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored reader");
  expect(await binding.value.call([])).toEqual(expected);
});
