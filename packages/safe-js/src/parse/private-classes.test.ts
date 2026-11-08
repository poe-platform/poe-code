import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";

it.each([
  "class C{#x=4;read(){return this.#x / 2}}",
  "class C{#x;read(o){return #x in o < 1}}",
  "class C{#x;read(){return `${this.#x}`}}",
  "class C{#x;read(){return class D extends (this.#x) {}}}",
  "class C{#x;read(){return (()=>this.#x)()}}",
  "class C{#x=1;read(){return this.#x}}",
  "class C{#m(){};read(){return this.#m()}}",
  "class C{get #x(){return 1}set #x(v){}read(){return this.#x}}",
  "class C{static #x;static has(o){return #x in o}}",
  "class C{#x;read(o){return o?.#x}}",
  "class C{read(){return this.#x}#x}",
  "class C{#x;read(){return class D{read(o){return o.#x}}}}",
  "class C{async #m(){} *#g(){} async *#a(){}}"
])("parses private class syntax: %s", source => {
  expect(() => new Script(source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
});

it.each([
  "const o={};o.#x", "class C{read(){return this.#x}}",
  "class C{#x;#x}", "class C{#x;static #x}",
  "class C{#constructor}", "class C{#x;read(){delete this.#x}}",
  "class C{#x;read(){return super.#x}}", "class C{#x;read(){return #x}}",
  "class C{get #x(){return 1}get #x(){return 2}}",
  "class C{get #x(){return 1}static set #x(v){}}"
])("rejects private-name early errors: %s", source => {
  expect(() => new Script(source)).toThrow();
  expect(() => parseModule(source)).toThrow();
});
