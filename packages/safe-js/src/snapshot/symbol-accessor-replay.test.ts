import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["{}", "[]"])("replays symbol accessor descriptors on %s", async target => {
  const source = `const key=Symbol('key');const o=${target};o.value=7;function get(){return this.value}function set(x){this.value=x}Object.defineProperty(o,key,{get,set,enumerable:true,configurable:true});await 0;o[key]=9;const d=Object.getOwnPropertyDescriptor(o,key);return [o[key],d.get===get,d.set===set,d.enumerable,d.configurable]`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: [9,true,true,true,true]});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: [9,true,true,true,true]});
  } finally { await completed; }
});

it.each(["writable", "enumerable", "configurable"])("preserves a non-default symbol %s flag", async flag => {
  const source = `const key=Symbol('key');const o={};Object.defineProperty(o,key,{value:o,writable:true,enumerable:true,configurable:true,${flag}:false});await 0;const d=Object.getOwnPropertyDescriptor(o,key);return [o[key]===o,d.writable,d.enumerable,d.configurable]`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  const expected = [true,...["writable", "enumerable", "configurable"].map(name => name !== flag)];
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
