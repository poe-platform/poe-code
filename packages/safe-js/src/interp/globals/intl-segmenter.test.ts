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
  "return [Intl.Segmenter.name,Intl.Segmenter.length]",
  "return [...new Intl.Segmenter('en').segment('A👨‍👩‍👧‍👦é')]",
  "return [...new Intl.Segmenter('en',{granularity:'word'}).segment('Hello, world!')]",
  "return [...new Intl.Segmenter('en',{granularity:'sentence'}).segment('Hello. World!')]",
  "return [...new Intl.Segmenter('ja',{granularity:'word'}).segment('吾輩は猫である。')]",
  "return new Intl.Segmenter('en',{granularity:'word'}).resolvedOptions()",
  "const s=new Intl.Segmenter('en').segment('A😀é');return [-1,0,1,2,3,4,5,NaN,Infinity,-Infinity,1.9].map(i=>s.containing(i))",
  "const s=new Intl.Segmenter('en').segment('ab');const a=s[Symbol.iterator](),b=s[Symbol.iterator]();return [a.next(),a.next(),b.next(),a.next(),a.next()]",
  "return [...new Intl.Segmenter('en').segment('')]",
  "return [...new Intl.Segmenter('en').segment(undefined)]",
  "return Intl.Segmenter.supportedLocalesOf(['EN-us','fr','en-US'])",
  "try{Intl.Segmenter('en')}catch(e){return e.name}",
  "try{Intl.Segmenter.prototype.segment.call({},'x')}catch(e){return e.name}",
  "const s=new Intl.Segmenter('en').segment('x');try{s.containing.call({},0)}catch(e){return e.name}",
  "const i=new Intl.Segmenter('en').segment('x')[Symbol.iterator]();try{i.next.call({})}catch(e){return e.name}",
  "class Child extends Intl.Segmenter{};const s=new Child('en');return [s instanceof Child,Object.prototype.toString.call(s),[...s.segment('x')]]",
  "const trace=[];new Intl.Segmenter('en',{get localeMatcher(){trace.push('matcher')},get granularity(){trace.push('granularity')}});return trace",
  "const trace=[];const s=new Intl.Segmenter('en').segment({toString(){trace.push('text');return 'abc'}});s.containing({valueOf(){trace.push('index');return 1}});return trace",
  "const s=new Intl.Segmenter('en').segment('x');const i=s[Symbol.iterator]();return [Object.prototype.toString.call(s),Object.prototype.toString.call(i),i[Symbol.iterator]()===i,Object.getPrototypeOf(Object.getPrototypeOf(i))===Iterator.prototype]",
  "return ['segment','resolvedOptions'].map(key=>{const d=Object.getOwnPropertyDescriptor(Intl.Segmenter.prototype,key);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})"
])("matches native Segmenter: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Intl.Segmenter!=="function")throw new Error("Missing Segmenter");${source}`);
  if (!result.ok) throw result.error;
  expect(result.returnValue).toEqual(expected);
});

it.each([
  "const f=new Intl.Segmenter('en');const segment=f.segment;f.self=f;Object.setPrototypeOf(f,{marker:7});return ()=>[...segment.call(f,'ab')].map(x=>x.segment).concat(f.self===f,Object.getPrototypeOf(f).marker)",
  "const s=new Intl.Segmenter('en').segment('A😀é');const containing=s.containing;s.self=s;Object.setPrototypeOf(s,null);return ()=>[containing.call(s,2),s.self===s]",
  "const s=new Intl.Segmenter('en').segment('abc');const i=s[Symbol.iterator]();const next=i.next;i.self=i;Object.setPrototypeOf(i,null);next.call(i);return ()=>[next.call(i),i.self===i]"
])("restores Segmenter private state repeatedly: %s", async source => {
  const first = await run(source);
  const control = await run(source);
  if (!first.ok || !control.ok || !isSandboxClosure(control.returnValue)) throw new Error("Missing reader");
  let reader = first.returnValue as RuntimeSnapshotValue;
  for (let index = 0; index < 3; index++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored reader");
    expect(await binding.value.call([])).toEqual(await control.returnValue.call([]));
    reader = binding.value;
  }
});

it.each(["segments", "iterator"])("accounts for privately retained %s input", async kind => {
  const result = await run(`const s=new Intl.Segmenter('en').segment('x'.repeat(2000));const value=${kind === "segments" ? "s" : "s[Symbol.iterator]()"};Object.setPrototypeOf(value,null);return value`);
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBeGreaterThan(2000);
});

it.each(["pending", "completed"])("replays a partially consumed segment iterator from a %s checkpoint", async mode => {
  const source = "const s=new Intl.Segmenter('en').segment('A😀é');const i=s[Symbol.iterator]();i.self=i;i.next();await 0;return [i.next(),i.next(),i.next(),i.self===i]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restoreRun(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [
      { value: { segment: "😀", index: 1, input: "A😀é" }, done: false },
      { value: { segment: "é", index: 3, input: "A😀é" }, done: false },
      { value: undefined, done: true }, true
    ] };
    // Runtime snapshots contain realm-local identities; compare both executions
    // against the same independently specified observable result.
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it.each(["locale", "granularity", "input", "negative", "fractional", "pastEnd", "insideSegment", "reference", "extra"])("rejects forged segment state: %s", async alteration => {
  const source = "return new Intl.Segmenter('en').segment('A😀é')[Symbol.iterator]()";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copy = JSON.parse(JSON.stringify(saved));
  const nodes = Object.values(copy.heap) as Array<{ kind: string; options: Record<string, unknown>; input: unknown; index: unknown; segmenter: unknown; extra?: unknown }>;
  const iterator = nodes.find(node => node.kind === "guest-segments")!;
  const owner = nodes.find(node => node.kind === "guest-segmenter")!;
  expect(iterator).toBeDefined();
  expect(owner).toBeDefined();
  if (alteration === "locale") owner.options.locale = "EN";
  else if (alteration === "granularity") owner.options.granularity = "invalid";
  else if (alteration === "input") iterator.input = 5;
  else if (alteration === "negative") iterator.index = -1;
  else if (alteration === "fractional") iterator.index = 1.5;
  else if (alteration === "pastEnd") iterator.index = 6;
  else if (alteration === "insideSegment") iterator.index = 2;
  else if (alteration === "reference") iterator.segmenter = { kind: "ref", id: -1 };
  else iterator.extra = true;
  expect(() => restore(copy, { source })).toThrow();
});

it("charges long input before native segmentation", async () => {
  await expect(run("export default value=>new Intl.Segmenter('en').segment(value)", {
    entryPointArgs: ["x".repeat(2000)], budget: new Budget({ maxSteps: 500 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it.each([
  "new Intl.Segmenter('en')",
  "new Intl.Segmenter('en').segment('ab')",
  "new Intl.Segmenter('en').segment('ab')[Symbol.iterator]()"
])("rejects structured cloning of %s", async expression => {
  expect(await run(`try{structuredClone(${expression});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ ok: true, returnValue: "DataCloneError" });
});
