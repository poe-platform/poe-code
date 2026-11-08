import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise, isSandboxClosure } from "./values.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";

describe("anonymous function name inference", () => {
  it.each([
    "export default function(){}",
    "export default async function(){}",
    "export default function*(){}",
    "export default ()=>{}",
    "export default async()=>{}",
    "export default (function(){})",
    "export default (0,function(){})",
    "export default function explicit(){}"
  ])("matches native default-export metadata: %s", async (source) => {
    const native = await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
    );
    const module = parseModule(source);
    const result = await interpret({
      type: "BlockStatement",
      body: module.body,
      span: module.span
    });
    if (!result.ok) throw result.error;
    const exported = result.snapshot.bindings.default;
    expect(isSandboxClosure(exported)).toBe(true);
    if (!isSandboxClosure(exported)) throw new Error("Expected a default function");
    expect(exported.name ?? "").toBe(native.default.name);
  });

  it.each([
    ["function initializer", "const value=function(){};return value.name;"],
    ["arrow initializer", "const value=()=>{};return value.name;"],
    ["async function", "const value=async function(){};return value.name;"],
    ["async arrow", "const value=async()=>{};return value.name;"],
    ["generator", "const value=function*(){};return value.name;"],
    ["assignment", "let value;value=function(){};return value.name;"],
    ["logical assignment", "let value;value??=()=>{};return value.name;"],
    ["object default", "const {value=()=>{}}={};return value.name;"],
    ["renamed default", "const {key:value=()=>{}}={};return value.name;"],
    ["array default", "const [value=function(){}]=[];return value.name;"],
    ["assignment default", "let value;({value=()=>{}}={});return value.name;"],
    ["parameter default", "function read(value=()=>{}){return value.name}return read();"],
    [
      "destructured parameter",
      "function read({value=function(){}}={}){return value.name}return read();"
    ],
    ["property", "const o={value:function(){}};return o.value.name;"],
    ["computed property", 'const o={["two words"]:()=>{}};return o["two words"].name;'],
    ["numeric property", "const o={7:()=>{}};return o[7].name;"],
    ["class field", "class C{value=()=>{}}return new C().value.name;"],
    ["static field", "class C{static value=function(){}}return C.value.name;"],
    ["parenthesized", "const value=(function(){});return value.name;"],
    ["descriptor", 'const value=()=>{};return Object.getOwnPropertyDescriptor(value,"name");'],
    ["bound name", "const value=function(){};return value.bind(null).name;"],
    ["explicit name control", "const value=function explicit(){};return value.name;"],
    ["comma control", "const value=(0,function(){});return value.name;"],
    ["conditional control", "const value=true?()=>{}:()=>{};return value.name;"],
    ["member assignment control", "const o={};o.value=()=>{};return o.value.name;"],
    [
      "nested returned function control",
      "const value=function(){return function(){}};return value().name;"
    ],
    ["passed callback control", "const value=(function(fn){return fn})(()=>{});return value.name;"]
  ])("matches native %s", async (_name, source) => {
    const native = runInNewContext(`(function(){"use strict";${source}})()`, {}, { timeout: 1000 });
    const result = await run(source);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });

  it.each(["function(){}", "()=>{}", "async function(){}", "function*(){}"])(
    "preserves %s naming through resume",
    async (definition) => {
      const source = `const value=${definition};await wait();return value.name;`;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = run(source, {
        bindings: {
          wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
        }
      });
      let snapshot: ReturnType<typeof JSON.parse>;
      try {
        snapshot = JSON.parse(await dump(original));
      } finally {
        release();
        await original;
      }
      expect(await original).toMatchObject({ ok: true, returnValue: "value" });
      expect(
        await run(source, {
          bindings: {
            wait: createSandboxClosure({
              async: true,
              call: () => createSandboxPromise(Promise.resolve())
            })
          },
          snapshot: restore(snapshot, { source })
        })
      ).toMatchObject({ ok: true, returnValue: "value" });
    }
  );
});
