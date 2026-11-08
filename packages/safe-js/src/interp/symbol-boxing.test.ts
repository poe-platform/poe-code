import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("Symbol boxing", () => {
  it.each([
    "const key=Symbol('key');const box=Object(key);return [typeof box,box.valueOf()===key];",
    "const key=Symbol('key');return key.toString();",
    "const key=Symbol('key');return key.valueOf()===key;",
    "const key=Symbol('key');return key[Symbol.toPrimitive]('default')===key;",
    "return Symbol.prototype.toString.call(Symbol('key'));",
    "const key=Symbol('key');return Symbol.prototype.valueOf.call(Object(key))===key;",
    "const key=Symbol('key');return Object.getPrototypeOf(Object(key))===Symbol.prototype;",
    "return Object(Symbol('key')).description;",
    "return JSON.stringify(Object(Symbol('key')));",
    "const box=Object(Symbol('key'));try{return String(box)}catch(error){return error.name}",
    "try{return Symbol.prototype.valueOf()}catch(error){return error.name}"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
});
