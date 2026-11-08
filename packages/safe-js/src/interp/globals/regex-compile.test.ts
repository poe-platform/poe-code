import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createRegexGlobals } from "./regex.js";
import { getSandboxDataProperty, materializeFunctionProperties } from "../object-model.js";
import { createSandboxRegex, isSandboxClosure, measureSandboxData } from "../values.js";

it.each([
  "const r=/a/g;r.lastIndex=9;r.marker=7;const result=r.compile('b+','i');return [result===r,r.source,r.flags,r.lastIndex,r.marker,r.test('BBB')]",
  "const r=/a/g;return [r.compile()===r,r.source,r.flags,r.test('')]",
  "const r=/a/;r.compile(undefined,'g');return [r.source,r.flags]",
  "const r=/a/,other=/b/gi;other.lastIndex=9;r.compile(other);return [r.source,r.flags,r.lastIndex]",
  "const r=/a/,other=/b/g;other[Symbol.match]=false;Object.defineProperty(other,'source',{get(){throw 'wrong'}});Object.defineProperty(other,'flags',{get(){throw 'wrong'}});r.compile(other);return [r.source,r.flags]",
  "const r=/a/;try{r.compile(/b/,'g')}catch(e){return [e.name,r.source,r.flags]}",
  "const seen=[];const pattern={[Symbol.match]:true,get source(){throw 'wrong'},toString(){seen.push('source');return 'b'}};const flags={toString(){seen.push('flags');return 'g'}};const r=/a/;r.compile(pattern,flags);return [r.source,r.flags,seen]",
  "const seen=[];try{RegExp.prototype.compile.call({}, {toString(){seen.push('wrong');return 'a'}})}catch(e){return [e.name,seen]}",
  "try{RegExp.prototype.compile.call(RegExp.prototype,'a')}catch(e){return e.name}",
  "const r=/a/g;r.lastIndex=4;try{r.compile('[')}catch(e){return [e.name,r.source,r.flags,r.lastIndex,r.test('aaaaa')]}",
  "const r=/a/g;r.lastIndex=4;try{r.compile('b','gg')}catch(e){return [e.name,r.source,r.flags,r.lastIndex]}",
  "const r=/a/g;Object.defineProperty(r,'lastIndex',{value:4,writable:false});try{r.compile('b','i')}catch(e){return [e.name,r.source,r.flags,r.lastIndex,r.test('B')]}",
  "const r=Object.freeze(/a/);try{r.compile('b','i')}catch(e){return [e.name,r.source,r.flags,r.test('B')]}",
  "const r=/a/g;r.lastIndex=2;r.compile(r);return [r.source,r.flags,r.lastIndex]",
  "class R extends RegExp{}const r=new R('a');r.compile('b');return [r instanceof R,r.test('b')]",
  "const r=/a/;Object.defineProperty(r,'source',{value:'shadow'});r.compile('b');return [r.source,RegExp.prototype.test.call(r,'b')]",
  "const seen=[];const r=/a/;try{r.compile({toString(){seen.push('source');throw 'stop'}},{toString(){seen.push('wrong');return 'g'}})}catch(e){return [e,seen,r.source]}",
  "const r=/a/;try{r.compile(Symbol())}catch(e){return [e.name,r.source]}",
  "const r=/a/;try{r.compile('b',Symbol())}catch(e){return [e.name,r.source]}",
  "const d=Object.getOwnPropertyDescriptor(RegExp.prototype,'compile');let denied=false;try{new d.value()}catch(e){denied=e instanceof TypeError}return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,denied]",
  "const r=/a/;return r.test({toString(){r.compile('b');return 'b'}})"
])("preserves regex recompilation semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){'use strict';${source}})()`)});
});

it("keeps fatal compilation budgets uncatchable", async () => {
  await expect(run("try{/a/.compile({toString(){while(true){}return 'b'}})}catch(e){return 'caught'}", {budget: new Budget({maxSteps: 100})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
});

it("replays a recompiled regex with aliases and own properties", async () => {
  const source = "const r=/a/g,alias=r;r.marker=7;r.compile('b+','gi');r.lastIndex=1;await 0;return [alias===r,r.source,r.flags,r.marker,r.exec('aBBB')[0],r.lastIndex]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: [true,'b+','gi',7,'BBB',4]});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: [true,'b+','gi',7,'BBB',4]});
  } finally { await completed; }
});

it("reconciles standalone compilation charges after replacement and failed cursor reset", async () => {
  const budget = new Budget();
  const { RegExp: constructor } = createRegexGlobals({budget});
  const method = getSandboxDataProperty(materializeFunctionProperties(constructor).prototype, "compile", budget);
  if (!isSandboxClosure(method)) throw new Error("Missing compile method");
  const receiver = createSandboxRegex("a");
  for (let index = 1; index <= 20; index++) {
    await method.call([`b{${index}}`, "i"], {stack: [], thisValue: receiver});
    expect(budget.currentDataSize).toBe(measureSandboxData([receiver,...budget.retainedValues()]));
  }
  Object.defineProperty(receiver, "lastIndex", {value: 4, writable: false});
  await expect(method.call(["c+", "i"], {stack: [], thisValue: receiver})).rejects.toThrow(TypeError);
  expect(receiver.source).toBe("c+");
  expect(receiver.lastIndex).toBe(4);
  expect(budget.currentDataSize).toBe(measureSandboxData([receiver,...budget.retainedValues()]));
});
