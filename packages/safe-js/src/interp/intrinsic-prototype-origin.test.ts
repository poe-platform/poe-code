import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";
import { isSandboxClosure } from "./values.js";
import { getSandboxPrototype } from "./object-model.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

const names = ["Date", "Map", "Set", "RegExp", "Number", "Boolean", "String", "BigInt", "Symbol"];

it.each(names)("keeps %s.prototype's original parent under foreign inspection and replay", async name => {
  const native = runInNewContext(`[${name}.prototype,Object.prototype]`);
  expect(runInNewContext("Object.getPrototypeOf")(native[0])).toBe(native[1]);
  const source = `await 0;return [${name}.prototype,Object.prototype]`;
  const original = await run(source);
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  const inspect = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(inspect)) throw new Error("Missing inspector");
  for (const result of [original,replayed]) {
    if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing prototype exports");
    const [prototype,parent] = result.returnValue;
    expect(await inspect.call([prototype],{stack:[],thisValue:undefined}) === parent).toBe(true);
    expect(getSandboxPrototype(prototype) === parent).toBe(true);
  }
});

it.each(names)("preserves an explicit %s.prototype parent override", async name => {
  const result = await run(`const parent={};Object.setPrototypeOf(${name}.prototype,parent);return [${name}.prototype,parent]`);
  if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing prototype exports");
  const inspect = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(inspect)) throw new Error("Missing inspector");
  expect(await inspect.call([result.returnValue[0]],{stack:[],thisValue:undefined})).toBe(result.returnValue[1]);
});

it("retains the old prototype parent when a budget starts another realm", async () => {
  const budget = new Budget();
  const result = await run("return [Date.prototype,Object.prototype]",{budget});
  const later = await run("return Object.getPrototypeOf",{budget});
  if (!result.ok || !Array.isArray(result.returnValue) || !later.ok || !isSandboxClosure(later.returnValue))
    throw new Error("Missing realm exports");
  expect(await later.returnValue.call([result.returnValue[0]],{stack:[],thisValue:undefined}) === result.returnValue[1]).toBe(true);
});

it.each(names.flatMap(name => ["", `${name}.extra=7;`, `${name}.prototype.extra=7;`].map(mutation => [name,mutation])))
("restores the %s constructor and prototype as the same intrinsic graph after %s", async (name,mutation) => {
  const source = `${mutation}return [${name},${name}.prototype]`;
  const result = await run(source);
  if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing constructor exports");
  const [constructor,prototype] = result.returnValue;
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{constructor,prototype}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restore(JSON.parse(JSON.stringify(saved)),{source});
  const restoredConstructor = restored.currentScope.lookup("constructor").value;
  if (!isSandboxClosure(restoredConstructor)) throw new Error("Missing restored constructor");
  expect(restoredConstructor.properties?.prototype === restored.currentScope.lookup("prototype").value).toBe(true);
  if (mutation) {
    const target = mutation.includes(".prototype.")
      ? restored.currentScope.lookup("prototype").value : restoredConstructor.properties;
    expect((target as Record<string, unknown>).extra).toBe(7);
  }
});
