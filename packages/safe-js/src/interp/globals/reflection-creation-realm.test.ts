import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { parseModule } from "../../parse/parser.js";
import { interpret } from "../interpreter.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { createGuestProxy } from "../guest-proxy.js";
import { createSandboxClosure, deepCopyFromSandbox, isSandboxClosure } from "../values.js";

const methods = ["Object.keys", "Object.values", "Object.entries", "Object.getOwnPropertyNames", "Object.getOwnPropertySymbols", "Reflect.ownKeys"];

it.each(methods.flatMap(method => [false, true].map(direct => ({ method, direct }))))(
  "retains $method result realm (direct SDK: $direct)", async ({ method, direct }) => {
    const setup = "const input={a:1};Object.defineProperty(input,'hidden',{value:2});";
    const source = `${setup}return [${method},()=>${method}(input),input,Array.prototype,()=>{Array.prototype.marker=9}]`;
    const native = runInNewContext(`(()=>{${source}})()`);
    const expected = native[0](native[2]);
    expect(Object.getPrototypeOf(expected) === native[3]).toBe(true);
    const exported = (await run(source)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    const reader = (await run("return value=>value.marker")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[4]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    const pending = direct ? exported[0].call([exported[2]]) : exported[1].call([], context);
    if (direct && method !== "Reflect.ownKeys") expect(pending instanceof Promise).toBe(false);
    const result = await pending;
    expect(await getter.call([result], context) === exported[3]).toBe(true);
    expect(deepCopyFromSandbox(result)).toEqual(expected);
    const arrays = [result];
    if (method === "Object.entries") {
      if (!Array.isArray(result)) throw new Error("Expected entry array");
      for (const pair of result) {
        expect(await getter.call([pair], context) === exported[3]).toBe(true);
        arrays.push(pair);
      }
    }
    await exported[4].call([], context);
    for (const array of arrays) {
      expect(await reader.call([array], context)).toBe(9);
      expect(() => deepCopyFromSandbox(array)).toThrow();
    }
  }
);

it("preserves reflection value identity, symbol identity and accessor order", async () => {
  const source = `const value=Object.create(null);const key=Symbol('key');const log=[];const input={get a(){log.push(this===input);return value},[key]:value};const values=Object.values(input);const entries=Object.entries(input);return [values[0]===value,entries[0][1]===value,Object.getPrototypeOf(value)===null,Object.getOwnPropertySymbols(input)[0]===key,Reflect.ownKeys(input)[1]===key,log]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it.each(methods)("retains Proxy-path %s result realm", async method => {
  const source = `return [${method}(wrap({a:1},{})),Array.prototype]`;
  const budget = new Budget();
  const parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  const evaluated = await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  });
  expect(evaluated.ok).toBe(true);
  if (!evaluated.ok || !Array.isArray(evaluated.returnValue)) throw new Error("Expected reflection exports");
  const [result, prototype] = evaluated.returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected SDK getter");
  const context = { stack: [], thisValue: undefined };
  expect(await getter.call([result], context) === prototype).toBe(true);
  if (method === "Object.entries" && Array.isArray(result)) {
    expect(await getter.call([result[0]], context) === prototype).toBe(true);
  }
});

it("feeds reflected entry arrays back into the direct SDK fromEntries adapter", async () => {
  const exported = (await run("const value={count:2};return [Object.entries({left:value,right:value}),Object.fromEntries,value]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1])) throw new Error("Expected SDK exports");
  const rebuilt = await exported[1].call([exported[0]]);
  expect(deepCopyFromSandbox(rebuilt)).toEqual({ left: { count: 2 }, right: { count: 2 } });
});

it("observes explicit array iterator overrides in direct SDK fromEntries", async () => {
  const exported = (await run("const entries=Object.entries({a:1});entries[Symbol.iterator]=function*(){yield ['b',2]};return [entries,Object.fromEntries]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1])) throw new Error("Expected SDK exports");
  expect(deepCopyFromSandbox(await exported[1].call([exported[0]]))).toEqual({ b: 2 });
});
